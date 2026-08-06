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
      : '',
    '',
    'BE SPECIFIC TO THIS SETUP. "Do outreach" is not advice; "Day 4: run /outreach on <the actual list>, filtered to the rows with an email, purpose = book 15-minute calls" is. Never suggest buying or building something they already have here. If what you would recommend genuinely is not possible with these tools, say so plainly rather than pretending it is.',
    '---',
    '',
  ].filter(Boolean).join('\n');
}
