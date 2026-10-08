// The calendar for the planner: keys, places found on the phone, the My day request, and the chat's
// re-sent agenda (events "e0", "e1", ... with point, not_a_trip and the day's choices).
import { describe, expect, it } from '@jest/globals';

import type { Agenda, AgendaEvent } from './calendar';
import { agendaForChat, chatAgenda, dayBody, isOnline, MAX_LOOKUPS, phoneGeocode, placeEvents, withKeys, type Geocode } from './dayAgenda';
import { answerPlace, EMPTY_MEMORY, takeBoth, toggleNotDriving, type DayMemory } from './dayChoices';

const D = '2026-10-09';
const ev = (title: string, start: string, location?: string, more: Partial<AgendaEvent> = {}): AgendaEvent => ({
  title, start: `${D}T${start}`, end: `${D}T${start.slice(0, 2)}:59`, all_day: false, calendar: 'Kids', ...(location ? { location } : {}), ...more,
});

const EVENTS = [
  ev('Swim: Sara', '16:30', 'Aquatic Center'),
  ev('Dentist', '14:00', 'Dentist'),
  ev('Design review', '10:00', 'https://zoom.us/j/123'),
  ev('Piano', '15:00', '123 Main St, Oviedo FL'),
  ev('Busy', '09:00', undefined, { busy_only: true }),
];

/** A geocoder that records what it was asked. */
function geocoder(answers: Record<string, { lat: number; lng: number } | null>) {
  const asked: string[] = [];
  const geocode: Geocode = async (text) => {
    asked.push(text);
    return text in answers ? answers[text] : null;
  };
  return { asked, geocode };
}

describe('event keys', () => {
  it('the same event gets the same key each time, and twins get different ones', () => {
    const a = withKeys(EVENTS);
    expect(withKeys(EVENTS).map((e) => e.key)).toEqual(a.map((e) => e.key));
    const twins = withKeys([EVENTS[0], EVENTS[0]]).map((e) => e.key);
    expect(new Set(twins).size).toBe(2);
    expect(a[0].key).toMatch(/^k[0-9a-f]{8}$/);
  });
});

describe('places found on the phone', () => {
  it('uses the answer for the title first, calls are not trips, and only location text is looked up', async () => {
    const memory = answerPlace(EMPTY_MEMORY, 'dentist', { lat: 28.1, lng: -81.1, label: 'Dr. Lee' });
    const g = geocoder({ 'Aquatic Center': { lat: 28.6, lng: -81.2 }, '123 Main St, Oviedo FL': { lat: 28.67, lng: -81.2 } });
    const { events, found } = await placeEvents(withKeys(EVENTS), memory, g.geocode);
    expect(events[1].point).toEqual({ lat: 28.1, lng: -81.1 });
    expect(events[2].not_a_trip).toBe(true);
    // A name only (no street number) is marked, so My day asks "Is this right?".
    expect(events[0].point).toEqual({ lat: 28.6, lng: -81.2, by_name_only: true });
    expect(events[3].point).toEqual({ lat: 28.67, lng: -81.2 });
    expect(events[4].point).toBeUndefined();
    // Titles never go to the geocoder; the answered event and the call are not looked up.
    expect(g.asked).toEqual(['Aquatic Center', '123 Main St, Oviedo FL']);
    expect(found).toEqual({ 'aquatic center': { lat: 28.6, lng: -81.2 }, '123 main st, oviedo fl': { lat: 28.67, lng: -81.2 } });
  });

  it('a "Not a trip" answer wins over the location text', async () => {
    const memory = answerPlace(EMPTY_MEMORY, 'Swim: Sara', { not_a_trip: true });
    const { events } = await placeEvents(withKeys([EVENTS[0]]), memory);
    expect(events[0]).toMatchObject({ not_a_trip: true });
    expect(events[0].point).toBeUndefined();
  });

  it('looks a text up once: remembered results (and "nothing found") are reused', async () => {
    const memory: DayMemory = { ...EMPTY_MEMORY, found: { 'aquatic center': { lat: 1, lng: 2 }, dentist: { none: true } } };
    const g = geocoder({});
    const { events, found } = await placeEvents(withKeys(EVENTS.slice(0, 2)), memory, g.geocode);
    expect(g.asked).toEqual([]);
    expect(found).toEqual({});
    expect(events[0].point).toEqual({ lat: 1, lng: 2, by_name_only: true });
    expect(events[1].point).toBeUndefined();
  });

  it('looks up at most MAX_LOOKUPS texts per plan', async () => {
    const many = Array.from({ length: MAX_LOOKUPS + 5 }, (_, i) => ev(`E${i}`, '12:00', `Place ${i}`));
    const g = geocoder({});
    await placeEvents(withKeys(many), EMPTY_MEMORY, g.geocode);
    expect(g.asked).toHaveLength(MAX_LOOKUPS);
  });

  it('never looks up a location that looks like a password', async () => {
    const g = geocoder({});
    const { events } = await placeEvents(withKeys([ev('Wifi', '12:00', 'password: hunter2!x9')]), EMPTY_MEMORY, g.geocode);
    expect(g.asked).toEqual([]);
    expect(events[0].point).toBeUndefined();
  });

  it('recognises video calls', () => {
    expect(isOnline('https://meet.google.com/abc')).toBe(true);
    expect(isOnline('Microsoft Teams Meeting')).toBe(true);
    expect(isOnline('Aquatic Center')).toBe(false);
  });

  it('the phone geocoder is used only when the location permission is already given', async () => {
    const calls: string[] = [];
    const deps = (granted: boolean) => ({
      permission: async () => ({ granted, canAskAgain: true }),
      geocode: async (q: string) => {
        calls.push(q);
        return [{ latitude: 28.1234567, longitude: -81.7654321 }];
      },
    });
    expect(await phoneGeocode(deps(false))('Aquatic Center')).toBeUndefined();
    expect(calls).toEqual([]);
    expect(await phoneGeocode(deps(true))('Aquatic Center')).toEqual({ lat: 28.123457, lng: -81.765432 });
    const none = phoneGeocode({ permission: async () => ({ granted: true, canAskAgain: true }), geocode: async () => [] });
    expect(await none('Nowhere')).toBeNull();
  });
});

