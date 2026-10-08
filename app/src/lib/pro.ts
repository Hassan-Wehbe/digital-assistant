// Pro (day planner step 2, "Premium: how it is gated"): planning the day is a Pro feature. Who has
// Pro is decided by the server (app_user.plan, which people can read but never change; the day
// route answers 403 pro_required without it). The app only reads it to show the Pro badge and the
// Pro card before asking; it never unlocks anything by itself.

export type Plan = 'pro' | 'free';

export const PRO_TITLE = '🌅 My day is part of Pro';
export const PRO_TEXT =
  'Wilma turns your calendar and tasks into a plan: when to leave with traffic, rain at each stop, overlaps sorted out, tasks fitted in.';
export const PRO_FREE = '“What’s on my day?” and tasks stay free.';
/** What the 🌅 Plan my day chip sends to Wilma. */
export const PLAN_MY_DAY = 'plan my day';

/** See Pro, until purchases exist (Google Play Billing comes later). */
export const PRO_COMING = 'Pro is coming. Until then, ask the owner to turn it on for your account.';

type Read = () => PromiseLike<{ data: unknown; error: unknown }>;

/** The signed-in person's plan, or null when it could not be read (offline): the server decides then. */
export async function loadPlan(read: Read): Promise<Plan | null> {
  try {
    const { data, error } = await read();
    if (error || typeof data !== 'object' || data === null) return null;
    const plan = (data as { plan?: unknown }).plan;
    return plan === 'pro' ? 'pro' : plan === 'free' ? 'free' : null;
  } catch {
    return null;
  }
}

/** Show the Pro badge (and the Pro card on a tap) only when the server says free (not while unread). */
export const needsPro = (plan: Plan | null | undefined) => plan === 'free';
