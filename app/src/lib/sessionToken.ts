// The access token for a call to Wilma, from the saved session.
//
// Signing out is kept for a session that is really gone. A refresh that fails for
// lack of a connection must not sign the user out: they would have to type their
// password again after every dead spot (and after app updates, which keep the session).

export interface SessionSource {
  getSession(): Promise<{ data: { session: { access_token: string } | null }; error: unknown }>;
  signOutLocally(): Promise<unknown>;
  isConnectionError(error: unknown): boolean;
}

export async function sessionToken(src: SessionSource): Promise<string | null> {
  const { data, error } = await src.getSession();
  if (error && src.isConnectionError(error)) throw error; // keep the session; the call reports "could not reach"
  const token = data.session?.access_token ?? null;
  if (!token) await src.signOutLocally(); // gone or unreadable: back to the sign-in screen
  return token;
}
