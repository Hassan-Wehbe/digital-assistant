-- Phase 1, milestone 1: knowledge path.
-- Everything the MCP tools need on the database side:
--   * app_user row created automatically on sign-up
--   * explicit table privileges (anon gets nothing; RLS still applies to authenticated)
--   * tighter ownership checks for nested spaces and item tags
--   * revision-on-edit trigger (CLAUDE.md rule 7)
--   * one security-invoker function per multi-step tool, so each call is atomic
--     and runs as the signed-in user with Row Level Security applied
--   * search_items: semantic + keyword + tag search that never sees restricted
--     spaces or anything nested under them (CLAUDE.md rule 3)
-- Secrets are out of scope for this milestone: nothing here reads or writes `secret`.

-- =========================================================
-- Privileges
-- =========================================================

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
-- History is append-only for users.
revoke update, delete on item_revision, secret_access_log from authenticated;

-- RLS helper functions are only for policies, not for the anonymous API.
revoke execute on function owns_space(uuid), owns_item(uuid) from public, anon;
grant execute on function owns_space(uuid), owns_item(uuid) to authenticated;

-- =========================================================
-- Users: one app_user row per auth user
-- =========================================================

create or replace function handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.app_user (id, email, display_name)
  values (new.id, coalesce(new.email, new.id::text), new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke execute on function handle_new_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- Users who signed up before this migration.
insert into app_user (id, email)
select id, coalesce(email, id::text) from auth.users
on conflict (id) do nothing;

-- =========================================================
-- Ownership defaults and tighter checks
-- =========================================================

alter table space alter column owner_user_id set default auth.uid();
alter table tag   alter column owner_user_id set default auth.uid();

create or replace function owns_tag(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from tag where id = t and owner_user_id = auth.uid());
$$;
revoke execute on function owns_tag(uuid) from public, anon;
grant execute on function owns_tag(uuid) to authenticated;

-- A space may only be nested under a space the same user owns.
drop policy space_owner on space;
create policy space_owner on space
  for all using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid() and (parent_id is null or owns_space(parent_id)));

-- An item may only carry the user's own tags.
drop policy item_tag_owner on item_tag;
create policy item_tag_owner on item_tag
  for all using (owns_item(item_id))
  with check (owns_item(item_id) and owns_tag(tag_id));

-- =========================================================
-- Hidden spaces: restricted, or nested anywhere under a restricted space
-- =========================================================

-- Spaces of the current user that general search may look into.
create or replace function searchable_space_ids() returns setof uuid
language sql stable security invoker set search_path = public as $$
  with recursive visible as (
    select s.id from space s
    where s.parent_id is null and not s.is_restricted and s.owner_user_id = auth.uid()
    union all
    select s.id from space s join visible v on s.parent_id = v.id
    where not s.is_restricted
  )
  select id from visible;
$$;

-- =========================================================
-- Revision on edit (rule 7): previous version goes to item_revision first
-- =========================================================

create or replace function item_before_update() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if (old.title, old.body_markdown, old.metadata)
     is distinct from (new.title, new.body_markdown, new.metadata) then
    insert into item_revision (item_id, revision_number, title, body_markdown, metadata, change_note)
    values (
      old.id,
      coalesce((select max(revision_number) from item_revision where item_id = old.id), 0) + 1,
      old.title, old.body_markdown, old.metadata,
      nullif(current_setting('app.change_note', true), ''));
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger item_before_update
  before update on item
  for each row execute function item_before_update();

-- =========================================================
-- Internal helpers (called only from the functions below)
-- =========================================================

-- Replace the item's text chunks. p_chunks: [{"content": text, "embedding": "[...384 floats]"}]
create or replace function _replace_item_chunks(p_item_id uuid, p_chunks jsonb) returns void
language plpgsql security invoker set search_path = public, extensions as $$
begin
  delete from item_chunk where item_id = p_item_id and attachment_id is null;
  insert into item_chunk (item_id, chunk_index, content, embedding)
  select p_item_id, (c.ord - 1)::int, c.value ->> 'content',
         (c.value ->> 'embedding')::extensions.vector(384)
  from jsonb_array_elements(coalesce(p_chunks, '[]'::jsonb)) with ordinality as c(value, ord);
end;
$$;

-- Replace the item's tags; tag names are trimmed and lower-cased, created on first use.
create or replace function _set_item_tags(p_item_id uuid, p_tags text[]) returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_names text[];
begin
  select coalesce(array_agg(distinct n), '{}') into v_names
  from (select lower(btrim(t)) as n from unnest(coalesce(p_tags, '{}')) t) x
  where n <> '';

  insert into tag (owner_user_id, name)
  select auth.uid(), n from unnest(v_names) n
  on conflict (owner_user_id, name) do nothing;

  delete from item_tag where item_id = p_item_id;
  insert into item_tag (item_id, tag_id)
  select p_item_id, t.id from tag t
  where t.owner_user_id = auth.uid() and t.name = any (v_names);
