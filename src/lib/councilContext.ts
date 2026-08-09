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

import { brain, nodeToMarkdown } from './knowledgeStore';
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
  // A council can only recommend what it knows exists. Everything below was already shipped and
  // absent from this list, so the panel kept proposing machinery the user already owned — or
  // worse, told them to do by hand something an agent does in one call.
  'The browser — agents open real sites and WORK in them: read a page, fill a form, click through, upload a file. Notion, Google Docs/Sheets, Trello, Airtable, a CMS: the user is already signed in, so no API key is needed. This is how "do it in Notion" becomes a step an agent performs rather than an instruction to the user',
  'Connected apps — Gmail (including bulk send), Notion, Slack, GitHub, Linear, Airtable, Twitter/X, LinkedIn, Google. Any MCP server can be added by URL, and its tools become available to every agent',
  'save_link / find_link — the Brain\'s Links folder: pages an agent made or verified, grouped by site and de-duplicated, so a page built one week is reopened the next instead of rebuilt',
  'save_to_my_folder / find_my_file — ONE folder on the user\'s own computer (Settings → Files, off until they switch it on). Agents save what they make or download there — a generated poster, a rendered video, an exported PDF or CSV — and the path is recorded in the Brain, so "make a poster" and, later, "post that poster" are one job. Only suggest this if it fits; if it is off, say it needs switching on',
  'generate_document — real .pdf, .docx and .xlsx files, not descriptions of them',
  'Deck maker — a full presentation from a brief, with generated images on the paid/own-key path',
  'research_person / verify / enrich — check a real person or company before contact, and fill in the missing LinkedIn, phone and email on a list in one pass',
  'The council itself, and plan work orders — a plan task can be handed to several specialists as one ordered pipeline, each doing their part and passing it on',
  'A team of ~40 named specialists (research, outreach, email, content, ads, data, ops, engineering, finance, design) that can be given a task directly',
];

/**
 * The user's saved lists and notes — with enough shape that a council can tell them APART.
 *
 * This used to emit titles only, and a title is not enough to know what a list IS. A council read
 * "Vendor master 1", concluded from the word "vendor" that those were the user's own suppliers, and
 * built a whole objection on it ("suppliers, not buyers") — when in fact the user had obtained that
 * data and every row on it was a prospect. The advice was confidently wrong about the single most
 * important asset the user had.
 *
 * A title plus its column names is usually enough to settle that: a list carrying `email` and
 * `title` columns is a list of people you can contact, whatever the file happens to be called. It
 * costs a handful of tokens per list and removes a whole class of confident misreading.
 */
function brainInventory(max = 14): string[] {
  try {
    const nodes = brain.all().nodes
      .filter((n) => ['list', 'data', 'outreach', 'file', 'note'].includes(n.kind) && (n.body || '').trim().length > 40)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return nodes.slice(0, max).map((n) => {
      const rows = (n.body.match(/\n/g) || []).length;
      const cols = tableColumns(n.body);
      return `${n.title}${rows > 12 ? ` (~${rows} rows)` : ''}${cols.length ? ` — columns: ${cols.join(', ')}` : ''}`;
    });
  } catch { return []; }
}

/** The header cells of the first markdown table in a note, capped so one wide sheet cannot flood
 *  five prompts. Returns nothing for prose notes, which is the right answer for them. */
export function tableColumns(body: string, max = 7): string[] {
  const md = (() => { try { return nodeToMarkdown(body || ''); } catch { return body || ''; } })();
  const line = md.split('\n').find((l) => (l.match(/\|/g) || []).length >= 2
    // A separator row (|---|:--:|) is all pipes, dashes, colons and space. Anything else with two
    // or more pipes is a real row, and the first real row is the header.
    && !/^[\s|:-]+$/.test(l));
  if (!line) return [];
  const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
  if (cells.length < 2) return [];
  return cells.slice(0, max).map((c) => c.replace(/\*\*/g, '').slice(0, 24));
}

// ─── What the user has already had to correct us on ───────────────────────────
//
// A council that repeats a mistake the user has ALREADY explained is worse than one that never
// knew — the user paid for the correction once and got nothing durable for it. These are kept
// outside the Brain deliberately: the user asked not to have new lists and notes appear every time
// something is learned, and a correction is a note-to-self about how to read what is already there,
// not a new document.

const FACTS_KEY = 'nv-council-facts';

