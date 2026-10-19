// The chat's 🔁 Save routine card (routines step 4, D39): read from the stream and from a saved
// chat, nothing saved without the tap, the tap saving the routine then its tasks, a stop half way
// finished by Try again without saving anything twice, and a password held on the phone (rule 9).
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { routineCardLine, saveRoutineCard, toRoutineCard, type RoutineCardData, type RoutineSaver } from './chatRoutine';
import { toEntry } from './chatStore';
import { readChatEvents, toChatEvent, type ChatEvent } from './chatStream';
import { chatReducer, initialChat, type ChatState } from './chatThread';
import { LOOKS_LIKE_SECRET } from './noteEdit';

const ROUTINE_ID = '2b7c1f0e-4d1a-4c55-9a7e-3f1d2c3b4a59';
const EVENT = {
  type: 'routine_save', name: 'Weekend house reset', repeat: 'weekly', when: 'same_day', day: 6, suggest: true,
  tasks: [{ title: 'Laundry' }, { title: 'Vacuum', minutes: 30 }],
};
const CARD: RoutineCardData = {
  name: 'Weekend house reset',
  routine: { repeat: 'weekly', when: 'same_day', day: 6, suggest: true },
  tasks: [{ title: 'Laundry' }, { title: 'Vacuum', minutes: 30 }],
};

const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8');

function chunks(lines: unknown[]): AsyncIterable<Uint8Array> {
  const text = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  return (async function* () {
    yield new TextEncoder().encode(text);
  })();
}

function answer(events: ChatEvent[]): ChatState {
  let s = chatReducer(initialChat(), { type: 'send', text: 'make my Saturday chores a weekly routine' });
  for (const event of events) s = chatReducer(s, { type: 'event', event });
  return s;
}

