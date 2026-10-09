// Delete my account (docs/signup-plan.md step 3, design D29): the app's Settings → Delete account.
// The caller's sign-in says who they are (CLAUDE.md rule 5); the password is checked again, and
// the app has the person type DELETE. Then their files in Storage go, then the sign-in itself,
// which removes app_user and every row they own (the schema's `on delete cascade`): spaces,
// notes and their revisions, the vault and its access log, usage, invite use.
//
// Only this function uses the service-role key, and only for the caller's own id after both
// checks. Nothing about the person is logged: no email, no password, no file names.
//
//   POST /functions/v1/delete-account   Bearer token; {"password": "...", "confirm": "DELETE"}

export interface Caller {
  id: string;
  email: string;
}

export interface DeleteDeps {
  /** The signed-in caller, or null for a missing, expired or fake token. */
  verifyToken(token: string): Promise<Caller | null>;
  /** True when the password is this account's sign-in password. */
  checkPassword(email: string, password: string): Promise<boolean>;
  /** Every file under the caller's folder in the attachments bucket. */
  listFiles(userId: string): Promise<string[]>;
  removeFiles(paths: string[]): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  log(entry: { event: string; status: number }): void;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const WRONG_PASSWORD = "The password is not right.";
export const NOT_DELETED = "Your account was not deleted. Try again in a moment.";

export function createHandler(deps: DeleteDeps) {
  return async (req: Request): Promise<Response> => {
    const done = (status: number, body: unknown) => {
      deps.log({ event: "delete_account", status });
      return json(status, body);
    };
    if (req.method !== "POST") return json(405, { error: "POST only" });
    const token = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
    const caller = token ? await deps.verifyToken(token).catch(() => null) : null;
    if (!caller) return json(401, { error: "Sign in again first." });

    let body: { password?: unknown; confirm?: unknown };
    try {
      body = await req.json();
    } catch {
      return done(400, { error: "Send the password and DELETE." });
    }
    if (body.confirm !== "DELETE") return done(400, { error: "Type DELETE to confirm." });
    if (typeof body.password !== "string" || !body.password) return done(400, { error: "Enter your password." });
    if (!(await deps.checkPassword(caller.email, body.password).catch(() => false))) {
      return done(403, { error: WRONG_PASSWORD });
    }

    try {
      const files = await deps.listFiles(caller.id);
      // Only the caller's own folder, whatever the listing returned.
      const own = files.filter((p) => p.startsWith(`${caller.id}/`));
      for (let i = 0; i < own.length; i += 100) await deps.removeFiles(own.slice(i, i + 100));
      await deps.deleteUser(caller.id);
    } catch {
      return done(500, { error: NOT_DELETED });
    }
    return done(200, { deleted: true });
  };
}
