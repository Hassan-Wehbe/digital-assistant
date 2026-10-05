-- The one box's cheap classifier (docs/phase5-a5d-one-box-plan.md, step 6, Q4): a classification
-- adds its cost to the month without counting as one of the person's "requests".
--
--   * record_ai_cost(): like record_ai_usage(), but only the cost goes up; requests stay.
--     A classification costs a small fraction of a cent, so anything over 5 cents is refused.
--   * Nothing else changes: the allowance (my_ai_allowance) is still the month's cost against
--     the limit, so classifications use the allowance up like any other model call.

create function record_ai_cost(p_cost_cents numeric) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'sign-in required' using errcode = '42501'; end if;
  if p_cost_cents is null or p_cost_cents < 0 or p_cost_cents > 5 then
    raise exception 'cost must be between 0 and 5 cents' using errcode = '22023';
  end if;
  insert into public.ai_usage as a (user_id, month, cost_cents, requests)
  values (v_uid, public.ai_month(), p_cost_cents, 0)
  on conflict (user_id, month) do update
    set cost_cents = a.cost_cents + excluded.cost_cents,
        updated_at = now();
  return public.my_ai_allowance();
end;
$$;

revoke execute on function record_ai_cost(numeric) from public, anon;
grant execute on function record_ai_cost(numeric) to authenticated;
