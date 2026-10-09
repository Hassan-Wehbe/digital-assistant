// The delete-account function (docs/signup-plan.md step 3) through its HTTP handler, with
// stand-ins for Supabase: only the caller's own data goes, only after the sign-in, the password
// and DELETE; nothing about the person is logged or sent back.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { type Caller, createHandler, type DeleteDeps, NOT_DELETED, WRONG_PASSWORD } from "../../supabase/functions/delete-account/handler.ts";

const A: Caller = { id: "00000000-0000-4000-a000-00000000000a", email: "a@example.invalid" };
const B: Caller = { id: "00000000-0000-4000-a000-00000000000b", email: "b@example.invalid" };
const PASSWORD = "correct horse battery";

function setup(opts: { failRemove?: boolean } = {}) {
  const users = new Map([["token-a", A], ["token-b", B]]);
  const files = [`${A.id}/f1/photo.jpg`, `${A.id}/f2/plan.vsdx`, `${B.id}/f3/b.png`];
  const state = { deleted: [] as string[], removed: [] as string[], logs: [] as string[], listed: [] as string[] };
  const deps: DeleteDeps = {
    verifyToken: async (t) => users.get(t) ?? null,
    checkPassword: async (email, password) => password === PASSWORD && [A.email, B.email].includes(email),
    // A listing that wrongly includes someone else's file: the handler must still skip it.
    listFiles: async (id) => {
      state.listed.push(id);
      return files.filter((f) => f.startsWith(id)).concat(`${B.id}/f3/b.png`);
    },
    removeFiles: async (paths) => {
      if (opts.failRemove) throw new Error("storage down");
      state.removed.push(...paths);
    },
    deleteUser: async (id) => void state.deleted.push(id),
    log: (e) => void state.logs.push(JSON.stringify(e)),
  };
  return { handler: createHandler(deps), state };
}

const post = (body: unknown, token?: string) =>
  new Request("http://x/delete-account", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

Deno.test("deletes only the caller's files, then the caller's sign-in", async () => {
  const { handler, state } = setup();
  const res = await handler(post({ password: PASSWORD, confirm: "DELETE" }, "token-a"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { deleted: true });
  assertEquals(state.listed, [A.id]);
  assertEquals(state.removed, [`${A.id}/f1/photo.jpg`, `${A.id}/f2/plan.vsdx`]);
  assertEquals(state.deleted, [A.id]);
});

Deno.test("refuses without a sign-in, or with a fake one", async () => {
  for (const token of [undefined, "fake"]) {
    const { handler, state } = setup();
    const res = await handler(post({ password: PASSWORD, confirm: "DELETE" }, token));
    assertEquals(res.status, 401);
    assertEquals(state.deleted, []);
    assertEquals(state.removed, []);
  }
});

Deno.test("refuses a wrong password, and another account's password does not help", async () => {
  const { handler, state } = setup();
  const res = await handler(post({ password: "guess", confirm: "DELETE" }, "token-a"));
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, WRONG_PASSWORD);
  assertEquals(state.deleted, []);
  assertEquals(state.listed, []);
});

Deno.test("needs DELETE typed, a password and a JSON body; POST only", async () => {
  const { handler, state } = setup();
  for (const body of [{ password: PASSWORD }, { password: PASSWORD, confirm: "delete" }, { confirm: "DELETE" }, "not json"]) {
    assertEquals((await handler(post(body, "token-a"))).status, 400);
  }
  assertEquals((await handler(new Request("http://x/delete-account", { method: "GET" }))).status, 405);
  assertEquals(state.deleted, []);
});

Deno.test("when Storage fails, the account is kept and the person is told", async () => {
  const { handler, state } = setup({ failRemove: true });
  const res = await handler(post({ password: PASSWORD, confirm: "DELETE" }, "token-a"));
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, NOT_DELETED);
  assertEquals(state.deleted, []);
});

Deno.test("logs carry no email, password or file name", async () => {
  const { handler, state } = setup();
  await handler(post({ password: PASSWORD, confirm: "DELETE" }, "token-a"));
  await handler(post({ password: "guess", confirm: "DELETE" }, "token-b"));
  const all = state.logs.join("\n");
  assert(state.logs.length === 2);
  for (const secret of [A.email, B.email, PASSWORD, "guess", "photo.jpg", A.id]) assert(!all.includes(secret), secret);
});