export interface CouncilFact { text: string; at: number }

export function loadCouncilFacts(): CouncilFact[] {
  try {
    const raw = JSON.parse(localStorage.getItem(FACTS_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((f) => f && typeof f.text === 'string') : [];
  } catch { return []; }
}

/** Record a correction. Near-duplicates replace the older wording rather than stacking up. */
export function addCouncilFact(text: string): void {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (clean.length < 8) return;
  const key = clean.toLowerCase().slice(0, 60);
  const kept = loadCouncilFacts().filter((f) => f.text.toLowerCase().slice(0, 60) !== key);
  kept.push({ text: clean.slice(0, 400), at: Date.now() });
  try { localStorage.setItem(FACTS_KEY, JSON.stringify(kept.slice(-24))); } catch { /* full — the council simply learns less */ }
}

export function clearCouncilFacts(): void {
  try { localStorage.removeItem(FACTS_KEY); } catch { /* nothing to clear */ }
}

// ─── Talking back to the council ──────────────────────────────────────────────

/** Order matters: the Executor speaks LAST, because its job is to turn everyone else into Monday
 *  morning and it cannot do that until it has heard them. */
export const COUNCIL_KEYS = [
  'council_contrarian', 'council_first_principles', 'council_expansionist', 'council_outsider', 'council_executor',
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The opening of a long answer, cut at a sentence rather than mid-word. */
export function firstSentences(text: string, max: number): string {
  const flat = (text || '').replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return (stop > max * 0.5 ? cut.slice(0, stop + 1) : cut) + '…';
}

/**
 * Is the user telling the council it got a FACT wrong, as opposed to asking it something?
 *
 * This decides what is remembered for next time, so it is deliberately narrow: it wants an explicit
 * correction marker, not merely a sentence containing the word "not". Being too eager here would
 * fill the council's memory with half-formed questions and quietly poison every later answer, which
 * is much worse than occasionally failing to remember something the user can simply say again.
 */
export function looksLikeCorrection(text: string): boolean {
  const t = (text || '').trim();
  if (t.length < 15) return false;
  return /\b(that'?s (not|wrong|incorrect)|not (my|mine|our|the)|isn'?t (my|mine|our|a|the)|aren'?t (my|mine|our)|actually,?\s|to (be )?clarif|to be clear|for the record|correction|got (it|that|this) wrong|wrong about|misunderstood|mistaken|in fact,?\s|just so you know)\b/i.test(t);
}

/**
 * Which members a follow-up should reach.
 *
 * Addressing someone by name reaches only them — that is ONE model call, and it is how a follow-up
 * stays cheap enough to actually use. Everything else goes to everyone who spoke, because a
 * correction to a shared fact invalidates arguments across the whole council, and silently revising
 * one member's view while leaving four others built on the same mistake is worse than not asking.
 */
export function pickCouncilTargets<T extends { key: string; name: string; human: string }>(
  text: string, voices: T[],
): T[] {
  if (!voices.length) return [];
  if (/\b(everyone|all of you|the whole council|the council|council)\b/i.test(text)) return voices;
  const named = voices.filter((v) => {
    const handles = [v.human, v.name, v.name.split('.')[0]].map((s) => (s || '').trim()).filter((s) => s.length > 2);
    if (!handles.length) return false;
    return new RegExp(`(^|[^a-z0-9])(${handles.map(escapeRe).join('|')})([^a-z0-9]|$)`, 'i').test(text);
  });
  return (named.length && named.length < voices.length) ? named : voices;
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
  const facts = loadCouncilFacts();

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
        + '\nA LIST TITLE IS NOT ITS CONTENTS. Judge what a list is by its COLUMNS, not by a word in its name — a sheet called "Vendor master" may be a bought prospect list, not the user\'s own suppliers. If a list decides your argument and you cannot tell what it is, ASK rather than assume.'
      : '\nTHEIR BRAIN IS EMPTY so far — building the first list is itself a step worth naming.',
    // Things the user has already had to explain once. Repeating a corrected mistake is the fastest
    // way for a council to lose the user's trust in everything else it says.
    facts.length
      ? `\nTHE USER HAS ALREADY CORRECTED THE COUNCIL ON THESE — treat them as settled fact and do not re-litigate them:\n${facts.map((f) => `- ${f.text}`).join('\n')}`
      : '',
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
