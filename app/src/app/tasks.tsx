// Tasks (day planner step 2, step 5; mockups section 4): today (overdue first), this week, later,
// and done. ☐ marks a task done (a repeating one moves to its next date, from the phone's date);
// tap a task to open it. Tasks in restricted spaces are never listed (find_tasks, rule 3).
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { ErrorBox, GroupList, Loading, Muted, space, styles, TextLink, useColors, useLoad, useReloadOnReturn } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { todayAndTomorrow } from '@/lib/dayView';
import { groupTasks, taskLine, type TaskRow } from '@/lib/tasks';

export default function Tasks() {
  const c = useColors();
  const { wilma } = useAuth();
  const [today] = useState(() => todayAndTomorrow(new Date()).today);
  const { data, error, loading, reload } = useLoad(`tasks:${today}`, () => wilma.findTasks({ status: 'all', today }));
  useReloadOnReturn(reload);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const tick = async (t: TaskRow) => {
    setBusy(t.id);
    setProblem(null);
    try {
      await wilma.taskDone(t.id, t.status !== 'done', today);
      reload();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not change the task.');
    } finally {
      setBusy(null);
    }
  };

  const groups = data ? groupTasks(data, today) : null;
  const section = (title: string, list: TaskRow[]) =>
    list.length ? (
      <View key={title} style={{ gap: space.s }}>
        <Text style={[styles.title, { color: c.text }]}>{title}</Text>
        <GroupList>
          {list.map((t, i) => (
            <View
              key={t.id}
              style={[{ flexDirection: 'row', alignItems: 'center', gap: space.s, padding: space.m }, i > 0 && { borderTopWidth: 1, borderTopColor: c.line }]}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: t.status === 'done', busy: busy === t.id }}
                accessibilityLabel={t.status === 'done' ? `Open “${t.title}” again` : `Mark “${t.title}” done`}
                disabled={busy !== null}
                onPress={() => void tick(t)}
                hitSlop={8}>
                <Text style={{ fontSize: 20, color: c.accent }}>{t.status === 'done' ? '☑' : '☐'}</Text>
              </Pressable>
              <Pressable style={{ flex: 1, gap: 2 }} accessibilityRole="button" onPress={() => router.push({ pathname: '/item/[id]', params: { id: t.id } })}>
                <Text style={{ color: t.status === 'done' ? c.muted : c.text, fontSize: 16, fontWeight: '600', textDecorationLine: t.status === 'done' ? 'line-through' : 'none' }}>
                  {t.title}
                </Text>
                {t.status === 'open' && taskLine(t, today) ? <Muted>{taskLine(t, today)}</Muted> : null}
              </Pressable>
            </View>
          ))}
        </GroupList>
      </View>
    ) : null;

  return (
    <>
      <Stack.Screen options={{ title: 'Tasks', headerRight: () => <TextLink title="＋ New" onPress={() => router.push('/task')} /> }} />
      <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} />}>
        {error ? <ErrorBox message={error} onRetry={reload} /> : null}
        {problem ? <Text style={{ color: c.danger, fontSize: 15 }}>{problem}</Text> : null}
        {!groups ? (
          error ? null : <Loading />
        ) : !data?.length ? (
          <Muted>No tasks yet. Tap ＋ New, or tell Wilma: “remind me to return the library books by Saturday, 15 minutes”.</Muted>
        ) : (
          <>
            {section('Today', groups.today)}
            {section('This week', groups.week)}
            {section('Later', groups.later)}
            {section('Done', groups.done.slice(0, 20))}
          </>
        )}
      </ScrollView>
    </>
  );
}
