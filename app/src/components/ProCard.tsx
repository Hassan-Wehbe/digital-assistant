// The Pro card (day planner step 4; mockups screen 0): what My day does, "Not now" and "See Pro".
// Buying Pro comes later (Google Play Billing), so See Pro says so. The server decides who has
// Pro; this card only explains, before asking it or after it said pro_required.
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useAuth } from '@/lib/auth';
import { loadPlan, PRO_COMING, PRO_FREE, PRO_TEXT, PRO_TITLE, type Plan } from '@/lib/pro';
import { supabase } from '@/lib/supabase';

import { Button, Card, Muted, space, styles, useColors, useLoad, useReloadOnReturn } from './ui';

export function ProCard({ onNotNow }: { onNotNow?: () => void }) {
  const c = useColors();
  const [asked, setAsked] = useState(false);
  return (
    <Card>
      <Text style={[styles.title, { color: c.text }]}>{PRO_TITLE}</Text>
      <Text style={{ color: c.text, fontSize: 15, lineHeight: 21 }}>{PRO_TEXT}</Text>
      <Muted>{PRO_FREE}</Muted>
      {asked ? <Text style={{ color: c.text, fontSize: 15, lineHeight: 21 }}>{PRO_COMING}</Text> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.s }}>
        {onNotNow ? <Button title="Not now" kind="plain" onPress={onNotNow} /> : null}
        <Button title="See Pro" onPress={() => setAsked(true)} />
      </View>
    </Card>
  );
}

/**
 * The signed-in person's plan: undefined while it is first read, null when it could not be read
 * (the server decides then). Read again when the screen comes back; the last answer stays meanwhile.
 */
export function useProPlan(): Plan | null | undefined {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const { data, loading, reload } = useLoad(`plan:${userId}`, () =>
    userId ? loadPlan(() => supabase.from('app_user').select('plan').eq('id', userId).maybeSingle()) : Promise.resolve(null),
  );
  useReloadOnReturn(reload);
  return data ?? (loading ? undefined : null);
}
