-- The household (docs/planners-plan.md step 1, design D40; owner 2026-10-19: all as recommended).
-- Who is in the family, for Family day: each person a label ("Me", "Sam", "Kid 1"), adult or
-- child, and for a child an optional birth year (Q3: the age stays right). Nothing more.
--
--   * household_member: at most 10 people per account, in the order the app shows them. Never an
--     item: never searched, embedded, remembered or shared (rules 3 and 4 never meet it). A
--     removed person is gone for good (a setting, like a home; rule 8 is about items).
--   * RLS: each person reads and changes only their own rows (rule 5). anon gets nothing.
--     authenticated may insert and change the label, kind, birth year and position, never the
--     owner.
--   * The planner (step 2) sends the AI roles and ages only ("child 6"), never a label (Q4).
--
-- Credential-looking text in a label is refused by the app before it gets here (rule 9).

-- =========================================================
-- The table
-- =========================================================

create table household_member (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references app_user (id) on delete cascade,
  label       text not null constraint household_member_label_check check (char_length(btrim(label)) between 1 and 40),
  kind        text not null constraint household_member_kind_check check (kind in ('adult', 'child')),
  birth_year  smallint,
  position    smallint not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Only a child has a birth year: nothing more is kept about an adult.
  constraint household_member_birth_year_check check (birth_year is null or (kind = 'child' and birth_year >= 1900))
);
create unique index household_member_label_once on household_member (user_id, lower(btrim(label)));
create index household_member_user_idx on household_member (user_id, position);

alter table household_member enable row level security;
create policy household_member_own on household_member for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- =========================================================
-- Rules kept by the database
-- =========================================================

-- Before a row is written: the label trimmed, a birth year not in the future, at most 10 people,
-- a new one placed last, the owner never changed. security definer only so it can count the
-- person's other rows (it changes nothing but the row being written).
create function household_member_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.label := btrim(new.label);
  if new.birth_year is not null and new.birth_year > extract(year from now())::int then
    raise exception 'A birth year cannot be in the future.' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'A household member cannot be given to someone else.' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
    new.updated_at := now();
    return new;
  end if;
  if (select count(*) from public.household_member m where m.user_id = new.user_id) >= 10 then
    raise exception 'A household holds at most 10 people. Remove one first.' using errcode = 'P0001';
  end if;
  new.position := coalesce((select max(m.position) + 1 from public.household_member m where m.user_id = new.user_id), 0);
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

create trigger household_member_before
  before insert or update on household_member
  for each row execute function household_member_before();

-- =========================================================
-- Grants (Supabase grants new tables and functions to anon by default)
-- =========================================================

revoke all on household_member from public, anon, authenticated;
grant select, delete on household_member to authenticated;                        -- RLS: own rows only
grant insert (label, kind, birth_year) on household_member to authenticated;      -- placed last by the trigger
grant update (label, kind, birth_year, position) on household_member to authenticated;
revoke execute on function household_member_before() from public, anon, authenticated;