end;
$$;

-- Security invoker, so RLS still applies inside. Not for the anonymous API.
revoke execute on function _replace_item_chunks(uuid, jsonb), _set_item_tags(uuid, text[])
  from public, anon;
grant execute on function _replace_item_chunks(uuid, jsonb), _set_item_tags(uuid, text[])
  to authenticated;

-- =========================================================
-- Tool functions (security invoker: RLS applies as the signed-in user)
-- =========================================================

create or replace function save_item(
  p_space_id  uuid,
  p_item_type text,
  p_title     text,
  p_body      text default '',
  p_summary   text default null,
  p_metadata  jsonb default '{}'::jsonb,
  p_tags      text[] default '{}',
  p_chunks    jsonb default '[]'::jsonb,
  p_source    text default 'typed'
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
begin
  if not owns_space(p_space_id) then
    raise exception 'space not found' using errcode = 'P0002';
  end if;

  insert into item (space_id, item_type, title, body_markdown, summary, metadata, source)
  values (p_space_id, lower(btrim(p_item_type)), p_title, coalesce(p_body, ''), p_summary,
          coalesce(p_metadata, '{}'::jsonb), coalesce(p_source, 'typed'))
  returning id into v_id;

  perform _set_item_tags(v_id, p_tags);
  perform _replace_item_chunks(v_id, p_chunks);
  return v_id;
end;
$$;

-- Null arguments mean "leave unchanged". p_chunks is required whenever title,
-- body or summary change, so only the current version is ever chunked.
create or replace function update_item(
  p_item_id     uuid,
  p_title       text default null,
  p_body        text default null,
  p_summary     text default null,
  p_metadata    jsonb default null,
  p_item_type   text default null,
  p_space_id    uuid default null,
  p_tags        text[] default null,
  p_change_note text default null,
  p_chunks      jsonb default null
) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if not owns_item(p_item_id)
     or exists (select 1 from item where id = p_item_id and deleted_at is not null) then
    raise exception 'item not found' using errcode = 'P0002';
  end if;
  if p_space_id is not null and not owns_space(p_space_id) then
    raise exception 'space not found' using errcode = 'P0002';
  end if;
  if p_chunks is null and (p_title is not null or p_body is not null or p_summary is not null) then
    raise exception 'text changed but no chunks were supplied' using errcode = '22023';
  end if;

  perform set_config('app.change_note', coalesce(p_change_note, ''), true);

  update item set
    title         = coalesce(p_title, title),
    body_markdown = coalesce(p_body, body_markdown),
    summary       = coalesce(p_summary, summary),
    metadata      = coalesce(p_metadata, metadata),
    item_type     = coalesce(lower(btrim(p_item_type)), item_type),
    space_id      = coalesce(p_space_id, space_id)
  where id = p_item_id;

  if p_tags is not null then
    perform _set_item_tags(p_item_id, p_tags);
  end if;
  if p_chunks is not null then
    perform _replace_item_chunks(p_item_id, p_chunks);
  end if;

  perform set_config('app.change_note', '', true);
end;
$$;

-- One item with its space, tags, attachments (metadata only) and links.
-- Works for items in restricted spaces (M1 decision), but links never reveal
-- items that sit in hidden spaces.
create or replace function get_item(p_item_id uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'id', i.id,
    'title', i.title,
    'item_type', i.item_type,
    'summary', i.summary,
    'body_markdown', i.body_markdown,
    'metadata', i.metadata,
    'source', i.source,
    'created_at', i.created_at,
    'updated_at', i.updated_at,
    'space', jsonb_build_object('id', s.id, 'name', s.name, 'is_restricted', s.is_restricted),
    'tags', coalesce((
      select jsonb_agg(t.name order by t.name)
      from item_tag it join tag t on t.id = it.tag_id where it.item_id = i.id), '[]'::jsonb),
    'attachments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'filename', a.original_filename, 'mime_type', a.mime_type,
        'description', a.extracted_description) order by a.created_at)
      from attachment a where a.item_id = i.id), '[]'::jsonb),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object(
        'direction', l.direction, 'relation', l.relation,
        'item_id', o.id, 'title', o.title, 'item_type', o.item_type) order by o.title)
      from (
        select 'outgoing' as direction, relation, to_item_id as other_id
        from item_link where from_item_id = i.id
        union all
        select 'incoming', relation, from_item_id
        from item_link where to_item_id = i.id
      ) l
      join item o on o.id = l.other_id and o.deleted_at is null
      where o.space_id in (select searchable_space_ids())), '[]'::jsonb),
    'revision_count', (select count(*) from item_revision r where r.item_id = i.id)
  )
  from item i join space s on s.id = i.space_id
  where i.id = p_item_id
    and i.deleted_at is null
    and s.owner_user_id = auth.uid();
