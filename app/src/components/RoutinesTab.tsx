// Tasks → Routines (routines step 3b, mockup 5): each routine with its schedule, its tasks and how
// many are done this time ("2 of 4 done this week", "Done for October"), a line for a task missed
// last time (Q6), and the repeating tasks that belong to no routine at the bottom. ☐ ticks a task
// (the server moves it to the routine's next period); tap a routine to edit it.
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button, ErrorBox, GroupList, Loading, Muted, space, styles, useColors, useLoad, useReloadOnReturn } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { loadRoutines } from '@/lib/routines';
import { taskLine, type TaskRow } from '@/lib/tasks';

export function RoutinesTab({ today }: { today: string }) {
  const c = useColors();
  const { wilma } = useAuth();
  const { data, error, loading, reload } = useLoad(`routines:${today}`, () => loadRoutines(wilma, today));
  useReloadOnReturn(reload);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const tick = async (t: TaskRow, done: boolean) => {
    setBusy(t.id);
    setProblem(null);
    try {
      await wilma.taskDone(t.id, done, today);
      reload();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not change the task.');
    } finally {
      setBusy(null);
    }
  };

  const box = (t: TaskRow, done: boolean, i: number) => (
    <View key={t.id} style={[{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: space.xs }, i > 0 && { borderTopWidth: 1, borderTopColor: c.line }]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done, busy: busy === t.id }}
        accessibilityLabel={done ? `“${t.title}” is done this time` : `Mark “${t.title}” done`}
        disabled={busy !== null || done}
        onPress={() => void tick(t, true)}
        hitSlop={8}>
        <Text style={{ fontSize: 20, color: c.accent }}>{done ? '☑' : '☐'}</Text>
      </Pressable>
      <Pressable style={{ flex: 1, gap: 2 }} accessibilityRole="button" onPress={() => router.push({ pathname: '/item/[id]', params: { id: t.id } })}>
        <Text style={{ color: done ? c.muted : c.text, fontSize: 15, textDecorationLine: done ? 'line-through' : 'none' }}>
          {`${t.title}${t.duration_min ? ` · ${t.duration_min} min` : ''}`}
        </Text>
      </Pressable>
    </View>
  );

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <View style={{ gap: space.m, opacity: loading ? 0.7 : 1 }}>
      {problem ? <Text style={{ color: c.danger, fontSize: 15 }}>{problem}</Text> : null}
      <Button title="＋ New routine" kind="plain" onPress={() => router.push('/routine')} />
      {!data.routines.length ? (
        <Muted>
          {'No routines yet. A routine is a group of tasks that comes back each week, every two weeks or each month, like “Weekend house reset: laundry, vacuum, groceries”. Wilma offers them in My day when there’s free time.'}
        </Muted>
      ) : null}
      {data.routines.map((r) => (
        <View key={r.id} style={{ gap: space.xs }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit routine ${r.title}`}
            onPress={() => router.push({ pathname: '/routine', params: { id: r.id } })}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'baseline', gap: space.s }, pressed && { opacity: 0.6 }]}>
            <Text style={[styles.title, { color: c.text, flex: 1 }]} numberOfLines={1}>{`🔁 ${r.title}`}</Text>
            <Text style={{ color: c.accent, fontSize: 14, fontWeight: '600' }}>Edit</Text>
          </Pressable>
          <Muted>{`${r.words}${r.routine.suggest ? '' : ' · not suggested in My day'} · ${r.progress}`}</Muted>
          {r.tasks.length ? (
            <GroupList>
              <View style={{ paddingHorizontal: space.m, paddingVertical: space.xs }}>{r.tasks.map((t, i) => box(t, t.doneThisTime, i))}</View>
            </GroupList>
          ) : null}
          {r.missed.map((m) => (
            <Text key={m} style={{ color: c.warn, fontSize: 13 }}>{m}</Text>
          ))}
        </View>
      ))}
      {data.alone.length ? (
        <View style={{ gap: space.xs }}>
          <Text style={[styles.title, { color: c.text }]}>Repeating on their own</Text>
          <GroupList>
            <View style={{ paddingHorizontal: space.m, paddingVertical: space.xs }}>
              {data.alone.map((t, i) => (
                <View key={t.id} style={[{ paddingVertical: space.xs }, i > 0 && { borderTopWidth: 1, borderTopColor: c.line }]}>
                  <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/item/[id]', params: { id: t.id } })}>
                    <Text style={{ color: c.text, fontSize: 15 }}>{t.title}</Text>
                    {taskLine(t, today) ? <Muted>{taskLine(t, today)}</Muted> : null}
                  </Pressable>
                </View>
              ))}
            </View>
          </GroupList>
        </View>
      ) : null}
    </View>
  );
}
