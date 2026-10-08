// Wilma asked for the phone's calendar (an `agenda_request` at the end of her answer; day planner
// step 1, "ask, then re-send"): read the ticked calendars for those days and send the same question
// again with them, or say why not with a card. Never more than once per question: an answer that
// already carried the calendar and asks again gets the "failed" card, not another round trip.
import type { Agenda, AgendaResult, CalendarChoice } from './calendar';
import type { CalendarProblem } from './chatThread';

export interface CalendarFollowUpDeps {
  /** Settings → Calendars' choice for this account (calendarSettings.ts). */
  choice: () => Promise<CalendarChoice>;
  /** lib/calendar.ts readAgenda, bound to the phone. */
  read: (choice: CalendarChoice, from: string, to: string) => Promise<AgendaResult>;
}

export async function calendarFollowUp(
  ask: { from: string; to: string },
  deps: CalendarFollowUpDeps,
  /** The answer that asked already carried the calendar. */
  alreadySent: boolean,
): Promise<{ agenda: Agenda } | { problem: CalendarProblem }> {
  if (alreadySent) return { problem: 'failed' };
  try {
    const out = await deps.read(await deps.choice(), ask.from, ask.to);
    if ('agenda' in out) return out;
    return { problem: out.problem === 'off' || out.problem === 'permission' ? out.problem : 'failed' };
  } catch {
    return { problem: 'failed' };
  }
}
