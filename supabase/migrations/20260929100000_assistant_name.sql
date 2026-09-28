-- The name the owner uses to call the assistant ("Wilma, save this recipe",
-- "Hey Wilma" by voice). The MCP server puts it into its instructions and tool
-- descriptions, so a message addressed to it is routed to these tools; a voice
-- front end (phase 3) reads the same value for its wake word. The connector and
-- MCP server keep the product name "Digital Assistant".
--
-- The name is copied into text the model reads, so it is kept to a plain name:
-- 1-30 characters, starting with a letter; letters, spaces, apostrophes, dots
-- and hyphens only (no quotes, digits, punctuation or line breaks).

alter table app_user
  add column assistant_name text not null default 'Wilma'
  constraint app_user_assistant_name_check
    check (assistant_name ~ '^[[:alpha:]][[:alpha:] ''’.-]{0,29}$');

-- Readable and changeable by the owner only (RLS policy app_user_self limits
-- both to their own row). No other app_user column becomes writable.
grant select (assistant_name) on app_user to authenticated;
grant update (assistant_name) on app_user to authenticated;
