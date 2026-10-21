// The account's age status (docs/age-plan.md step 3, D44), read once per sign-in and shared by the
// screens that name drinks (Home's Cook row, Make a mocktail, a drink note, Settings → Account).
// Only "21 or over" or the month cocktails open ever comes back; never a birth date.
import { useCallback, useEffect, useState } from 'react';

import { loadAgeStatus, type AgeStatus } from '@/lib/age';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

let cached: { userId: string; status: AgeStatus | null } | null = null;
const listeners = new Set<() => void>();

/** After the one-time question is answered: every screen shows the new status. */
export function setAgeStatus(userId: string, status: AgeStatus) {
  cached = { userId, status };
  for (const l of listeners) l();
}

export function useAge(): { status: AgeStatus | null; loaded: boolean; reload: () => void } {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const [, tick] = useState(0);
  const load = useCallback(() => {
    if (!userId) return;
    void loadAgeStatus((fn, args) => supabase.rpc(fn, args)).then((status) => {
      // A failed read is not kept, so the next screen asks again.
      if (status) cached = { userId, status };
      tick((n) => n + 1);
    });
  }, [userId]);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    if (cached?.userId !== userId) load();
    return () => {
      listeners.delete(l);
    };
  }, [userId, load]);
  const mine = cached?.userId === userId ? cached : null;
  return { status: mine?.status ?? null, loaded: !!mine, reload: load };
}
