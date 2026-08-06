// ─── Who is actually using this ───────────────────────────────────────────────
//
// Every agent in the app gives the same advice to a solo founder chasing their first ten customers,
// a marketing lead building a campaign list, a student looking for an internship and a consultant
// billing by the hour. Those four want opposite things from the same request — "find me leads"
// means enterprise accounts to one and hiring managers to another — and the app has always had the
// evidence to tell them apart sitting unused in what the user types.
//
// This works it out from the words themselves, with NO model call: role inference that costs tokens
// to save tokens is not obviously worth having, and a deterministic rule is one the user can read,
// predict and correct. Evidence accumulates across turns, because one message is rarely enough and
// a single stray word should never flip the answer.
//
// It is a HINT, never a gate. Nothing is blocked or hidden because of a role; it changes phrasing
// and emphasis, and the user can set or clear it outright.

export type UserRole = 'founder' | 'exec' | 'sales' | 'marketer' | 'engineer' | 'consultant' | 'student' | 'recruiter' | 'operations' | '';

export interface RoleGuess {
  role: UserRole;
  /** 0–1. Below ~0.35 nothing is asserted anywhere — a guess this weak is worse than none. */
  confidence: number;
  /** The phrases that led here, so the user can see WHY and correct it. */
  evidence: string[];
  /** True when the user stated it themselves. Never overridden by inference. */
  stated: boolean;
}

const ROLE_KEY = 'nv-user-role-v1';

export const ROLE_LABEL: Record<Exclude<UserRole, ''>, string> = {
  founder:     'Founder / solo builder',
  exec:        'Executive (C-level / director)',
  sales:       'Sales',
  marketer:    'Marketing',
  engineer:    'Engineer / developer',
  consultant:  'Consultant / agency',
  student:     'Student / early career',
  recruiter:   'Recruiting / HR',
  operations:  'Operations',
};

/** How each role should change the way work is done. Short on purpose — it goes in every prompt. */
export const ROLE_GUIDANCE: Record<Exclude<UserRole, ''>, string> = {
  founder:    'They are a founder doing everything themselves: no team to delegate to, little time, and money that is their own. Prefer the shortest route to a result they can act on today over the thorough one. Small numbers of high-quality prospects beat big lists.',
  exec:       'They lead a function or a company. Lead with the decision and the trade-off, not the working. Assume a team exists to execute; what they need from you is the call and the evidence behind it.',
  sales:      'They sell for a living. Volume, qualification and follow-up timing matter more than craft. Be concrete about who to contact, what to say and when to chase.',
  marketer:   'They run marketing. Think in segments, channels and messaging that can be reused, not one-off notes. Anything you write should be adaptable across a list.',
  engineer:   'They write software. Be technically precise, show the code or the command, and skip the business framing unless they ask for it.',
  consultant: 'They do this work for clients, not only for themselves. Deliverables must be presentable to a third party, and "which client is this for" is usually a real question worth asking once.',
  student:    'They are early in their career. Explain the why alongside the what, avoid assuming budget or a company behind them, and prefer free or low-cost routes.',
  recruiter:  'They hire. People-first: roles, candidates, pipelines and outreach to individuals rather than to businesses.',
  operations: 'They keep things running. Process, repeatability and where things break matter more than novelty. Prefer something that can be run again next month.',
};

