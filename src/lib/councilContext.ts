// ─── What the council is allowed to assume exists ─────────────────────────────
//
// A council that does not know what the user has produces the advice any assistant would: "build a
// referral loop", "define your conversion metric", "test two price points". All true, all
// unactionable, and none of it says WHICH of the user's lists, WHICH day, or WHICH part of this app
// does the work. The user then has to translate every suggestion into something they can start,
// which is the job they asked the council to do.
//
// So each member is handed a short, factual briefing: the departments that exist, the commands that
// actually run, and — the part that makes it concrete — the lists and notes sitting in this user's
// own Brain right now. Advice can then be "Day 4: run /outreach on 'Vendor master 1', filtered to
// the 40 with emails" instead of "do some outreach".
//
// Deliberately SHORT. It goes into five prompts, so every line has to earn its place, and a long
// inventory would crowd out the question itself.

import { brain } from './knowledgeStore';
import { loadPlan } from './planStore';
import { roleGuess, ROLE_LABEL, ROLE_GUIDANCE } from './userRole';
import { loadAvailability, describeAvailability } from './availability';

/** The commands a user can actually run, described by what they DO rather than what they are called. */
const CAPABILITIES = [
  '/leads — build a verified list of real named people (name, company, profile, email) from a spec',
  '/scan — pull the user\'s LinkedIn connections into a list',
  '/outreach — pick a list, name the campaign, say what it is for; it drafts a message per person and opens the copilot that tracks who replied. Works from email, LinkedIn, X or Instagram — not LinkedIn only',
  'query_table — filter a big saved spreadsheet by column (location, size, sector) without reading all of it',
  'Brain — every list, note and file the user has saved, searchable and reusable',
  'Guard — scans contracts and documents locally, nothing uploaded',
  'Automation — scheduled multi-step flows that run on their own',
  'Studio + open_content_studio — decks, and free web tools (Pomelli for campaign images, NotebookLM for briefings and podcast/video overviews)',
  'Coder — a real editor with the project open, agents that write and change files',
  'The plan panel — dated day-by-day steps, ticked off, feeding the To-do list',
];

/** Titles of the user's saved lists and notes, so advice can name the real thing. */
function brainInventory(max = 14): string[] {
  try {
    const nodes = brain.all().nodes
      .filter((n) => ['list', 'data', 'outreach', 'file', 'note'].includes(n.kind) && (n.body || '').trim().length > 40)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return nodes.slice(0, max).map((n) => {
      const rows = (n.body.match(/\n/g) || []).length;
      return `${n.title}${rows > 12 ? ` (~${rows} rows)` : ''}`;
    });
  } catch { return []; }
}

/**
 * When this person can actually work, and where in the world they are.
 *
 * Both matter for advice that survives contact with a real week. The timezone decides when to send
 * a message so it lands at the start of someone's day rather than at 2am; the stated working hours
 * and days off decide how much can honestly be scheduled. Neither is guessed — if the user has not
 * said, the council is told to ask rather than assume a nine-to-five.
 */
function timing(): string {
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } })();
  const now = new Date();
  const lines = [`\nWHEN THEY WORK — timezone ${tz || 'unknown'}, local time now ${now.toLocaleString(undefined, { weekday: 'long', hour: '2-digit', minute: '2-digit' })}.`];
  let a = null;
  try { a = loadAvailability(); } catch { /* none saved */ }
  if (a) {
    try { lines.push(`Their stated hours: ${describeAvailability(a)}`); } catch { /* shape changed — skip */ }
    lines.push('Schedule INSIDE those hours and never on their days off. If the work does not fit, say what to cut rather than quietly overfilling the week.');
  } else {
    lines.push('They have NOT told the app their working hours. Do not assume full-time availability — say what your plan assumes about their time, or ask.');
  }
  lines.push('Timing advice should be concrete and local: outreach lands best early in the recipient\'s working morning, and for India that means late morning IST for domestic contacts and evening IST for US contacts. Say which timezone you mean.');
  return lines.join('\n');
}

/**
 * The briefing appended to every council member's prompt.
 *
 * `includePlan` is off for questions that are not about the plan — a contract review does not need
 * thirty dated steps pasted into it.
 */
export function councilContext(includePlan = true): string {
  const g = roleGuess();
  const inventory = brainInventory();
  const plan = includePlan ? loadPlan() : null;

  const who = g.role && g.confidence >= 0.35
    ? `WHO YOU ARE ADVISING: ${ROLE_LABEL[g.role as Exclude<typeof g.role, ''>]}. ${ROLE_GUIDANCE[g.role as Exclude<typeof g.role, ''>]}`
    : 'WHO YOU ARE ADVISING: not established yet — do not assume they are a startup founder. They may be a student, a freelancer, an agency owner, someone running a shop, or an employee. If the answer would differ, say which case you are answering for.';

  return [
    '',
    '---',
    who,
    '',
    'WHAT THIS PERSON ALREADY HAS — advice must use these rather than inventing new machinery:',
    ...CAPABILITIES.map((c) => `- ${c}`),
    inventory.length
      ? `\nTHEIR OWN SAVED LISTS AND NOTES (name the real one in your advice):\n${inventory.map((t) => `- ${t}`).join('\n')}`
      : '\nTHEIR BRAIN IS EMPTY so far — building the first list is itself a step worth naming.',
    plan
      ? `\nTHE PLAN CURRENTLY RUNNING: "${plan.title}" — ${plan.steps.filter((s) => s.done).length}/${plan.steps.length} steps done.`
        + `\nUNFINISHED STEPS ONLY (these are the ones you may re-plan — the finished ones are a record of what really happened and must NEVER be moved, re-added or repeated):\n`
        + plan.steps.filter((s) => !s.done).slice(0, 40).map((s) => `- Day ${s.day}: ${s.action}`).join('\n')
      : '',
    // WHEN they can actually work is half of whether a plan is realistic. A schedule that puts
    // "run 2 discovery calls" on a day off, or eight hours of work on someone with a full-time
    // job, is a plan that gets abandoned in week two.
    timing(),
    '',
    'IF YOU RE-PLAN: give the revised days as "Day N: action" lines so they can be applied straight into the plan panel. Re-plan ONLY the unfinished steps listed above — never restate, move or re-add a finished one, and never renumber around them.',
    'BE SPECIFIC TO THIS SETUP. "Do outreach" is not advice; "Day 4: run /outreach on <the actual list>, filtered to the rows with an email, purpose = book 15-minute calls" is. Never suggest buying or building something they already have here. If what you would recommend genuinely is not possible with these tools, say so plainly rather than pretending it is.',
    '---',
    '',
  ].filter(Boolean).join('\n');
}
