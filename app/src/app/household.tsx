// Settings → Household (planners step 1, docs/planners-plan.md; design D40): who is in the family,
// for Family day. Each person a name or label, adult or child, and for a child an optional birth
// year (lib/household.ts). Tap one to change it, ↑ ↓ to reorder, Remove (asked first; gone for good,
// it's a setting). Optional (Q10): Family day works without it. Wilma's AI is told only roles and
// ages when planning, never these names (Q4). Text that looks like a password is refused before
// anything is sent (rule 9).
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import { Chips } from '@/components/PlaceFields';
import { Button, Card, confirm, ErrorBox, GroupList, GroupRow, Loading, Muted, space, styles, TextLink, useColors, useLoad } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  addMember, changeMember, listMembers, MAX_LABEL, MAX_MEMBERS, memberLine, moveMember, NOT_SAVED, removeMember,
  type HouseholdDb, type Member, type MemberKind,
} from '@/lib/household';
import { supabase } from '@/lib/supabase';

type Editing = { id: string | null; label: string; kind: MemberKind; birthYear: string } | null;

const KINDS: { value: MemberKind; label: string }[] = [
  { value: 'adult', label: 'Adult' },
  { value: 'child', label: 'Child' },
];

export default function Household() {
  const c = useColors();
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const db = supabase as unknown as HouseholdDb;
  const loaded = useLoad(`household:${userId}`, () => listMembers(db));
  const [list, setList] = useState<Member[] | null>(null);
  const members = list ?? loaded.data ?? null;
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thisYear] = useState(() => new Date().getFullYear());

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    const fields = { label: editing.label, kind: editing.kind, birthYear: editing.birthYear };
    const out = editing.id ? await changeMember(db, editing.id, fields, thisYear) : await addMember(db, fields, thisYear);
    setBusy(false);
    if ('error' in out) return setError(out.error);
    const now = members ?? [];
    setList(editing.id ? now.map((m) => (m.id === out.member.id ? out.member : m)) : [...now, out.member]);
    setEditing(null);
  };

  const remove = async (m: Member) => {
    if (!(await confirm(`Remove ${m.label}?`, 'They are taken out of your household for good. You can add them again later.', 'Remove'))) return;
    setBusy(true);
    const ok = await removeMember(db, m.id);
    setBusy(false);
    if (!ok) return setError(NOT_SAVED);
    setList((members ?? []).filter((x) => x.id !== m.id));
    setEditing(null);
  };

  const move = async (m: Member, by: -1 | 1) => {
    if (!members) return;
    setBusy(true);
    const next = await moveMember(db, members, m.id, by);
    setBusy(false);
    if (next) setList(next);
    else setError(NOT_SAVED);
  };

  const input = [styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.card }];

  const form = editing ? (
    <Card style={{ gap: space.s }}>
      <Text style={[styles.title, { color: c.text }]}>{editing.id ? 'Change' : 'Add someone'}</Text>
      <TextInput
        style={input}
        placeholder="A name or a label, like Sam or Kid 1"
        placeholderTextColor={c.muted}
        maxLength={MAX_LABEL}
        value={editing.label}
        onChangeText={(label) => setEditing({ ...editing, label })}
        editable={!busy}
        accessibilityLabel="Name or label"
      />
      <Chips options={KINDS} selected={(v) => v === editing.kind} onPress={(kind) => setEditing({ ...editing, kind })} disabled={busy} />
      {editing.kind === 'child' ? (
        <TextInput
          style={input}
          placeholder="Birth year (optional), like 2018"
          placeholderTextColor={c.muted}
          keyboardType="number-pad"
          maxLength={4}
          value={editing.birthYear}
          onChangeText={(birthYear) => setEditing({ ...editing, birthYear: birthYear.replace(/\D/g, '') })}
          editable={!busy}
          accessibilityLabel="Birth year"
        />
      ) : null}
      {error ? <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.s, flexWrap: 'wrap' }}>
        {editing.id ? (
          <Button title="Remove" kind="danger" disabled={busy} onPress={() => void remove(members!.find((m) => m.id === editing.id)!)} />
        ) : null}
        <Button title="Cancel" kind="plain" disabled={busy} onPress={() => setEditing(null)} />
        <Button title={busy ? 'Saving…' : 'Save'} disabled={busy} onPress={() => void save()} />
      </View>
    </Card>
  ) : null;

  return (
    <>
      <Stack.Screen options={{ title: 'Household' }} />
      <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <Muted>
          Who is in your family, so Family day fits everyone. A name or a label is enough, and a birth year for a child. Wilma’s AI is told only “adult” or a
          child’s age when planning, never these names.
        </Muted>
        {loaded.error && !members ? <ErrorBox message={loaded.error} onRetry={loaded.reload} /> : null}
        {!members ? (
          loaded.error ? null : <Loading />
        ) : members.length ? (
          <GroupList>
            {members.map((m, i) => (
              <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <GroupRow
                    first={i === 0}
                    title={memberLine(m, thisYear)}
                    onPress={() => {
                      setError(null);
                      setEditing({ id: m.id, label: m.label, kind: m.kind, birthYear: m.birth_year ? String(m.birth_year) : '' });
                    }}
                  />
                </View>
                {members.length > 1 && !busy ? (
                  <View style={{ flexDirection: 'row', gap: space.s, paddingHorizontal: space.s }}>
                    {i > 0 ? <TextLink title="↑" accessibilityLabel={`Move ${m.label} up`} onPress={() => void move(m, -1)} /> : null}
                    {i < members.length - 1 ? <TextLink title="↓" accessibilityLabel={`Move ${m.label} down`} onPress={() => void move(m, 1)} /> : null}
                  </View>
                ) : null}
              </View>
            ))}
          </GroupList>
        ) : (
          <Muted>No one yet. Family day still works: it asks how many adults and kids each time.</Muted>
        )}
        {form}
        {!editing && members && members.length < MAX_MEMBERS ? (
          <Button
            title="＋ Add someone"
            kind="plain"
            onPress={() => {
              setError(null);
              setEditing({ id: null, label: '', kind: members.length ? 'child' : 'adult', birthYear: '' });
            }}
          />
        ) : null}
        {members && members.length >= MAX_MEMBERS ? <Muted>{`A household holds up to ${MAX_MEMBERS} people.`}</Muted> : null}
        {error && !editing ? <Text style={{ color: c.danger, fontSize: 15 }}>{error}</Text> : null}
      </ScrollView>
    </>
  );
}
