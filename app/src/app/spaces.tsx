// All spaces (Home's "All spaces"), D38: the favourites first (Edit: move up or down, remove, and a
// tap on a space below adds it), then every other space as a chip, then the restricted ones, dimmed
// and never opened from here (CLAUDE.md rule 3), and + New space. The Tasks space opens the Tasks
// screen. A restricted space, one under a restricted space and Tasks are never offered as a
// favourite (the server refuses them too).
import { router, Stack } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { ErrorBox, GroupList, GroupRow, Loading, Muted, space, styles, TextLink, useColors, useLoad, useReloadOnReturn } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { canBeFavourite, loadFavourites, moveFavourite, saveFavourites, toggleFavourite } from '@/lib/favourites';
import { favouriteSpaces, isTasksSpace } from '@/lib/homeSpaces';
import { spaceTitle } from '@/lib/memory';
import { useOpenSpace } from '@/lib/openSpace';
import { supabase } from '@/lib/supabase';
import type { Space } from '@/lib/wilma';

const rpc = (fn: string, args?: Record<string, unknown>) => supabase.rpc(fn, args);

export default function SpacesScreen() {
  const c = useColors();
  const { wilma, session } = useAuth();
  const open = useOpenSpace();
  const { data, error, loading, reload } = useLoad('spaces:all', () => wilma.listSpaces());
  useReloadOnReturn(reload);
  const [editing, setEditing] = useState(false);
  // What was just saved, shown until the next load; and the server's or the limit's message.
  const [saved, setSaved] = useState<string[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const favs = useLoad(`favourites:${session?.user.id ?? ''}`, () => loadFavourites(rpc));
  const reloadFavs = favs.reload;
  // Back from a space (its ☆ may have changed the list): read it again, dropping what was saved here.
  useReloadOnReturn(
    useCallback(() => {
      setSaved(null);
      reloadFavs();
    }, [reloadFavs]),
  );

  const spaces = data ?? [];
  const ids = saved ?? favs.data ?? [];
  const favourites = favouriteSpaces(spaces, ids);
  // Saved from what is shown, so a favourite the server no longer returns is never sent back.
  const shownIds = favourites.map((s) => s.id);
  const favIds = new Set(shownIds);
  const others = spaces.filter((s) => !s.restricted && !favIds.has(s.id));
  const locked = spaces.filter((s) => s.restricted);

  const save = async (next: string[]) => {
    setBusy(true);
    setProblem(null);
    try {
      setSaved(await saveFavourites(rpc, next));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const add = (s: Space) => {
    const out = toggleFavourite(shownIds, s.id);
    if (out.error) setProblem(out.error);
    else void save(out.list);
  };

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.list}>
      <Stack.Screen options={{ title: 'All spaces' }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[styles.title, { color: c.text }]}>{`${spaces.length} ${spaces.length === 1 ? 'space' : 'spaces'}`}</Text>
        <TextLink title="+ New space" onPress={() => router.push('/new-space')} />
      </View>
      {error ? <ErrorBox message={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}

      {spaces.length ? (
        <View style={{ gap: space.s }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Section text="FAVOURITES ON HOME" />
            <TextLink title={editing ? 'Done' : 'Edit'} onPress={() => setEditing((e) => !e)} />
          </View>
          {favourites.length ? (
            <GroupList>
              {favourites.map((sp, i) => (
                <View
                  key={sp.id}
                  style={{ flexDirection: 'row', alignItems: 'center', borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                  <View style={{ flex: 1 }}>
                    <GroupRow first title={`★ ${spaceTitle(sp)}`} onPress={editing ? undefined : () => open(sp)} />
                  </View>
                  {editing ? (
                    <View style={{ flexDirection: 'row', paddingRight: space.s }}>
                      <RowButton label={`Move ${sp.path} up`} text="↑" disabled={busy || i === 0} onPress={() => void save(moveFavourite(shownIds, sp.id, -1))} />
                      <RowButton
                        label={`Move ${sp.path} down`}
                        text="↓"
                        disabled={busy || i === favourites.length - 1}
                        onPress={() => void save(moveFavourite(shownIds, sp.id, 1))}
                      />
                      <RowButton label={`Remove ${sp.path} from favourites`} text="✕" disabled={busy} onPress={() => void save(shownIds.filter((x) => x !== sp.id))} />
                    </View>
                  ) : null}
                </View>
              ))}
            </GroupList>
          ) : (
            <Muted>{editing ? 'Tap a space below to add it.' : 'None yet. Tap Edit, or ☆ on a space, to keep up to 6 on Home.'}</Muted>
          )}
          {editing && favourites.length ? <Muted>Tap a space below to add it.</Muted> : null}
          {problem ? <Muted>{problem}</Muted> : null}

          {others.length ? <Section text={favourites.length ? 'MORE SPACES' : 'YOUR SPACES'} /> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
            {others.map((sp) => {
              const addable = editing && canBeFavourite(sp, spaces);
              // While editing, a space that cannot be a favourite (Tasks, one under a restricted space) does nothing.
              const onPress = editing ? (addable && !busy ? () => add(sp) : undefined) : () => open(sp);
              return (
                <Pressable
                  key={sp.id}
                  accessibilityRole="button"
                  accessibilityLabel={addable ? `Add ${sp.path} to favourites` : isTasksSpace(sp) ? 'Open your tasks' : `Open ${sp.path}`}
                  accessibilityState={{ disabled: !onPress }}
                  disabled={!onPress}
                  onPress={onPress}
                  style={({ pressed }) => [
                    { minHeight: 40, justifyContent: 'center', paddingHorizontal: space.m, borderRadius: 20, borderWidth: 1, borderColor: c.line, backgroundColor: c.card },
                    !onPress && { opacity: 0.45 },
                    pressed && { opacity: 0.6 },
                  ]}>
                  <Text style={{ color: c.text, fontSize: 14 }}>{`${addable ? '☆ ' : ''}${spaceTitle(sp)}`}</Text>
                </Pressable>
              );
            })}
          </View>

          {locked.length ? (
            <>
              <Section text="LOCKED" />
              <GroupList>
                {locked.map((sp, i) => (
                  <GroupRow key={sp.id} first={i === 0} dimmed title={`🔒 ${sp.path}`} subtitle="Restricted" />
                ))}
              </GroupList>
            </>
          ) : null}
        </View>
      ) : !loading && !error ? (
        <Muted>No spaces yet. Tap “+ New space” to create one.</Muted>
      ) : null}
      <View style={{ height: space.l }} />
    </ScrollView>
  );
}

function RowButton({ label, text, onPress, disabled }: { label: string; text: string; onPress: () => void; disabled?: boolean }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, (disabled || pressed) && { opacity: 0.35 }]}>
      <Text style={{ color: c.accent, fontSize: 18, fontWeight: '700' }}>{text}</Text>
    </Pressable>
  );
}

function Section({ text }: { text: string }) {
  const c = useColors();
  return <Text style={{ color: c.muted, fontSize: 12, fontWeight: '600', letterSpacing: 0.6 }}>{text}</Text>;
}
