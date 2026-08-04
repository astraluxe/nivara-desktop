// ─── What an agent knows about how you work ──────────────────────────────────
//
// Three things live here, and they are deliberately together because they feed each other:
//
//   1. THE FILE AN AGENT IS WORKING IN. An agent that generates a campaign brief and is then asked
//      "add a section on pricing" had no idea which document that meant — every turn started from
//      nothing. Remembering the last file it created or edited is what makes a second turn a
//      continuation rather than a fresh start.
//   2. SCORED OPTIONS. When an agent offers three ways forward, "which one is actually best for me"
//      is the user's real question. Effort, impact and confidence make that answerable at a glance
//      instead of by reading three paragraphs.
//   3. WHICH OPTION YOU ACTUALLY PICKED. This is the only honest signal about how someone works.
//      Recorded on every choice, summarised back into the prompt, so the recommendation drifts
//      towards the kind of decision this person actually makes rather than a generic one.
//
// All localStorage — no server, no cost, works identically on adris.tech, a BYOK key or a local
// model, because it is context handed to whatever model is answering.

// ─── 1. The file an agent is working in ───────────────────────────────────────
const FILE_KEY = 'nv-agent-working-file-v1';

export interface WorkingFile {
  /** Brain node title — the durable handle, since paths move and nodes are found by title. */
  title: string;
  /** 'document' | 'list' | 'deck' | 'note' — what kind of thing it is, in the user's words. */
  kind: string;
  /** Absolute path when the agent wrote a real file to disk, so it can be re-opened. */
  path?: string;
  updatedAt: number;
}

type FileStore = Record<string, WorkingFile>;

function readFiles(): FileStore {
  try { return JSON.parse(localStorage.getItem(FILE_KEY) ?? '{}') as FileStore; } catch { return {}; }
}

/** Remember what this agent is working in. Called whenever an agent creates or edits something. */
export function setWorkingFile(agentKey: string, f: Omit<WorkingFile, 'updatedAt'>): void {
  if (!agentKey || !f.title) return;
  try {
    const s = readFiles();
    s[agentKey] = { ...f, updatedAt: Date.now() };
    localStorage.setItem(FILE_KEY, JSON.stringify(s));
  } catch { /* quota — losing this is never worth failing a turn for */ }
}

export function getWorkingFile(agentKey: string): WorkingFile | null {
  const f = readFiles()[agentKey];
  if (!f) return null;
  // A month-old file is not "what we were doing"; treating it as current is worse than forgetting.
  if (Date.now() - f.updatedAt > 30 * 86_400_000) return null;
  return f;
}

export function clearWorkingFile(agentKey: string): void {
  try { const s = readFiles(); delete s[agentKey]; localStorage.setItem(FILE_KEY, JSON.stringify(s)); } catch { /* quota */ }
}

// ─── 2. Scoring an option ─────────────────────────────────────────────────────

export interface ChoiceScore {
  /** 1 = an hour, 5 = weeks of work. */
  effort?: number;
  /** 1 = marginal, 5 = changes the business. */
  impact?: number;
  /** 0-100 — how sure the agent is this will work for THIS user, not in general. */
  confidence?: number;
  /** One line: why this scores the way it does. Shown on the card, not hidden in a tooltip. */
  why?: string;
}

export const EFFORT_LABEL = ['', 'An hour', 'A day', 'A few days', 'A week+', 'Weeks'];
export const IMPACT_LABEL = ['', 'Marginal', 'Small', 'Solid', 'Big', 'Step change'];

const clamp = (n: unknown, lo: number, hi: number, dflt: number): number => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
};

/** Normalise whatever the model produced into a usable score, or null if it gave nothing. */
export function normaliseScore(raw: Partial<ChoiceScore> | undefined): ChoiceScore | null {
  if (!raw) return null;
  const has = raw.effort != null || raw.impact != null || raw.confidence != null;
  if (!has) return null;
  return {
    effort: clamp(raw.effort, 1, 5, 3),
    impact: clamp(raw.impact, 1, 5, 3),
    confidence: clamp(raw.confidence, 0, 100, 60),
    why: typeof raw.why === 'string' ? raw.why.slice(0, 200) : '',
  };
}

/**
 * Which option to recommend.
 *
 * Impact carries the most weight, effort counts against, confidence scales the whole thing — an
 * option the agent is unsure about should not win on paper. `bias` comes from what this user has
 * actually chosen before (see decisionBias): someone who consistently takes the quick win gets
 * effort weighted harder, someone who takes the big swing gets impact weighted harder.
 */
