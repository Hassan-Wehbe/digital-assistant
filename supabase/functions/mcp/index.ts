// Digital Assistant MCP server (Streamable HTTP, stateless).
//
//   POST /functions/v1/mcp                                      MCP requests (Bearer token required)
//   GET  /functions/v1/mcp/.well-known/oauth-protected-resource  OAuth discovery (public)
//   POST /functions/v1/mcp/embed-pending                        embed the caller's pending chunks
//                                                               (called by the server itself, and by
//                                                               the upload page after attaching files)
//
// Login: MCP clients such as the Claude app discover Supabase Auth's OAuth 2.1
// server from the metadata below, sign the user in through the consent page,
// and send the resulting Supabase access token on every request. Each request
// then runs as that user, so Row Level Security applies to every query.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { loadAssistantName, serverInstructions } from "./lib/assistant.ts";
import { supabaseUrl, userClient, verifyAccessToken } from "./lib/db.ts";
import { embedPending, scheduleEmbedPending } from "./lib/embed.ts";
import type { ToolContext } from "./tools/_shared.ts";
import { registerListSpaces } from "./tools/list_spaces.ts";
import { registerCreateSpace } from "./tools/create_space.ts";
import { registerSaveItem } from "./tools/save_item.ts";
import { registerUpdateItem } from "./tools/update_item.ts";
import { registerGetItem } from "./tools/get_item.ts";
import { registerSearchItems } from "./tools/search_items.ts";
import { registerLinkItems } from "./tools/link_items.ts";
import { registerSaveSecret } from "./tools/save_secret.ts";
import { registerFindSecret } from "./tools/find_secret.ts";
import { registerGetSecret } from "./tools/get_secret.ts";
import { registerUpdateSecret } from "./tools/update_secret.ts";
import { registerDeleteSecret } from "./tools/delete_secret.ts";
import { registerSetAssistantName } from "./tools/set_assistant_name.ts";
import { registerAttachFile } from "./tools/attach_file.ts";
import { registerGetAttachmentLink } from "./tools/get_attachment_link.ts";
import { registerDescribeAttachment } from "./tools/describe_attachment.ts";
import { registerDeleteAttachment } from "./tools/delete_attachment.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id",
  "Access-Control-Expose-Headers": "mcp-session-id, www-authenticate",
};

function resourceUrl(): string {
  return `${supabaseUrl()}/functions/v1/mcp`;
}

function protectedResourceMetadata(): Response {
  return Response.json(
    {
      resource: resourceUrl(),
      authorization_servers: [`${supabaseUrl()}/auth/v1`],
      bearer_methods_supported: ["header"],
      resource_name: "Digital Assistant",
    },
    { headers: { ...CORS, "Cache-Control": "public, max-age=3600" } },
  );
}

function unauthorized(detail: string): Response {
  return Response.json(
    { error: "unauthorized", error_description: detail },
    {
      status: 401,
      headers: {
        ...CORS,
        "WWW-Authenticate":
          `Bearer resource_metadata="${resourceUrl()}/.well-known/oauth-protected-resource"`,
      },
    },
  );
}

function buildServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: "digital-assistant", version: "0.4.0" },
    { instructions: serverInstructions(ctx.assistantName) },
  );
  for (const register of [
    registerListSpaces,
    registerCreateSpace,
    registerSaveItem,
    registerUpdateItem,
    registerGetItem,
    registerSearchItems,
    registerLinkItems,
    registerSaveSecret,
    registerFindSecret,
    registerGetSecret,
    registerUpdateSecret,
    registerDeleteSecret,
    registerSetAssistantName,
    registerAttachFile,
    registerGetAttachmentLink,
    registerDescribeAttachment,
    registerDeleteAttachment,
  ]) {
    register(server, ctx);
  }
  return server;
}

Deno.serve(async (req: Request) => {
  const { pathname } = new URL(req.url);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (pathname.endsWith("/.well-known/oauth-protected-resource")) return protectedResourceMetadata();

  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return unauthorized("sign-in required");
  const userId = await verifyAccessToken(token);
  if (!userId) return unauthorized("invalid or expired token");

  const db = userClient(token);

  // Background indexing for long items: one batch per request, then hand off.
  if (req.method === "POST" && pathname.endsWith("/embed-pending")) {
    const result = await embedPending(db);
    if (result.remaining > 0) scheduleEmbedPending(token);
    return Response.json(result, { status: 202, headers: CORS });
  }

  // Stateless: a fresh server and transport per request, bound to this user.
  const assistantName = await loadAssistantName(db, userId);
  const server = buildServer({ db, userId, accessToken: token, assistantName });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const response = await transport.handleRequest(req);
  for (const [k, v] of Object.entries(CORS)) response.headers.set(k, v);
  return response;
});
