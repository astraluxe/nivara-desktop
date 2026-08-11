// ─── The five things worth asking once ───────────────────────────────────────
//
// Everything the app has learned to do well depends on knowing a few facts about the person using
// it, and every one of those facts lived in Settings — a screen a new user has no reason to open.
// So the app kept guessing, and the guesses were the bugs:
//
//   • prospect size was never keyed to the user's own size, so a solo founder was handed Zoho and
//     Byju's as leads — the single complaint that has come back most often
//   • the lead search had no city until one was typed into a sentence
//   • the Info page opened on "Everything", so a salesperson had to read the engineering sections
//     to find theirs
//   • agents introduced themselves without knowing the user's name or what they sell
//
// None of that needed a smarter model. It needed five answers, asked once, at the only moment the
// user is definitely paying attention: the first screen after they sign in.
//
// This module holds the questions and where each answer goes. It writes to the SAME stores the
// Settings screen writes to — nothing here is a parallel copy — so a user who does open Settings
// later sees exactly what they said, and can change it.

export type OnboardingRole = 'founder' | 'sales' | 'marketing' | 'coding' | 'ops' | 'research' | 'student';

export interface OnboardingAnswers {
  name: string;
  company: string;
  role: OnboardingRole | '';
  /** Maps onto business_scale, which decides how big a prospect the lead search aims at. */
  scale: 'solo' | 'small-team' | 'startup' | 'smb' | 'mid-market' | 'enterprise' | '';
  city: string;
  country: string;
  /** One line on what they sell — the single most useful sentence any agent can be given. */
  sells: string;
}

export const EMPTY_ANSWERS: OnboardingAnswers = {
  name: '', company: '', role: '', scale: '', city: '', country: '', sells: '',
};

/** What the user does — chosen once, and it decides which Info page sections come first. */
export const ROLE_OPTIONS: Array<{ key: OnboardingRole; label: string; blurb: string }> = [
  { key: 'founder',   label: 'Founder / owner',   blurb: 'Running the business' },
  { key: 'sales',     label: 'Sales',             blurb: 'Finding and closing customers' },
  { key: 'marketing', label: 'Marketing',         blurb: 'Content, campaigns, brand' },
  { key: 'ops',       label: 'Operations',        blurb: 'Process, admin, automation' },
  { key: 'coding',    label: 'Engineering',       blurb: 'Building and shipping software' },
  { key: 'research',  label: 'Research / analyst', blurb: 'Reading, gathering, summarising' },
  { key: 'student',   label: 'Student',           blurb: 'Studying — keep it free' },
];

/**
 * How big they are. This is the answer that fixes the lead lists.
 *
 * Worded as team size rather than as a business-school category, because "are you SMB or
 * mid-market" is a question only a salesperson enjoys. The stored value is the category.
 */
export const SCALE_OPTIONS: Array<{ key: NonNullable<OnboardingAnswers['scale']>; label: string; blurb: string }> = [
  { key: 'solo',       label: 'Just me',        blurb: 'Freelance, consultant, one-person business' },
  { key: 'small-team', label: '2–10 people',    blurb: 'A small team' },
  { key: 'startup',    label: '11–50, growing', blurb: 'An early-stage company' },
  { key: 'smb',        label: '51–200',         blurb: 'An established business' },
  { key: 'mid-market', label: '201–1000',       blurb: 'Mid-market' },
  { key: 'enterprise', label: '1000+',          blurb: 'A large organisation' },
];

/** Nothing is compulsory — but this is what makes the difference, so it is worth saying so. */
export function whatThisUnlocks(a: OnboardingAnswers): string[] {
  const out: string[] = [];
  if (a.scale) out.push('Lead searches aim at companies your size can actually sell to');
  if (a.city) out.push(`Searches default to ${a.city} instead of asking every time`);
  if (a.role) out.push('The guide opens on the parts that apply to you');
  if (a.name) out.push('Agents write as you, not as "the user"');
  if (a.sells) out.push('Outreach knows what you actually offer');
  return out;
}

/** Is there enough here to be worth saving? */
export function hasAnything(a: OnboardingAnswers): boolean {
  return Boolean(a.name.trim() || a.role || a.scale || a.city.trim() || a.sells.trim());
}

/**
 * Persist the answers into the stores the rest of the app already reads.
 *
 * Deliberately writes to the EXISTING homes — identity, location, the shared Krew profile, and the
 * Info page's own preference key — rather than inventing an onboarding record that would then have
 * to be kept in sync with Settings. Every write is independent and failure-tolerant: a user who
 * answered three of five questions gets those three saved, and a store that is unavailable never
 * costs the others.
 */
export async function saveOnboarding(a: OnboardingAnswers): Promise<void> {
  const name = a.name.trim();
  const company = a.company.trim();
  const city = a.city.trim();
  const country = a.country.trim();
  const sells = a.sells.trim();

  if (name) {
    try {
      const { saveUserIdentity } = await import('./userIdentity');
      saveUserIdentity({ name, company: company || undefined, role: a.role || undefined });
    } catch { /* the rest still saves */ }
  }

  if (city) {
    try {
      const { saveUserLocation } = await import('./userLocation');
      // Country is optional on the form; the store fills the code in from the name when it can.
      saveUserLocation({ city, country: country || 'India' });
    } catch { /* the rest still saves */ }
  }

  // The shared profile is what every agent sees, and business_scale is what prospectScale reads.
  try {
    const { krewMemoryDb } = await import('./krewDb');
    const { KREW_PROFILE_KEY } = await import('./krewTools');
    const writes: Array<[string, string]> = [];
    if (a.scale) writes.push(['business_scale', a.scale]);
    if (sells) writes.push(['what_they_sell', sells]);
    if (company) writes.push(['company', company]);
    if (a.role) writes.push(['role', a.role]);
    await Promise.all(writes.map(([k, v]) => krewMemoryDb.save(KREW_PROFILE_KEY, k, v).catch(() => {})));
  } catch { /* the local copies above still stand */ }

  // The Info page reads this key to decide which sections lead. Same key its own selector writes,
  // so the user can change it there afterwards and nothing here overrides them again.
  if (a.role) {
    try { localStorage.setItem('nv-manual-dept', a.role); } catch { /* quota */ }
  }
}
