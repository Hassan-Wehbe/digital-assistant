// Help (docs/help-plan.md, design D37, step 1): the topics behind the "?" in the top bar. Short on
// purpose (the tester found the app too wordy): one line in the list, a few lines inside, and
// "Try it" examples that put words in the chat box for the user to send (Q3: never sent by
// themselves). Plain text written here; no user data, nothing sent, nothing stored.
import { Platform } from 'react-native';

import { PRIVACY_URL } from './signup';

export interface HelpTopic {
  /** Also the chat's show_help topic name (help plan step 2). */
  id: string;
  icon: string;
  title: string;
  /** The line in the list. */
  line: string;
  /** Inside the topic: a few short lines. */
  lines: string[];
  /** Words put in the chat box ("Try it"). */
  tryIt: string[];
  /** A screen in the app with more ("Settings → Calendars"). */
  more?: { label: string; path: string };
  /** A web page with more (the privacy policy). */
  url?: { label: string; href: string };
  /** Works only in the Android app: left out elsewhere. */
  androidOnly?: true;
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'notes',
    icon: '🗒',
    title: 'Notes',
    line: 'Tell Wilma anything to keep; ask for it later.',
    lines: [
      'Say or type what to keep: a recipe, a design, a gift idea.',
      'Ask for it later in your own words.',
      'Edits keep the earlier version; deleted notes wait in the Recycle bin.',
    ],
    tryIt: ['Save my pasta recipe: ', 'What did I save about the boiler?'],
  },
  {
    id: 'vault',
    icon: '🔒',
    title: 'Passwords & the Vault',
    line: 'Passwords stay locked in the Vault, never in the chat.',
    lines: [
      'The Vault is locked with a passphrase only you know.',
      'Wilma never sees a password: she opens it for you on a separate screen.',
      'Typed a password in the chat by mistake? Wilma holds it back and points to the Vault.',
    ],
    tryIt: ['Show my Netflix password'],
    more: { label: 'Open the Vault', path: '/vault' },
  },
  {
    id: 'day',
    icon: '🌅',
    title: 'My day (Pro)',
    line: 'Your calendar and tasks as a plan, with drives and weather.',
    lines: [
      'Wilma reads the calendars you choose, on your phone, only when you ask.',
      'She adds drive times, when to leave, and rain.',
      'Any day: Today, Tomorrow, or Pick a day.',
      'Routines (Tasks → 🔁 Routines): weekly or monthly chores she offers when you have free time.',
    ],
    tryIt: ['Plan my day', 'What do I have tomorrow afternoon?', 'Make my Saturday chores a weekly routine: laundry, vacuum'],
    more: { label: 'Settings → Calendars', path: '/calendars' },
  },
  {
    id: 'alarms',
    icon: '⏰',
    title: 'Alarms, reminders & calendar',
    line: 'Wilma fills it in; you tap to confirm.',
    lines: [
      'Alarms open your Clock app, filled in.',
      'Reminders are Wilma notifications on this phone.',
      'Calendar events are added only when you tap Add to calendar.',
    ],
    tryIt: ['Wake me at 6:30', 'Remind me at 5 to call Sam', 'Put the dentist on my calendar Tuesday at 3'],
    androidOnly: true,
  },
  {
    id: 'places',
    icon: '📍',
    title: 'Places & Homes',
    line: 'Places to visit, date nights, family days, and your homes.',
    lines: [
      'Save a place from the chat, from Google Maps, or with ＋ → 📍 Save where I am.',
      'Add what you liked and who you went with, and ask for ideas later.',
      'Homes: where your day starts. Add or change them in Settings → Homes.',
      'Date night, Family day (Pro): Wilma plans one from your places. Who comes: Settings → Household.',
    ],
    tryIt: ['Plan a date night Friday', 'Plan a family day Saturday', 'Places near me', 'Save my mom’s house as a home'],
    more: { label: 'Settings → Homes', path: '/homes' },
  },
  {
    id: 'memory',
    icon: '🧠',
    title: 'Memory',
    line: 'Small facts Wilma keeps so you don’t repeat them.',
    lines: [
      'With memory on, Wilma keeps lasting facts you mention and shows each with Undo.',
      'Never passwords.',
      'See or delete them in Settings → Memory.',
    ],
    tryIt: ['What do you remember about me?'],
    more: { label: 'Settings', path: '/settings' },
  },
  {
    id: 'spaces',
    icon: '🗂',
    title: 'Spaces',
    line: 'Folders for your notes; locked ones stay out of search.',
    lines: [
      'Wilma picks a space for each note, or you choose one.',
      'A restricted space never shows up in searches or answers until you open it.',
      'Tap ☆ on a space to keep it on Home (up to 6).',
    ],
    tryIt: ['Open Recipes'],
    more: { label: 'All spaces', path: '/spaces' },
  },
  {
    id: 'privacy',
    icon: '🛡',
    title: 'Privacy & your data',
    line: 'What is sent, what is kept, how to delete it.',
    lines: [
      'Your notes are yours; only what an answer needs goes to Wilma’s AI provider.',
      'Passwords never do.',
      'Delete your account and everything in it from Settings.',
    ],
    tryIt: [],
    more: { label: 'Delete account', path: '/delete-account' },
    url: { label: 'Privacy policy', href: PRIVACY_URL },
  },
];

/** The topics this app shows (Android-only ones left out elsewhere). */
export function helpTopics(os: string = Platform.OS): HelpTopic[] {
  return HELP_TOPICS.filter((t) => !t.androidOnly || os === 'android');
}

export function helpTopic(id: string | undefined, os: string = Platform.OS): HelpTopic | null {
  return helpTopics(os).find((t) => t.id === id) ?? null;
}

/** At most this much goes into the chat box from "Try it" (and from the chat's ?draft=). */
export const MAX_DRAFT = 300;

/**
 * The words a "Try it" (`?draft=`) puts in the chat box, or null. Only a short, single-line text;
 * the box still checks for passwords before anything is sent.
 */
export function draftText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/[\r\n]+/g, ' ');
  return text.trim() && text.length <= MAX_DRAFT ? text : null;
}