// Phrases that genuinely indicate a role. Deliberately narrow: "we" and "my team" say nothing, and
// a word like "design" appears in every kind of work.
const SIGNALS: Array<{ role: Exclude<UserRole, ''>; re: RegExp; weight: number }> = [
  { role: 'founder',    re: /\b(i(?:'m| am)? (?:the |a )?found(?:er|ed)|my startup|my company|my product|we(?:'re| are) building|bootstrapp|pre[- ]seed|our first (?:customers?|users?)|indie hacker|solo founder)\b/i, weight: 3 },
  { role: 'exec',       re: /\b(i(?:'m| am)? (?:the )?(?:ceo|cto|coo|cfo|cmo|vp|director|head of)|board (?:deck|meeting)|my (?:leadership|exec) team|p&l|quarterly (?:targets?|review))\b/i, weight: 3 },
  { role: 'sales',      re: /\b(my (?:quota|pipeline|territory)|close (?:the )?deal|prospect(?:ing|s)\b|cold call|sdr\b|bdr\b|account executive|crm\b|follow[- ]up sequence)\b/i, weight: 2 },
  { role: 'marketer',   re: /\b(campaign|brand|content calendar|seo\b|ad copy|audience segment|newsletter|social (?:posts?|media) (?:plan|strategy)|positioning|top of funnel)\b/i, weight: 2 },
  { role: 'engineer',   re: /\b(my (?:repo|codebase|branch)|pull request|refactor|stack trace|unit tests?|deploy(?:ment)? pipeline|api endpoint|typescript|python|rust\b)\b/i, weight: 2 },
  { role: 'consultant', re: /\b(my clients?|for a client|client work|billable|retainer|my agency|scope of work|sow\b|proposal for)\b/i, weight: 3 },
  { role: 'student',    re: /\b(i(?:'m| am)? a student|my (?:college|university|semester|professor|thesis|assignment)|internship|fresher|placement|campus)\b/i, weight: 3 },
  { role: 'recruiter',  re: /\b(candidates?|job description|hiring for|shortlist|applicant|interview (?:panel|loop)|talent pipeline|sourcing candidates)\b/i, weight: 3 },
  { role: 'operations', re: /\b(sop\b|standard operating|vendor master|procurement|supply chain|inventory|logistics|invoic|purchase order|compliance check)\b/i, weight: 2 },
];

/** An explicit statement of role, which always wins over inference. */
const STATED = /\bi(?:'m| am)\s+(?:an?\s+)?(founder|ceo|cto|coo|cfo|cmo|vp|director|head of [a-z ]{3,20}|sales(?:person|\s*rep)?|marketer|marketing (?:lead|manager)|engineer|developer|programmer|consultant|freelancer|student|recruiter|hr\b|ops|operations)\b/i;

const STATED_TO_ROLE: Array<[RegExp, Exclude<UserRole, ''>]> = [
  [/founder/i, 'founder'],
  [/ceo|cto|coo|cfo|cmo|vp|director|head of/i, 'exec'],
  [/sales/i, 'sales'],
  [/market/i, 'marketer'],
  [/engineer|developer|programmer/i, 'engineer'],
  [/consultant|freelancer/i, 'consultant'],
  [/student/i, 'student'],
  [/recruiter|hr/i, 'recruiter'],
  [/ops|operations/i, 'operations'],
];

interface Store { scores: Partial<Record<Exclude<UserRole, ''>, number>>; evidence: string[]; stated?: UserRole; }

function read(): Store {
  try {
    const r = JSON.parse(localStorage.getItem(ROLE_KEY) ?? '{}');
    return { scores: r?.scores ?? {}, evidence: Array.isArray(r?.evidence) ? r.evidence : [], stated: r?.stated };
  } catch { return { scores: {}, evidence: [] }; }
}
function write(s: Store): void {
  try { localStorage.setItem(ROLE_KEY, JSON.stringify(s)); } catch { /* quota */ }
}

/**
 * Feed one message in. Call it per turn; it is a few regexes and costs nothing.
 *
 * Scores decay slightly on every observation, so someone whose work changes is not held to what
 * they said months ago — the recent evidence outweighs the old without ever fully erasing it.
 */
export function observeForRole(text: string): void {
  const t = String(text || '').slice(0, 4000);
  if (t.trim().length < 12) return;
  const s = read();

  const stated = STATED.exec(t);
  if (stated) {
    const hit = STATED_TO_ROLE.find(([re]) => re.test(stated[1]));
    if (hit) {
      s.stated = hit[1];
      if (!s.evidence.includes(stated[0])) s.evidence.unshift(stated[0]);
    }
  }

  let touched = false;
  for (const sig of SIGNALS) {
    const m = sig.re.exec(t);
    if (!m) continue;
    s.scores[sig.role] = (s.scores[sig.role] ?? 0) + sig.weight;
    if (!s.evidence.includes(m[0])) s.evidence.unshift(m[0].slice(0, 60));
    touched = true;
  }
  if (!touched && !stated) return;
  // Gentle decay, applied only when something new arrived.
  for (const k of Object.keys(s.scores) as Array<Exclude<UserRole, ''>>) {
    s.scores[k] = Math.max(0, (s.scores[k] ?? 0) * 0.94);
  }
  s.evidence = s.evidence.slice(0, 8);
  write(s);
}

export function roleGuess(): RoleGuess {
  const s = read();
  if (s.stated) return { role: s.stated, confidence: 1, evidence: s.evidence, stated: true };
  const entries = (Object.entries(s.scores) as Array<[Exclude<UserRole, ''>, number]>)
    .filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return { role: '', confidence: 0, evidence: [], stated: false };
  const [role, top] = entries[0];
  const second = entries[1]?.[1] ?? 0;
  // Confidence is about the MARGIN, not the raw score: two roles neck and neck means we do not
  // know, however much evidence there is for each.
  const total = entries.reduce((a, [, v]) => a + v, 0);
  const confidence = Math.min(1, (top / Math.max(1, total)) * (1 - second / Math.max(top, 1) * 0.5) * (top >= 4 ? 1 : top / 4));
  return { role, confidence, evidence: s.evidence, stated: false };
}

/** The user (or an agent, on the user's say-so) fixing the role explicitly. '' clears everything. */
export function setUserRole(role: UserRole): void {
  if (!role) { write({ scores: {}, evidence: [] }); return; }
  const s = read();
  s.stated = role;
  write(s);
}

/** The line injected into the system prompt. Empty when we do not confidently know. */
export function roleBlock(): string {
  const g = roleGuess();
  if (!g.role || g.confidence < 0.35) return '';
  const label = ROLE_LABEL[g.role as Exclude<UserRole, ''>];
  const how = ROLE_GUIDANCE[g.role as Exclude<UserRole, ''>];
  return `\n\n## Who you are working for\n${g.stated ? 'The user has told you' : 'From how they write, the user appears to be'}: **${label}**.\n${how}\n`
    + (g.stated ? '' : 'This is inferred, not confirmed — if what they ask plainly does not fit it, follow the request and drop the assumption.\n');
}
