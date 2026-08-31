import { getPlanConfig, type Plan } from './planConfig';

// ─── The trial meter for power commands ──────────────────────────────────────
//
// A free user who connects their own NVIDIA key spends none of our tokens, so the token meter --
// the only limit we had -- never fired for them. They could run lead generation, connection
// scanning and outreach forever without ever seeing a reason to pay. Meanwhile "connect a free key
// and try it" is exactly the offer we want to make, because it is the honest one.
//
// So the heavy commands are counted as RUNS, not tokens. Fifteen of them is enough to build a real
// lead list, message real people and see whether the thing works; it is not enough to run a
// business on. Everything else -- chat, drafting, the Brain, decks, the plan panel -- stays
// unmetered on a free key, because none of it is what a paying customer is paying for.
//
// Counted locally. This is a trial nudge, not a billing control: the money-critical meters
// (tokens, images) are server-side in token_usage where they cannot be edited. Someone determined
// to clear localStorage can reset this, and that is an acceptable trade for a counter that works
// offline, costs no round-trip, and never blocks a paying user by failing closed on a network hop.

const KEY = 'nv-command-usage-v1';
export const COMMAND_QUOTA_EVENT = 'nv-command-quota-changed';

/**
 * The commands that count.
 *
 * Each one drives a long browser session or a multi-agent run — this is the product doing work,
 * not answering a question. Deliberately a short list: metering something cheap would make the
 * trial feel mean without protecting anything.
 */
export const POWER_COMMANDS = [
  'leads',      // build a lead list — the single most expensive thing the app does
  'outreach',   // draft per-person messages and open the copilot
  'scan',       // read the user's whole LinkedIn connection list
  'enrich',     // open each profile and fill in the blanks
  'verify',     // re-check every row against the live page
  'verifylinks',
  'research',   // multi-source research run
  'findprofile',
] as const;

export type PowerCommand = (typeof POWER_COMMANDS)[number];

export function isPowerCommand(name: string): name is PowerCommand {
  return (POWER_COMMANDS as readonly string[]).includes(name.replace(/^\//, '').toLowerCase());
}

interface Usage { runs: { cmd: string; at: number }[] }

function read(): Usage {
  try {
    const raw = localStorage.getItem(KEY);
    const u = raw ? (JSON.parse(raw) as Usage) : null;
    return u && Array.isArray(u.runs) ? u : { runs: [] };
  } catch { return { runs: [] }; }
}

function write(u: Usage): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ runs: u.runs.slice(-500) }));
    window.dispatchEvent(new CustomEvent(COMMAND_QUOTA_EVENT));
  } catch { /* quota/private mode — never block the command over a storage failure */ }
}

export interface CommandBudget {
  used: number;
  cap: number | null;        // null = unlimited
  remaining: number | null;
  exhausted: boolean;
}

/**
 * Where this user stands. The cap is a LIFETIME trial allowance on free tiers, matching how their
 * token allowance already works — a monthly reset would make "free forever" true by accident.
 */
export function commandBudget(plan: Plan): CommandBudget {
  const cap = getPlanConfig(plan).powerCommands;
  const used = read().runs.length;
  if (cap == null) return { used, cap: null, remaining: null, exhausted: false };
  return { used, cap, remaining: Math.max(0, cap - used), exhausted: used >= cap };
}

/** Record one run. Call this only when the command actually STARTS doing work. */
export function recordCommandRun(cmd: string): void {
  const u = read();
  u.runs.push({ cmd: cmd.replace(/^\//, '').toLowerCase(), at: Date.now() });
  write(u);
}

/**
 * The message shown when the allowance is gone.
 *
 * Says what they got, what stays free, and what unlocks it — a limit with no way forward reads as
 * a bug. Never pretends the trial was smaller or larger than it was.
 */
export function exhaustedMessage(cmd: string, cap: number): string {
  return [
    `You've used all ${cap} free runs of the power commands (\`/${cmd.replace(/^\//, '')}\` is one of them).`,
    '',
    'These are the ones that drive a full browser session on your behalf — **/leads**, **/outreach**, **/scan**, **/enrich**, **/verify**, **/research**. Everything else stays free on your own key: chat, drafting, the Brain, decks, automations, the plan panel and the outreach copilot itself.',
    '',
    'Upgrade to **Business** for unlimited runs — or keep using the rest of the app exactly as you are.',
  ].join('\n');
}

/** For the trial banner: how many are left, phrased for a human. Empty when unlimited. */
export function remainingNote(plan: Plan): string {
  const b = commandBudget(plan);
  if (b.cap == null) return '';
  if (b.exhausted) return 'Free power-command runs used up';
  return `${b.remaining} of ${b.cap} free power-command runs left`;
}
