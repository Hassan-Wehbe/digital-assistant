// Opening a space from Home, All spaces or the one box: remembered on this phone for Home's recent
// list (homeSpaces.ts); the Tasks space opens the Tasks screen instead (its tasks grouped, with ticks).
import { router } from 'expo-router';
import { useCallback } from 'react';

import { useAuth } from './auth';
import { deviceRecentSpaces } from './deviceStorage';
import { isTasksSpace, rememberOpened } from './homeSpaces';

export function useOpenSpace(): (s: { id: string; path: string; restricted?: boolean }) => void {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  return useCallback(
    (s) => {
      if (isTasksSpace({ path: s.path, restricted: !!s.restricted })) {
        router.push('/tasks');
        return;
      }
      router.push({ pathname: '/space/[id]', params: { id: s.id, path: s.path } });
      // A restricted space is never remembered: it must not come up on Home (rule 3).
      if (userId && !s.restricted) {
        void deviceRecentSpaces
          .load(userId)
          .then((r) => deviceRecentSpaces.save(userId, rememberOpened(r, s.id)))
          .catch(() => {});
      }
    },
    [userId],
  );
}
