-- Test: the vault (docs/phase1-m2-vault-plan.md; CLAUDE.md rules 1-5).
-- The database only sees ciphertext, so fake byte strings of the right sizes
-- stand in for keys and payloads. Two kinds of session are simulated:
--   browser: the owner signed in on the vault page (no client_id claim)
--   mcp:     the Claude connector's OAuth token (has a client_id claim)

create temp table _v (k text primary key, v text);
grant select, insert, update on _v to authenticated, anon;

create function pg_temp.b64(hex text) returns text language sql immutable as $$
  select replace(encode(decode(hex, 'hex'), 'base64'), E'\n', '');
$$;
create function pg_temp.get(p_k text) returns text language sql stable as $$
  select v from _v where k = p_k;
$$;

-- ---------- user A, browser: set up the vault ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

select pg_temp.check('before setup: vault_status says not set up',
  (select vault_status() ->> 'set_up' = 'false'));

-- Wrong sizes are refused.
do $$
begin
  perform setup_vault(pg_temp.b64(repeat('11', 31)), pg_temp.b64(repeat('22', 72)),
                      pg_temp.b64(repeat('33', 72)), pg_temp.b64(repeat('44', 16)),
                      '{"alg":"argon2id13","ops":3,"mem":67108864}');
  perform pg_temp.check('setup_vault refuses a short public key', false, 'accepted');
exception when others then
  perform pg_temp.check('setup_vault refuses a short public key', sqlerrm like '%wrong length%', sqlerrm);
end $$;
do $$
begin
  perform setup_vault(pg_temp.b64(repeat('11', 32)), pg_temp.b64(repeat('22', 72)),
                      pg_temp.b64(repeat('33', 72)), pg_temp.b64(repeat('44', 16)),
                      '{"alg":"argon2id13","ops":1,"mem":1024}');
  perform pg_temp.check('setup_vault refuses weak Argon2id parameters', false, 'accepted');
exception when others then
  perform pg_temp.check('setup_vault refuses weak Argon2id parameters', sqlerrm like 'kdf_params%', sqlerrm);
end $$;
do $$
begin
  perform setup_vault(pg_temp.b64(repeat('11', 32)), pg_temp.b64(repeat('22', 72)),
                      pg_temp.b64(repeat('33', 72)), pg_temp.b64(repeat('44', 16)), '{"alg":"argon2id13"}');
  perform pg_temp.check('setup_vault refuses missing Argon2id parameters', false, 'accepted');
exception when others then
  perform pg_temp.check('setup_vault refuses missing Argon2id parameters', sqlerrm like 'kdf_params%', sqlerrm);
end $$;

select setup_vault(pg_temp.b64(repeat('11', 32)), pg_temp.b64(repeat('22', 72)),
                   pg_temp.b64(repeat('33', 72)), pg_temp.b64(repeat('44', 16)),
                   '{"alg":"argon2id13","ops":3,"mem":67108864}');
select pg_temp.check('after setup: vault_status says set up, key version 1',
  (select vault_status() = '{"set_up": true, "key_version": 1}'::jsonb));
select pg_temp.check('get_vault_keys returns the wrapped keys to the browser session',
  (select k ->> 'public_key' = pg_temp.b64(repeat('11', 32))
      and k ->> 'wrapped_private_key' = pg_temp.b64(repeat('22', 72))
      and k ->> 'recovery_wrapped_private_key' = pg_temp.b64(repeat('33', 72))
      and k ->> 'vault_salt' = pg_temp.b64(repeat('44', 16))
   from get_vault_keys() k));

do $$
begin
  perform setup_vault(pg_temp.b64(repeat('55', 32)), pg_temp.b64(repeat('22', 72)),
                      pg_temp.b64(repeat('33', 72)), pg_temp.b64(repeat('44', 16)),
                      '{"alg":"argon2id13","ops":3,"mem":67108864}');
  perform pg_temp.check('a second setup_vault is refused (public key cannot be swapped)', false, 'accepted');
