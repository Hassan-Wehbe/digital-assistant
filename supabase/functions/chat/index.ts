// Wilma's chat (docs/phase5-a5b-chat-function-plan.md): the app sends the recent conversation
// with the user's sign-in; Wilma answers with the configured model (LLM_ROUTES, OPENAI_API_KEY),
// running the MCP server's own tools in memory as that user. The logic is in chat.ts.
// My day's drive times use MAPBOX_TOKEN and its weather NWS_CONTACT (Supabase secrets, set by the
// owner); without them drives and weather say "unavailable" and the rest of the plan still works.
//
//   POST /functions/v1/chat   Bearer token required; streams newline-delimited JSON events
import { createLlm, type Llm } from "../_shared/llm/index.ts";
import { mapboxDrives } from "../_shared/dayplan/mapbox.ts";
import { nwsWeather } from "../_shared/dayplan/nws.ts";
import { userClient, verifyAccessToken } from "../mcp/lib/db.ts";
import { createHandler } from "./chat.ts";

let llm: Llm | undefined; // routes are read once per instance; a bad LLM_ROUTES is retried next time

Deno.serve(createHandler({
  verifyToken: verifyAccessToken,
  clientFor: userClient,
  llm: () => (llm ??= createLlm({ env: (name) => Deno.env.get(name) })),
  // A new provider per plan: nothing from Mapbox or NWS is kept between requests.
  drives: () => {
    const token = Deno.env.get("MAPBOX_TOKEN")?.trim();
    return token ? mapboxDrives({ token }) : null;
  },
  weather: () => {
    const contact = Deno.env.get("NWS_CONTACT")?.trim();
    return contact ? nwsWeather({ contact }) : null;
  },
  log: (entry) => console.log(JSON.stringify(entry)),
  background: (work) => EdgeRuntime.waitUntil(work),
}));
