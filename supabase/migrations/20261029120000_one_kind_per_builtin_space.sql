-- One kind per built-in space (docs/places-space-plan.md, step 2b; owner 2026-10-29: "if I am adding
-- a note to Places, I should be adding a place note; same for the built-in spaces", Q3 "turn them into
-- the space's note", and "the big description must remain the same").
--
--   * _one_kind_per_built_in(user): every live plain note (not a task, routine, place, recipe, drink
--     or memory) in one of the account's built-in spaces, or a sub-space of one, becomes that space's
--     kind once: Tasks a task (open), Places a place (kind "other", want to go), Recipes a recipe,
--     Cocktails a drink, Memories a memory. Only item_type and metadata change: the title and the text
--     stay exactly as they are, attachments and links too.
--   * History (rule 7): the note as it was goes to item_revision first, with a change note: by the
--     revision trigger when its fields change, else here (the trigger writes one only when the title,
--     text or fields change, and the type alone is not one of them).
--   * Not changed: a note of another kind (a recipe in Tasks; the old Home note in Memories, D36),
--     a note in the bin, a memory title too long to be one short fact (more than 200 characters, as
--     memory.ts), and, in Cocktails, any note of an account under 21 while the age check is on (D44:
--     a drink is not made from a note nobody checked).
--   * The search index is left as it is: the text did not change.
--   * Every existing account, now. Safe to run twice. From now on save_item / update_item keep it so.

create function _one_kind_per_built_in(p_user uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_adult boolean;
  v_row record;
  v_type text;
  v_meta jsonb;
  v_done int := 0;
begin
  v_adult := not public._age_check_on()
    or coalesce((select u.alcohol_from <= current_date from public.app_user u where u.id = p_user), false);
  for v_row in
    with recursive tree (id, kind) as (
      select s.id, s.built_in from public.space s
      where s.owner_user_id = p_user and s.built_in is not null
      union all
      select s.id, t.kind from public.space s join tree t on s.parent_id = t.id
      where s.built_in is null
    ) cycle id set looped using path
    select i.id, i.title, i.body_markdown, i.metadata, i.created_by, i.updated_by, t.kind
    from public.item i join tree t on t.id = i.space_id and not t.looped
    where i.deleted_at is null
      and lower(trim(i.item_type)) not in ('task', 'routine', 'place', 'recipe', 'cocktail', 'memory')
    order by i.created_at, i.id
  loop
    if v_row.kind = 'memories' and length(trim(v_row.title)) not between 3 and 200 then continue; end if;
    if v_row.kind = 'cocktails' and not v_adult then continue; end if;
    v_type := case v_row.kind
      when 'tasks' then 'task' when 'places' then 'place' when 'recipes' then 'recipe'
      when 'cocktails' then 'cocktail' when 'memories' then 'memory' end;
    if v_type is null then continue; end if;
    -- As the server's checks make an empty one (tasks.ts, places.ts, recipes.ts, memory.ts).
    v_meta := case v_type
      when 'task' then '{"status": "open", "priority": "normal"}'::jsonb
      when 'place' then '{"status": "want", "kind": "other"}'::jsonb
      else '{}'::jsonb end;

    perform set_config('app.change_note',
      'Kept as a ' || v_type || ': every note in a built-in space is of its kind (was a plain note).', true);
    if v_row.metadata is not distinct from v_meta then
      insert into public.item_revision (item_id, revision_number, title, body_markdown, metadata, change_note, edited_by)
      values (
        v_row.id,
        coalesce((select max(r.revision_number) from public.item_revision r where r.item_id = v_row.id), 0) + 1,
        v_row.title, v_row.body_markdown, v_row.metadata,
        current_setting('app.change_note', true),
        coalesce(v_row.updated_by, v_row.created_by));
    end if;
    -- Only the type and the fields: the title and the text stay.
    update public.item set item_type = v_type, metadata = v_meta where id = v_row.id;
    perform set_config('app.change_note', '', true);
    v_done := v_done + 1;
  end loop;
  return v_done;
end;
$$;

revoke execute on function _one_kind_per_built_in(uuid) from public, anon, authenticated;

-- Every account, now.
select public._one_kind_per_built_in(u.id) from public.app_user u;
