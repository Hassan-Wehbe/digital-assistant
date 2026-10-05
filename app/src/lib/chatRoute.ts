// Where a message from the box goes (docs/phase5-a5d-one-box-plan.md, step 4): the router's rules
// (router.ts) with the user's own names read from our server. Only a message that may be a name
// is read for: a sentence goes straight to Wilma with no extra call. Any failure (offline, an
// error, a sign-out under way) means Wilma, which then says what is wrong as it does today.

import { parseLookup, pickLookup, secretNames, type Route } from './router';
import type { SecretMeta, Space } from './wilma';

export interface RouteReads {
  /** All the user's spaces, restricted ones marked (the router leaves them out). */
  spaces(): Promise<Space[]>;
  /** The user's secrets matching these words (names and metadata only; never values). */
  findSecrets(query: string): Promise<SecretMeta[]>;
}

const WILMA: Route = { to: 'wilma' };

export async function routeMessage(text: string, reads: RouteReads): Promise<Route> {
  const lookup = parseLookup(text);
  if (!lookup) return WILMA;
  try {
    const [spaces, secrets] = await Promise.all([reads.spaces(), reads.findSecrets(lookup.query)]);
    return pickLookup(lookup, spaces, secretNames(secrets));
  } catch {
    return WILMA;
  }
}