export function scoreValue(s: ChoiceScore, bias = 0): number {
  const impact = (s.impact ?? 3);
  const effort = (s.effort ?? 3);
  const conf = (s.confidence ?? 60) / 100;
  const effortWeight = 1 + bias;          // bias > 0 => this user avoids effort
  const impactWeight = 1 - bias * 0.5;
  return (impact * 2 * impactWeight - effort * effortWeight) * conf;
}

// ─── 3. What this user actually picks ─────────────────────────────────────────
const PICK_KEY = 'nv-agent-decisions-v1';
const MAX_PICKS = 60;

export interface DecisionRecord {
  agentKey: string;
  title: string;
  /** The label of the option they took. */
  picked: string;
  pickedScore: ChoiceScore | null;
  /** What they turned down — the contrast is what makes this informative. */
  rejected: Array<{ label: string; score: ChoiceScore | null }>;
  at: number;
}

export function recordDecision(rec: Omit<DecisionRecord, 'at'>): void {
  try {
    const all = readDecisions();
    all.unshift({ ...rec, at: Date.now() });
    localStorage.setItem(PICK_KEY, JSON.stringify(all.slice(0, MAX_PICKS)));
  } catch { /* quota */ }
}

export function readDecisions(): DecisionRecord[] {
  try {
    const v = JSON.parse(localStorage.getItem(PICK_KEY) ?? '[]');
    return Array.isArray(v) ? v as DecisionRecord[] : [];
  } catch { return []; }
}

/**
 * How much this user leans away from effort, as -0.5 … +0.5.
 *
 * Positive means they consistently take the lighter option when a heavier one was on the table.
 * Derived only from decisions where the scores actually differed — picking the only sensible
 * option says nothing about preference.
 */
export function decisionBias(): number {
  const rows = readDecisions().filter((d) => d.pickedScore && d.rejected.some((r) => r.score));
  if (rows.length < 3) return 0;                       // too little to claim a pattern
  let sum = 0, n = 0;
  for (const d of rows.slice(0, 20)) {
    const mine = d.pickedScore!.effort ?? 3;
    const others = d.rejected.map((r) => r.score?.effort).filter((e): e is number => e != null);
    if (!others.length) continue;
    const avgOther = others.reduce((a, b) => a + b, 0) / others.length;
    sum += (avgOther - mine);                          // > 0 => they took the lighter one
    n++;
  }
  if (!n) return 0;
  return Math.max(-0.5, Math.min(0.5, (sum / n) / 4));
}

/**
 * A short, plain-English note about how this person decides, for the system prompt.
 *
 * Deliberately hedged and short: this is a pattern from a handful of clicks, not a personality
 * profile, and an agent that over-commits to it will feel like it is guessing about the user.
 * Empty string until there is genuinely something to say.
 */
export function decisionStyleNote(): string {
  const rows = readDecisions();
  if (rows.length < 3) return '';
  const bias = decisionBias();
  const picked = rows.slice(0, 12);
  const avgImpact = picked.map((d) => d.pickedScore?.impact).filter((v): v is number => v != null);
  const parts: string[] = [];
  if (bias > 0.12) parts.push('tends to take the option that can be done quickly over the bigger one');
  else if (bias < -0.12) parts.push('tends to take the more ambitious option even when it costs more effort');
  if (avgImpact.length >= 3) {
    const m = avgImpact.reduce((a, b) => a + b, 0) / avgImpact.length;
    if (m >= 4) parts.push('consistently goes for high-impact work');
    else if (m <= 2.4) parts.push('prefers small, safe steps');
  }
  if (!parts.length) return '';
  return `\n\n## How this user decides\nFrom ${rows.length} past choices, they ${parts.join(', and ')}. `
    + 'Weight your recommendation accordingly, but say plainly when the evidence points the other way — '
    + 'their past pattern is a hint, not an instruction.';
}

/** The block telling an agent what it was last working in. Empty when there is nothing. */
export function workingFileNote(agentKey: string): string {
  const f = getWorkingFile(agentKey);
  if (!f) return '';
  const days = Math.floor((Date.now() - f.updatedAt) / 86_400_000);
  const when = days === 0 ? 'earlier today' : days === 1 ? 'yesterday' : `${days} days ago`;
  return `\n\n## What you were working on\nYou last worked on **${f.title}** (${f.kind}, ${when})`
    + `${f.path ? ` — saved at ${f.path}` : ''}. If this request continues that work ("add a section", `
    + '"update it", "make it shorter"), use recall_from_brain to read it and EDIT that, rather than '
    + 'starting a new document. If it is clearly a different job, ignore this and start fresh.';
}
