-- Places (docs/places-plan.md, design D26): search reads a place's fields.
--
-- A place is an item with item_type 'place' whose metadata holds its address, kind, cuisine,
-- dishes, visits and so on (checked by the MCP server, supabase/functions/mcp/lib/places.ts).
-- Meaning search already reads them (the server adds them to the item's chunks). Keyword search
-- read only the title, the body and attachment text; it now also reads a place's text fields,
-- so "Mar Mikhael" or "carbonara" finds the place. Other item types are unchanged.
--
-- search_items also returns a place's metadata (null for other items), so Wilma can list
-- "want to go" places or filter by occasion without opening each one. Restricted spaces stay
-- out exactly as before (CLAUDE.md rule 3): the candidates are the same.
--
-- Same body as in 20260930100000_search_cutoff.sql apart from the two marked lines. The return
-- type changes, so the function is dropped first.

drop function search_items(text, text, text[], uuid, text, int, double precision);

create function search_items(
  p_query           text default null,
  p_query_embedding text default null,
  p_tags            text[] default null,
  p_space_id        uuid default null,
  p_item_type       text default null,
  p_limit           int default 10,
  p_max_distance    double precision default null
) returns table (
  item_id    uuid,
  title      text,
  item_type  text,
  space_id   uuid,
  snippet    text,
  tags       text[],
  score      double precision,
  updated_at timestamptz,
  place      jsonb
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
      -- Optional cutoff: leave out chunks whose meaning is not close enough.
      and (p_max_distance is null or (c.embedding <=> q.emb) <= p_max_distance)
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
  -- Attachment text per item: file names (with . _ - read as spaces), captions,
  -- Claude's descriptions and Visio text.
  attachment_text as (
    select a.item_id,
           string_agg(concat_ws(' ', a.original_filename,
                                regexp_replace(a.original_filename, '[._-]+', ' ', 'g'),
                                a.caption, a.extracted_description, a.extracted_text), ' ') as txt
    from attachment a join candidates ca on ca.id = a.item_id
    group by a.item_id
  ),
  keyword_docs as (
    select ca.id as item_id,
           to_tsvector('english', ca.title || ' ' || ca.body_markdown || ' ' || coalesce(att.txt, ''))
           -- Places: every text value in the metadata (address, kind, cuisine, dishes, visits).
           || case when ca.item_type = 'place'
                   then jsonb_to_tsvector('english', ca.metadata, '["string"]')
                   else ''::tsvector end as tsv
    from candidates ca left join attachment_text att on att.item_id = ca.id
  ),
  keyword as (
    select d.item_id,
           row_number() over (order by ts_rank_cd(d.tsv, q.tsq) desc) as rnk
    from keyword_docs d, q
    where q.tsq is not null and d.tsv @@ q.tsq
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
         i.updated_at,
         -- Places: their fields; null for every other item.
         case when i.item_type = 'place' then i.metadata end as place
  from ranked r join item i on i.id = r.item_id
  order by r.score desc, i.updated_at desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

revoke execute on function
  search_items(text, text, text[], uuid, text, int, double precision) from public, anon;
grant execute on function
  search_items(text, text, text[], uuid, text, int, double precision) to authenticated;