describe('the 🔁 card from the stream', () => {
  it('is read from the server’s routine_save event, field by field', async () => {
    const got: ChatEvent[] = [];
    for await (const e of readChatEvents(chunks([{ type: 'text', text: 'Here it is.' }, EVENT, { type: 'done', counted: true }]))) got.push(e);
    expect(got[1]).toEqual({ type: 'routine_save', ...CARD });
    expect(toChatEvent({ ...EVENT, name: '' })).toBeNull();
    expect(toChatEvent({ ...EVENT, repeat: 'daily' })).toBeNull();
    expect(toChatEvent({ ...EVENT, when: 'by_day', day: 6 })).toBeNull();
    expect(toChatEvent({ ...EVENT, tasks: [] })).toBeNull();
    expect(toChatEvent({ ...EVENT, tasks: [{ title: '' }] })).toBeNull();
    // An odd minutes is dropped, not the card.
    expect(toRoutineCard({ ...EVENT, tasks: [{ title: 'Vacuum', minutes: -5 }] })!.tasks).toEqual([{ title: 'Vacuum' }]);
  });

  it('becomes a card in the thread; the thread never saves anything', () => {
    let s = answer([{ type: 'text', text: 'Tap Save routine.' }, toChatEvent(EVENT)!, { type: 'done', counted: true }]);
    const card = s.entries.find((e) => e.kind === 'routine')!;
    expect(card).toEqual({ kind: 'routine', id: expect.any(String), ...CARD });
    for (const file of ['chatThread.ts', 'chatStream.ts', 'chatStore.ts', 'chat.tsx']) {
      expect(read(file)).not.toMatch(/saveRoutine|saveTask/);
    }
    s = chatReducer(s, { type: 'routine_saved', id: card.id, routineId: ROUTINE_ID });
    expect(s.entries.find((e) => e.id === card.id)).toMatchObject({ kind: 'routine', saved: ROUTINE_ID });
    expect(chatReducer(s, { type: 'routine_saved', id: s.entries[0].id, routineId: ROUTINE_ID })).toBe(s);
  });

  it('the card saves only from its one button', () => {
    const card = read('../components/RoutineCard.tsx');
    expect(card.match(/saveRoutineCard\(/g)).toHaveLength(1);
    expect(card.match(/void save\(\)/g)).toHaveLength(1);
  });

  it('says the schedule and how many tasks', () => {
    expect(routineCardLine(CARD)).toBe('Every Saturday · 2 tasks');
    expect(routineCardLine({ ...CARD, routine: { repeat: 'monthly', when: 'any_day', suggest: false }, tasks: [{ title: 'Filter' }] })).toBe(
      'Any day each month · 1 task · not suggested in My day',
    );
  });
});

describe('the 🔁 card from a saved chat', () => {
  it('comes back with its routine and, once saved, the routine’s id', () => {
    expect(toEntry({ kind: 'routine', id: '4', ...CARD, saved: ROUTINE_ID })).toEqual({ kind: 'routine', id: '4', ...CARD, saved: ROUTINE_ID });
    expect(toEntry({ kind: 'routine', id: '5', ...CARD })).toEqual({ kind: 'routine', id: '5', ...CARD });
    expect(toEntry({ kind: 'routine', id: '6', ...CARD, saved: 'yes' })).toEqual({ kind: 'routine', id: '6', ...CARD });
    expect(toEntry({ kind: 'routine', id: '7', ...CARD, tasks: [] })).toBeNull();
  });
});

describe('Save routine', () => {
  const saver = (failAt = -1) => {
    const calls: string[] = [];
    const w: RoutineSaver = {
      saveRoutine: async (r) => {
        calls.push(`routine ${r.title} ${JSON.stringify(r.metadata)}`);
        if (failAt === 0) throw new Error('offline');
        return { id: ROUTINE_ID };
      },
      saveTask: async (t) => {
        calls.push(`task ${t.title} ${JSON.stringify(t.metadata)}`);
        if (calls.length - 1 === failAt) throw new Error('offline');
        return { id: `t${calls.length}` };
      },
    };
    return { w, calls };
  };

  it('saves the routine, then each task naming it', async () => {
    const { w, calls } = saver();
    const steps: unknown[] = [];
    await expect(saveRoutineCard(w, CARD, null, (p) => steps.push(p))).resolves.toEqual({ routineId: ROUTINE_ID });
    expect(calls).toEqual([
      'routine Weekend house reset {"repeat":"weekly","when":"same_day","suggest":true,"day":6}',
      `task Laundry {"status":"open","priority":"normal","routine_id":"${ROUTINE_ID}"}`,
      `task Vacuum {"status":"open","priority":"normal","routine_id":"${ROUTINE_ID}","duration_min":30}`,
    ]);
    expect(steps.at(-1)).toEqual({ routineId: ROUTINE_ID, tasksSaved: 2 });
  });

  it('a stop half way: Try again adds only what is missing, never a second routine', async () => {
    const { w, calls } = saver(2);
    let progress: { routineId: string; tasksSaved: number } | null = null;
    await expect(saveRoutineCard(w, CARD, null, (p) => (progress = p))).rejects.toThrow('offline');
    expect(progress).toEqual({ routineId: ROUTINE_ID, tasksSaved: 1 });
    const again = saver();
    await expect(saveRoutineCard(again.w, CARD, progress, () => {})).resolves.toEqual({ routineId: ROUTINE_ID });
    expect(again.calls).toEqual([`task Vacuum {"status":"open","priority":"normal","routine_id":"${ROUTINE_ID}","duration_min":30}`]);
    expect(calls).toHaveLength(3);
  });

  it('a password is held on the phone: nothing is sent', async () => {
    const { w, calls } = saver();
    const out = await saveRoutineCard(w, { ...CARD, tasks: [{ title: 'Wi-Fi password is hunter2' }] }, null, () => {});
    expect(out).toEqual({ error: LOOKS_LIKE_SECRET });
    expect(calls).toEqual([]);
  });
});
