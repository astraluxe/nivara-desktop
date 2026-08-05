// ─── What the user has ALREADY done ──────────────────────────────────────────
//
// Every plan an agent wrote began at zero. "Day 5: list 50 target companies", "Day 10: send 20
// connection requests" — written to somebody who had already scanned 700 LinkedIn connections,
// already built a lead list of founders, and already messaged a dozen of them. A plan that ignores
// the work behind you is not a plan, it is a reset, and following it means doing everything twice.
//
// This reads the state the app already holds — the outreach campaign, the scanned connections, the
// lead lists in the Brain — and states it plainly so the plan starts from where the user actually
// is. Cheap and synchronous: localStorage reads and counts, no model call and no network, so it
// costs the same on a free NVIDIA key as on the hosted one.
//
// Nothing here is inferred. If a number cannot be read it is left out rather than guessed, because
// a plan built on an invented starting point is worse than one built on none.

import { brain } from './knowledgeStore';
import { loadPlan, planProgress } from './planStore';

interface Snapshot {
  /** People in the live outreach campaign, by where they got to. */
  outreach?: { total: number; messaged: number; replied: number; meetings: number; pending: number; title?: string };
  /** LinkedIn connections already scanned into the app. */
  connections?: number;
  /** Brain notes that are lead lists, with their row counts. */
  leadLists?: { title: string; rows: number }[];
  plan?: { title: string; done: number; total: number; day: number };
}

function readJson<T>(key: string, fallback: T): T {
  try { const r = localStorage.getItem(key); return r ? (JSON.parse(r) as T) : fallback; } catch { return fallback; }
}

/** Count the data rows in a markdown table, ignoring the header and the |---| separator. */
function tableRows(body: string): number {
  return (body || '').split('\n')
    .filter((l) => l.trim().startsWith('|') && !/^\|?[\s:|-]+\|?$/.test(l.trim()))
    .length - 1;   // minus the header
}

export function readWorkState(): Snapshot {
  const snap: Snapshot = {};

  // ── The live outreach campaign ──
  try {
    const c = readJson<{ title?: string; contacts?: { status?: string }[] }>('nv-outreach-v1', {});
    const contacts = Array.isArray(c?.contacts) ? c.contacts : [];
    if (contacts.length) {
      const by = (s: string) => contacts.filter((x) => x?.status === s).length;
      snap.outreach = {
        total: contacts.length,
        messaged: by('sent'),
        replied: by('replied'),
        meetings: by('meeting') + by('met'),
        pending: by('connect'),
        title: c.title,
      };
    }
  } catch { /* no campaign — leave it out entirely rather than reporting zeroes */ }

  try {
    const conns = readJson<unknown[]>('nv-li-connections', []);
    if (Array.isArray(conns) && conns.length) snap.connections = conns.length;
  } catch { /* ignore */ }

  try {
    const lists = brain.all().nodes
      .filter((n) => /lead|prospect|target|founder|contact|connection/i.test(n.title) && /\|/.test(n.body || ''))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 4)
      .map((n) => ({ title: n.title, rows: tableRows(n.body || '') }))
      .filter((x) => x.rows > 0);
    if (lists.length) snap.leadLists = lists;
  } catch { /* ignore */ }

  try {
    const p = loadPlan();
    if (p) {
      const pr = planProgress(p);
      snap.plan = { title: p.title, done: pr.done, total: pr.total, day: Math.max(1, Math.floor((Date.now() - new Date(p.startDate + 'T00:00:00').getTime()) / 86400000) + 1) };
    }
  } catch { /* ignore */ }

  return snap;
}

/**
 * The prompt block. Empty string when the user genuinely has nothing yet — a first-time user should
 * get a from-scratch plan, and claiming otherwise would be its own kind of lie.
 */
export function workStateNote(): string {
  const s = readWorkState();
  const facts: string[] = [];

  if (s.outreach) {
    const o = s.outreach;
    const bits = [`${o.total} people in the current outreach list${o.title ? ` ("${o.title}")` : ''}`];
    if (o.messaged) bits.push(`${o.messaged} already messaged`);
    if (o.pending) bits.push(`${o.pending} connection requests already sent and waiting`);
    if (o.replied) bits.push(`${o.replied} have replied`);
    if (o.meetings) bits.push(`${o.meetings} meetings booked`);
    facts.push(`OUTREACH ALREADY IN PROGRESS: ${bits.join(', ')}.`);
  }
  if (s.connections) facts.push(`${s.connections} LinkedIn connections have already been scanned into the app and are searchable.`);
  if (s.leadLists?.length) {
    facts.push(`LEAD LISTS ALREADY BUILT (in the Brain, readable with recall_from_brain): ${s.leadLists.map((l) => `"${l.title}" (${l.rows} people)`).join(', ')}.`);
  }
  if (s.plan) facts.push(`A plan is already running: "${s.plan.title}" — day ${s.plan.day}, ${s.plan.done} of ${s.plan.total} steps done.`);

  if (!facts.length) return '';

  return [
    'WHAT THE USER HAS ALREADY DONE — do not plan as if they are starting today:',
    ...facts.map((f) => `- ${f}`),
    'When you write or revise a plan, BUILD ON THIS. Do not tell them to find leads they already have, to scan connections already scanned, or to message people already messaged — point them at the existing list by name instead ("message the next 20 from your lead list", not "build a list of 50 companies").',
    'If a step depends on something you cannot see from here, CHECK rather than assume: recall_from_brain for the lists, or the browser to look at their real LinkedIn. A plan that repeats finished work is worse than no plan, because they will follow it.',
  ].join('\n');
}
