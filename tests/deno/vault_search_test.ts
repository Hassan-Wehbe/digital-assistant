// The vault search ignores words people add when asking for a secret ("my bank password"),
// which are rarely in an entry's name, and reads "wifi" as the Wi-Fi type.
import { assertEquals } from "jsr:@std/assert@1";
import { secretSearch } from "../../supabase/functions/mcp/lib/vault.ts";

Deno.test("secretSearch drops generic words and keeps the distinctive ones", () => {
  assertEquals(secretSearch("my bank password", null), { query: "bank", secretType: null });
  assertEquals(secretSearch("Gmail login", null), { query: "gmail", secretType: null });
  assertEquals(secretSearch("the alarm PIN code", null), { query: "alarm", secretType: null });
  assertEquals(secretSearch("OpenAI API key", null), { query: "openai api key", secretType: null });
  assertEquals(secretSearch("gartner sandbox", "login"), { query: "gartner sandbox", secretType: "login" });
});

Deno.test("secretSearch reads wifi as the Wi-Fi type, and an empty query lists everything", () => {
  assertEquals(secretSearch("wifi password", null), { query: null, secretType: "wifi" });
  assertEquals(secretSearch("cottage Wi-Fi", null), { query: "cottage", secretType: "wifi" });
  assertEquals(secretSearch("wifi", "login"), { query: null, secretType: "login" });
  assertEquals(secretSearch("passwords", null), { query: null, secretType: null });
  assertEquals(secretSearch(undefined, null), { query: null, secretType: null });
  assertEquals(secretSearch("  \"Netflix\"  ", null), { query: "netflix", secretType: null });
});
