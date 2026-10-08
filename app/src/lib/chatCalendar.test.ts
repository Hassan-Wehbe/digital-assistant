import { describe, expect, it, jest } from '@jest/globals';

import type { Agenda, AgendaResult, CalendarChoice } from './calendar';
import { calendarFollowUp, type CalendarFollowUpDeps } from './chatCalendar';

const AGENDA: Agenda = { from: '2026-10-08', to: '2026-10-08', time_zone: 'America/New_York', calendars: 1, events: [] };
const ON: CalendarChoice = { on: true, ticked: ['home'] };

function deps(result: AgendaResult | Error, choice: CalendarChoice = ON) {
  return {
    choice: jest.fn<CalendarFollowUpDeps['choice']>(async () => choice),
    read: jest.fn<CalendarFollowUpDeps['read']>(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

describe('calendarFollowUp (after Wilma asks for the calendar)', () => {
  it('reads the days she asked for, with this account’s choice', async () => {
    const d = deps({ agenda: AGENDA });
    expect(await calendarFollowUp({ from: '2026-10-08', to: '2026-10-09' }, d, false)).toEqual({ agenda: AGENDA });
    expect(d.read).toHaveBeenCalledWith(ON, '2026-10-08', '2026-10-09');
  });

  it('says off or not allowed, so the card can point to Settings → Calendars', async () => {
    expect(await calendarFollowUp({ from: '2026-10-08', to: '2026-10-08' }, deps({ problem: 'off' }), false)).toEqual({ problem: 'off' });
    expect(await calendarFollowUp({ from: '2026-10-08', to: '2026-10-08' }, deps({ problem: 'permission' }), false)).toEqual({ problem: 'permission' });
  });

  it('anything else is a failure, never a throw', async () => {
    for (const r of [{ problem: 'failed' as const }, { problem: 'bad_days' as const }, new Error('boom')]) {
      expect(await calendarFollowUp({ from: '2026-10-08', to: '2026-10-08' }, deps(r), false)).toEqual({ problem: 'failed' });
    }
  });

  it('never a second round trip for the same question', async () => {
    const d = deps({ agenda: AGENDA });
    expect(await calendarFollowUp({ from: '2026-10-08', to: '2026-10-08' }, d, true)).toEqual({ problem: 'failed' });
    expect(d.read).not.toHaveBeenCalled();
  });
});