$$;

-- Hybrid search. Items in restricted spaces (or below them) are never
-- candidates, so they cannot appear in results or influence counts.
--   p_query            free text for keyword search (null = filter-only listing)
--   p_query_embedding  gte-small embedding of p_query, as '[...]' text (null = keyword only)
--   p_tags             item must carry all of these tags
--   p_space_id         limit to this space and its sub-spaces
--   p_item_type        limit to this item type
create or replace function search_items(
  p_query           text default null,
  p_query_embedding text default null,
  p_tags            text[] default null,
  p_space_id        uuid default null,
  p_item_type       text default null,
  p_limit           int default 10
) returns table (
  item_id    uuid,
  title      text,
  item_type  text,
  space_id   uuid,
  snippet    text,
  tags       text[],
  score      double precision,
  updated_at timestamptz
)
language sql stable security invoker set search_path = public, extensions as $$
  with recursive
  scope as (
    select id from space where id = p_space_id
    union all
    select s.id from space s join scope sc on s.parent_id = sc.id
  ),
  tag_names as (
    select distinct lower(btrim(t)) as name
    from unnest(coalesce(p_tags, '{}')) t
    where btrim(t) <> ''
  ),
  candidates as (
    select i.* from item i
    where i.deleted_at is null
      and i.space_id in (select searchable_space_ids())
      and (p_space_id is null or i.space_id in (select id from scope))
      and (p_item_type is null or i.item_type = lower(btrim(p_item_type)))
      and not exists (
        select 1 from tag_names tn
        where not exists (
          select 1 from item_tag it join tag t on t.id = it.tag_id
          where it.item_id = i.id and t.name = tn.name))
  ),
  q as (
    select case when p_query_embedding is null then null
                else p_query_embedding::extensions.vector(384) end as emb,
           case when nullif(btrim(p_query), '') is null then null
                else websearch_to_tsquery('english', p_query) end as tsq
  ),
  chunk_hits as (
    select c.item_id, c.content, c.embedding <=> q.emb as dist
    from item_chunk c join candidates ca on ca.id = c.item_id, q
    where q.emb is not null and c.embedding is not null
  ),
  semantic as (
    select item_id,
           min(dist) as dist,
           (array_agg(content order by dist))[1] as best_chunk,
           row_number() over (order by min(dist)) as rnk
    from chunk_hits
    group by item_id
    order by min(dist)
    limit 50
  ),
  keyword as (
    select ca.id as item_id,
           row_number() over (
             order by ts_rank_cd(to_tsvector('english', ca.title || ' ' || ca.body_markdown), q.tsq) desc
           ) as rnk
    from candidates ca, q
    where q.tsq is not null
      and to_tsvector('english', ca.title || ' ' || ca.body_markdown) @@ q.tsq
    order by rnk
    limit 50
  ),
  fused as (
    select coalesce(s.item_id, k.item_id) as item_id,
           coalesce(1.0 / (60 + s.rnk), 0) + coalesce(1.0 / (60 + k.rnk), 0) as score,
           s.best_chunk
    from semantic s full outer join keyword k on k.item_id = s.item_id
  ),
  ranked as (
    -- With a query: fused ranking. Without one: most recently updated first.
    select f.item_id, f.score::double precision as score, f.best_chunk
    from fused f
    where p_query is not null or p_query_embedding is not null
    union all
    select ca.id, 0::double precision, null
    from candidates ca
    where p_query is null and p_query_embedding is null
  )
  select i.id, i.title, i.item_type, i.space_id,
         left(coalesce(r.best_chunk, i.summary, i.body_markdown), 300) as snippet,
         coalesce((select array_agg(t.name order by t.name)
                   from item_tag it join tag t on t.id = it.tag_id
                   where it.item_id = i.id), '{}') as tags,
         r.score,
         i.updated_at
  from ranked r join item i on i.id = r.item_id
  order by r.score desc, i.updated_at desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

revoke execute on function
  searchable_space_ids(),
  save_item(uuid, text, text, text, text, jsonb, text[], jsonb, text),
  update_item(uuid, text, text, text, jsonb, text, uuid, text[], text, jsonb),
  get_item(uuid),
  search_items(text, text, text[], uuid, text, int)
  from public, anon;
grant execute on function
  searchable_space_ids(),
  save_item(uuid, text, text, text, text, jsonb, text[], jsonb, text),
  update_item(uuid, text, text, text, jsonb, text, uuid, text[], text, jsonb),
  get_item(uuid),
  search_items(text, text, text[], uuid, text, int)
  to authenticated;