exception when others then
  perform pg_temp.check('a second setup_vault is refused (public key cannot be swapped)',
                        sqlerrm = 'the vault is already set up', sqlerrm);
end $$;

select rewrap_vault_passphrase(pg_temp.b64(repeat('66', 72)), pg_temp.b64(repeat('77', 16)),
                               '{"alg":"argon2id13","ops":4,"mem":67108864}');
select pg_temp.check('rewrap_vault_passphrase changes only the passphrase-wrapped key',
  (select k ->> 'wrapped_private_key' = pg_temp.b64(repeat('66', 72))
      and k ->> 'vault_salt' = pg_temp.b64(repeat('77', 16))
      and k ->> 'public_key' = pg_temp.b64(repeat('11', 32))
      and k ->> 'recovery_wrapped_private_key' = pg_temp.b64(repeat('33', 72))
      and (k -> 'kdf_params' ->> 'ops')::int = 4
   from get_vault_keys() k));

do $$
begin
  perform wrapped_private_key from app_user;
  perform pg_temp.check('authenticated cannot select wrapped_private_key', false, 'select succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('authenticated cannot select wrapped_private_key', true, sqlerrm);
end $$;
do $$
begin
  update app_user set public_key = decode(repeat('99', 32), 'hex');
  perform pg_temp.check('authenticated cannot update public_key directly', false, 'update succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('authenticated cannot update public_key directly', true, sqlerrm);
end $$;

insert into space (name) values ('Work');
insert into space (name, is_restricted) values ('Private', true);
insert into space (name, parent_id) values ('Inner', (select id from space where name = 'Private'));
insert into _v select 'work', id::text from space where name = 'Work';
insert into _v select 'private', id::text from space where name = 'Private';
insert into _v select 'inner', id::text from space where name = 'Inner';

-- ---------- user A, MCP session: ask for entry links ----------
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated","client_id":"claude-connector"}', true);
set local role authenticated;

insert into _v select 'e1', create_secret_entry(pg_temp.get('work')::uuid, 'login', 'Gartner sandbox', 'https://sandbox.gartner.example')::text;
insert into _v select 'e2', create_secret_entry(pg_temp.get('private')::uuid, 'login', 'Gartner private', null)::text;
insert into _v select 'e3', create_secret_entry(pg_temp.get('inner')::uuid, 'api_key', 'Gartner inner key', null)::text;
insert into _v select 'e_exp', create_secret_entry(pg_temp.get('work')::uuid, 'note', 'Expired one', null)::text;

select pg_temp.check('entry link token is 43 URL-safe characters',
  (select (pg_temp.get('e1')::jsonb ->> 'token') ~ '^[A-Za-z0-9_-]{43}$'));
select pg_temp.check('entry request is not a secret yet (nothing to find before the value is typed)',
  (select count(*) = 0 from find_secrets('gartner')));

do $$
begin
  perform get_secret_entry_request(pg_temp.get('e1')::jsonb ->> 'token');
  perform pg_temp.check('MCP token cannot open an entry request', false, 'allowed');
exception when others then
  perform pg_temp.check('MCP token cannot open an entry request',
                        sqlerrm = 'this action is only available on the vault page', sqlerrm);
end $$;
do $$
begin
  perform complete_secret_entry(pg_temp.get('e1')::jsonb ->> 'token', pg_temp.b64(repeat('ab', 80)));
  perform pg_temp.check('MCP token cannot store ciphertext', false, 'allowed');
exception when others then
  perform pg_temp.check('MCP token cannot store ciphertext',
                        sqlerrm = 'this action is only available on the vault page', sqlerrm);
end $$;
do $$
begin
  perform get_vault_keys();
  perform pg_temp.check('MCP token cannot read the wrapped keys', false, 'allowed');
exception when others then
  perform pg_temp.check('MCP token cannot read the wrapped keys',
                        sqlerrm = 'this action is only available on the vault page', sqlerrm);
end $$;
do $$
begin
  perform rewrap_vault_passphrase(pg_temp.b64(repeat('00', 72)), pg_temp.b64(repeat('00', 16)),
                                  '{"alg":"argon2id13","ops":3,"mem":67108864}');
  perform pg_temp.check('MCP token cannot replace the wrapped key', false, 'allowed');
exception when others then
  perform pg_temp.check('MCP token cannot replace the wrapped key',
                        sqlerrm = 'this action is only available on the vault page', sqlerrm);
end $$;

-- ---------- user A, browser: type the values ----------
reset role;
update secret_entry_request set expires_at = now() - interval '1 second'
where secret_id = (pg_temp.get('e_exp')::jsonb ->> 'secret_id')::uuid;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

select pg_temp.check('entry page sees the request metadata and public key',
  (select r ->> 'name' = 'Gartner sandbox' and r ->> 'space' = 'Work'
      and r ->> 'secret_id' = pg_temp.get('e1')::jsonb ->> 'secret_id'
      and r ->> 'public_key' = pg_temp.b64(repeat('11', 32))
   from get_secret_entry_request(pg_temp.get('e1')::jsonb ->> 'token') r));

do $$
begin
  perform complete_secret_entry(pg_temp.get('e1')::jsonb ->> 'token', pg_temp.b64(repeat('ab', 10)));
  perform pg_temp.check('a payload shorter than a sealed box is refused', false, 'accepted');
exception when others then
  perform pg_temp.check('a payload shorter than a sealed box is refused', sqlerrm like '%wrong length%', sqlerrm);
end $$;

select complete_secret_entry(pg_temp.get('e1')::jsonb ->> 'token', pg_temp.b64(repeat('ab', 80)));
select complete_secret_entry(pg_temp.get('e2')::jsonb ->> 'token', pg_temp.b64(repeat('cd', 80)));
select complete_secret_entry(pg_temp.get('e3')::jsonb ->> 'token', pg_temp.b64(repeat('ef', 80)));
insert into _v values ('s1', pg_temp.get('e1')::jsonb ->> 'secret_id');

select pg_temp.check('completed entry created the secret with the pre-allocated id and key version',
  (select count(*) = 1 from secret
   where id = pg_temp.get('s1')::uuid and name = 'Gartner sandbox' and secret_type = 'login'
     and key_version = 1));

do $$
begin
  perform complete_secret_entry(pg_temp.get('e1')::jsonb ->> 'token', pg_temp.b64(repeat('ba', 80)));
  perform pg_temp.check('an entry link works only once', false, 'reused');
exception when others then
  perform pg_temp.check('an entry link works only once', sqlstate = 'PT410' and sqlerrm like 'this link has expired%', sqlerrm);
end $$;
do $$
begin
  perform get_secret_entry_request(pg_temp.get('e_exp')::jsonb ->> 'token');
  perform pg_temp.check('an expired entry link is refused', false, 'accepted');
exception when others then
  perform pg_temp.check('an expired entry link is refused', sqlstate = 'PT410' and sqlerrm like 'this link has expired%', sqlerrm);
end $$;
do $$
begin
  perform get_secret_entry_request('not-a-real-token');
  perform pg_temp.check('an unknown entry token is refused', false, 'accepted');
exception when others then
  perform pg_temp.check('an unknown entry token is refused', sqlstate = 'PT410' and sqlerrm like 'this link has expired%', sqlerrm);
end $$;

do $$
begin
  perform payload_enc from secret;
  perform pg_temp.check('authenticated cannot select payload_enc', false, 'select succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('authenticated cannot select payload_enc', true, sqlerrm);
end $$;
select pg_temp.check('authenticated can select secret metadata',
  (select count(*) = 3 from secret));
do $$
begin
  insert into secret (space_id, secret_type, name, payload_enc)
  values (pg_temp.get('work')::uuid, 'note', 'direct', '\x00');
  perform pg_temp.check('direct INSERT into secret is refused', false, 'insert succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('direct INSERT into secret is refused', true, sqlerrm);
end $$;
do $$
begin
  update secret set payload_enc = '\x00';
  perform pg_temp.check('direct UPDATE of payload_enc is refused', false, 'update succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('direct UPDATE of payload_enc is refused', true, sqlerrm);
end $$;
do $$
begin
  insert into secret_access_log (secret_id, user_id, action, channel)
  values (pg_temp.get('s1')::uuid, auth.uid(), 'reveal', 'web');
  perform pg_temp.check('users cannot write fake access-log rows', false, 'insert succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('users cannot write fake access-log rows', true, sqlerrm);
end $$;
do $$
begin
  perform * from secret_entry_request;
  perform pg_temp.check('token tables are not readable directly', false, 'select succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('token tables are not readable directly', true, sqlerrm);
end $$;

-- ---------- user A, MCP session: find and ask for a reveal link ----------
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated","client_id":"claude-connector"}', true);
set local role authenticated;

select pg_temp.check('find_secrets by name returns only the Work secret (restricted excluded)',
  (select count(*) = 1 and bool_and(name = 'Gartner sandbox') from find_secrets('gartner')));
select pg_temp.check('find_secrets matches url words too',
  (select count(*) = 1 from find_secrets('sandbox.gartner.example')));
select pg_temp.check('find_secrets with no filters lists only non-restricted secrets',
  (select count(*) = 1 from find_secrets()));
select pg_temp.check('find_secrets scoped to the restricted space returns nothing',
  (select count(*) = 0 from find_secrets(null, null, pg_temp.get('private')::uuid)));
select pg_temp.check('find_secrets scoped under a restricted space returns nothing',
  (select count(*) = 0 from find_secrets('inner', null, pg_temp.get('inner')::uuid)));
select pg_temp.check('find_secrets by type skips the restricted api_key',
  (select count(*) = 0 from find_secrets(null, 'api_key')));

insert into _v select 'r1', create_reveal_token(pg_temp.get('s1')::uuid)::text;
insert into _v select 'r_exp', create_reveal_token(pg_temp.get('s1')::uuid)::text;
do $$
begin
  perform reveal_secret(pg_temp.get('r1')::jsonb ->> 'token');
  perform pg_temp.check('MCP token cannot use a reveal link', false, 'allowed');
exception when others then
  perform pg_temp.check('MCP token cannot use a reveal link',
                        sqlerrm = 'this action is only available on the vault page', sqlerrm);
end $$;

-- ---------- user A, browser: reveal ----------
reset role;
update secret_reveal_token set expires_at = now() - interval '1 second'
where token_hash = extensions.digest(convert_to(pg_temp.get('r_exp')::jsonb ->> 'token', 'UTF8'), 'sha256');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

select pg_temp.check('reveal page can peek at the link without using it up',
  (select r ->> 'name' = 'Gartner sandbox' from get_reveal_request(pg_temp.get('r1')::jsonb ->> 'token') r)
  and (select r ->> 'name' = 'Gartner sandbox' from get_reveal_request(pg_temp.get('r1')::jsonb ->> 'token') r));
select pg_temp.check('reveal_secret returns the stored ciphertext',
  (select r ->> 'payload_enc' = pg_temp.b64(repeat('ab', 80))
      and r ->> 'secret_id' = pg_temp.get('s1')
   from reveal_secret(pg_temp.get('r1')::jsonb ->> 'token') r));
do $$
begin
  perform reveal_secret(pg_temp.get('r1')::jsonb ->> 'token');
  perform pg_temp.check('a reveal link works only once', false, 'reused');
exception when others then
  perform pg_temp.check('a reveal link works only once', sqlstate = 'PT410' and sqlerrm like 'this link has expired%', sqlerrm);
end $$;
do $$
begin
  perform reveal_secret(pg_temp.get('r_exp')::jsonb ->> 'token');
  perform pg_temp.check('an expired reveal link is refused', false, 'accepted');
exception when others then
  perform pg_temp.check('an expired reveal link is refused', sqlstate = 'PT410' and sqlerrm like 'this link has expired%', sqlerrm);
end $$;
select pg_temp.check('reveal sets last_accessed_at',
  (select last_accessed_at is not null from secret where id = pg_temp.get('s1')::uuid));

-- ---------- user B ----------
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
insert into space (name) values ('B space');
insert into _v select 'r_b', null;

select pg_temp.check('B: vault not set up (A''s setup is not visible)',
  (select vault_status() ->> 'set_up' = 'false' and get_vault_keys() ->> 'set_up' = 'false'));
select pg_temp.check('B sees none of A''s secrets', (select count(*) = 0 from secret));
select pg_temp.check('B finds none of A''s secrets', (select count(*) = 0 from find_secrets('gartner')));
select pg_temp.check('B sees none of A''s access-log rows', (select count(*) = 0 from secret_access_log));
select pg_temp.check('B sees only their own app_user row',
  (select count(*) = 1 and bool_and(id = auth.uid()) from app_user));

do $$
begin
  perform create_reveal_token(pg_temp.get('s1')::uuid);
  perform pg_temp.check('B cannot get a reveal link for A''s secret', false, 'allowed');
exception when others then
  perform pg_temp.check('B cannot get a reveal link for A''s secret', sqlerrm = 'secret not found', sqlerrm);
end $$;
do $$
begin
  perform create_secret_reentry(pg_temp.get('s1')::uuid);
  perform pg_temp.check('B cannot get a re-entry link for A''s secret', false, 'allowed');
exception when others then
  perform pg_temp.check('B cannot get a re-entry link for A''s secret', sqlerrm = 'secret not found', sqlerrm);
end $$;
do $$
begin
  perform update_secret_meta(pg_temp.get('s1')::uuid, 'hacked');
  perform pg_temp.check('B cannot rename A''s secret', false, 'allowed');
exception when others then
  perform pg_temp.check('B cannot rename A''s secret', sqlerrm = 'secret not found', sqlerrm);
end $$;
do $$
begin
  perform delete_secret(pg_temp.get('s1')::uuid);
  perform pg_temp.check('B cannot delete A''s secret', false, 'allowed');
exception when others then
  perform pg_temp.check('B cannot delete A''s secret', sqlerrm = 'secret not found', sqlerrm);
end $$;

-- A makes a fresh reveal link; B holding the token still cannot use it.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated","client_id":"claude-connector"}', true);
set local role authenticated;
update _v set v = create_reveal_token(pg_temp.get('s1')::uuid)::text where k = 'r_b';
insert into _v select 'e_b', create_secret_reentry(pg_temp.get('s1')::uuid)::text;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000b","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  perform reveal_secret(pg_temp.get('r_b')::jsonb ->> 'token');
  perform pg_temp.check('B cannot use A''s reveal link even with the token', false, 'allowed');
exception when others then
  perform pg_temp.check('B cannot use A''s reveal link even with the token', sqlstate = 'PT410' and sqlerrm like 'this link has expired%', sqlerrm);
end $$;
do $$
begin
  perform complete_secret_entry(pg_temp.get('e_b')::jsonb ->> 'token', pg_temp.b64(repeat('00', 80)));
  perform pg_temp.check('B cannot use A''s entry link even with the token', false, 'allowed');
exception when others then
  perform pg_temp.check('B cannot use A''s entry link even with the token', sqlstate = 'PT410' and sqlerrm like 'this link has expired%', sqlerrm);
end $$;
do $$
begin
  perform setup_vault(pg_temp.b64(repeat('11', 32)), pg_temp.b64(repeat('22', 72)),
                      pg_temp.b64(repeat('33', 72)), pg_temp.b64(repeat('44', 16)),
                      '{"alg":"argon2id13","ops":3,"mem":67108864}');
  perform pg_temp.check('B can set up their own vault independently', true);
exception when others then
  perform pg_temp.check('B can set up their own vault independently', false, sqlerrm);
end $$;
do $$
begin
  perform create_secret_entry(pg_temp.get('work')::uuid, 'login', 'planted', null);
  perform pg_temp.check('B (vault set up) cannot create an entry link into A''s space', false, 'allowed');
exception when others then
  perform pg_temp.check('B (vault set up) cannot create an entry link into A''s space', sqlerrm = 'space not found', sqlerrm);
end $$;

-- ---------- user A: update (re-entry + metadata), then delete ----------
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select complete_secret_entry(pg_temp.get('e_b')::jsonb ->> 'token', pg_temp.b64(repeat('bb', 80)));

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated","client_id":"claude-connector"}', true);
set local role authenticated;
select update_secret_meta(pg_temp.get('s1')::uuid, 'Gartner sandbox (EU)', '');
select pg_temp.check('update_secret_meta renames and clears the url',
  (select name = 'Gartner sandbox (EU)' and url is null from secret where id = pg_temp.get('s1')::uuid));
select delete_secret(pg_temp.get('s1')::uuid);
select pg_temp.check('delete_secret removes the secret and its links',
  (select count(*) = 0 from secret where id = pg_temp.get('s1')::uuid));

select pg_temp.check('access log: create, reveal, update (value), update (metadata), delete, in order',
  (select array_agg(action || ':' || channel order by occurred_at, id) is not null
      and array_agg(action order by action) = array['create','delete','reveal','update','update']
   from secret_access_log where secret_id = pg_temp.get('s1')::uuid));
select pg_temp.check('access log keeps the name after delete',
  (select bool_and(secret_name is not null) and count(*) = 5
   from secret_access_log where secret_id = pg_temp.get('s1')::uuid));
select pg_temp.check('every completed entry logged a create',
  (select count(*) = 3 from secret_access_log where action = 'create'));

reset role;
select pg_temp.check('reveal tokens were removed with the secret',
  (select count(*) = 0 from secret_reveal_token where secret_id = pg_temp.get('s1')::uuid));
select pg_temp.check('link tokens are stored only as hashes',
  (select count(*) = 0 from secret_entry_request q, _v
   where _v.k like 'e%' and position(convert_to(_v.v::jsonb ->> 'token', 'UTF8') in q.token_hash) > 0));

-- ---------- nothing from the vault reaches the search index ----------
select pg_temp.check('no item_chunk or item rows were created by vault operations',
  (select count(*) = 0 from item_chunk c join item i on i.id = c.item_id
   join space s on s.id = i.space_id
   where s.owner_user_id in ('00000000-0000-4000-a000-00000000000a', '00000000-0000-4000-a000-00000000000b')));
select pg_temp.check('no vault table has a foreign key into item, item_chunk or item_share',
  (select count(*) = 0 from pg_constraint c
   where c.contype = 'f'
     and c.conrelid in ('secret'::regclass, 'secret_access_log'::regclass,
                        'secret_entry_request'::regclass, 'secret_reveal_token'::regclass)
     and c.confrelid in ('item'::regclass, 'item_chunk'::regclass, 'item_share'::regclass)));

-- ---------- anonymous caller ----------
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
begin
  perform reveal_secret('x');
  perform pg_temp.check('anon cannot call reveal_secret', false, 'call succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('anon cannot call reveal_secret', true, sqlerrm);
end $$;
do $$
begin
  perform count(*) from secret;
  perform pg_temp.check('anon cannot read secret', false, 'select succeeded');
exception when insufficient_privilege then
  perform pg_temp.check('anon cannot read secret', true, sqlerrm);
end $$;
reset role;