describe('the My day request', () => {
  it('sends the day, the zone, now (today only) and the choices for events it has', () => {
    const events = withKeys(EVENTS);
    let m = takeBoth(EMPTY_MEMORY, D, [events[0].key, events[3].key]);
    m = takeBoth(m, D, ['gone1', 'gone2']);
    m = toggleNotDriving(m, D, events[1].key);
    const body = dayBody(D, 'America/New_York', `${D}T13:05`, events, m);
    expect(body).toMatchObject({ mode: 'day', date: D, tz: 'America/New_York', now: `${D}T13:05` });
    expect(body.events).toHaveLength(5);
    expect(body.events[0].key).toBe(events[0].key);
    expect(body.choices).toEqual({ together: [[events[0].key, events[3].key]], not_driving: [events[1].key] });
    expect(dayBody('2026-10-10', 'UTC', `${D}T23:00`, [], EMPTY_MEMORY)).toEqual({ mode: 'day', date: '2026-10-10', tz: 'UTC', events: [] });
  });
});

describe('the chat’s re-sent agenda', () => {
  const agenda: Agenda = { from: D, to: D, time_zone: 'America/New_York', calendars: 1, events: EVENTS };

  it('carries point and not_a_trip, and the day’s choices named e0, e1, ... in the agenda’s order', async () => {
    const keys = withKeys(EVENTS).map((e) => e.key);
    let m = takeBoth(EMPTY_MEMORY, D, [keys[0], keys[3]]);
    m = toggleNotDriving(m, D, keys[1]);
    m = answerPlace(m, 'Dentist', { lat: 1, lng: 2, label: 'Dr. Lee' });
    const { agenda: out } = await chatAgenda(agenda, m, geocoder({ 'Aquatic Center': { lat: 3, lng: 4 } }).geocode);
    expect(out.events.map((e) => e.title)).toEqual(EVENTS.map((e) => e.title));
    expect(out.events[0]).toEqual({ ...EVENTS[0], point: { lat: 3, lng: 4, by_name_only: true } });
    expect(out.events[1].point).toEqual({ lat: 1, lng: 2 });
    expect(out.events[2].not_a_trip).toBe(true);
    expect(out.events.some((e) => 'key' in e)).toBe(false);
    expect(out.choices).toEqual({ together: [['e0', 'e3']], not_driving: ['e1'] });
  });

  it('several days go as read', async () => {
    const week = { ...agenda, to: '2026-10-12' };
    expect((await chatAgenda(week, EMPTY_MEMORY)).agenda).toBe(week);
  });

  it('remembers new geocoder results, and sends the agenda as read when the memory fails', async () => {
    const saved: DayMemory[] = [];
    const out = await agendaForChat(agenda, {
      load: async () => EMPTY_MEMORY,
      save: async (m) => void saved.push(m),
      geocode: geocoder({ 'Aquatic Center': { lat: 3, lng: 4 } }).geocode,
    });
    expect(out.events[0].point).toEqual({ lat: 3, lng: 4, by_name_only: true });
    expect(saved[0].found['aquatic center']).toEqual({ lat: 3, lng: 4 });
    const broken = await agendaForChat(agenda, { load: async () => Promise.reject(new Error('locked')), save: async () => {} });
    expect(broken).toBe(agenda);
  });
});
