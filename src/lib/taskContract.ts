// ─── What this request REQUIRES, whoever typed it and however they said it ───
//
// A user types a sentence. Sometimes it is "filter Vendor master 1 to ICP companies", sometimes
// "find me 200 non-tech companies in Bangalore", sometimes "book Tuesday 3pm with Ravi and send
// him the deck". They will not type a slash command, they will not name a tool, and they should
// not have to — working out what the job needs is the whole reason there is an agent in front of
// them.
//
// Everything went wrong in the same place. The boss read a request, decided for itself what to do,
// and nothing ever checked that decision against what the request actually needed. So:
//
//   • "find 200 companies"          → answered from memory, no search ever run
//   • "filter Vendor master 1"      → 12 real rows read, 13 more invented
//   • "output → new Brain list X"   → nothing saved, and nothing said about it
//
// Three different symptoms of one absence: no contract. This module writes that contract, before
// the model sees the request:
//
//   requiredToolsFor(text) → the groups of tools this job cannot honestly be done without
//
// A GROUP means "at least one of these". Finding real companies is satisfied by web_search OR a
// browser OR handing it to a specialist who will do one of those — what is NOT acceptable is none
// of them. That looseness is deliberate: the contract says what the job needs, not how to do it,
// so an agent that finds a better route still passes.
//
// Two uses, and both matter:
//   1. BEFORE — the requirement goes into the prompt, in plain words, as a rule for the turn.
//   2. AFTER  — what actually ran is checked against it. Prompts are advice; this is the check.
//
// Deterministic and synchronous. No model call, so a free key gets exactly the same contract as a
// paid one — which is the point, since the weak models are the ones that need it.

export interface ToolRequirement {
  /** At least one of these must actually run. */
  anyOf: string[];
  /** Said to the model beforehand, and to the user if it is broken. */
  why: string;
  /** Short label for the failure message. */
  what: string;
}

export interface TaskContract {
  requirements: ToolRequirement[];
  /** True when the job plainly cannot be answered out of the model's own head. */
  needsRealWork: boolean;
}

/** Delegating is always an acceptable way to meet a requirement — the specialist has the tools. */
const HANDOFF = ['delegate_to_agent', 'plan_workflow'];

/** Anything that reads a live page counts as "actually looked it up". */
const LOOKUP = ['web_search', 'browser_search', 'browser_navigate', 'browser_open', 'browser_get_text',
  'research_companies', 'research_person', 'enrich_lead_list', 'verify_lead_list', 'scrape_structured',
  'linkedin_scan_connections', 'fetch_open_data'];

/** Anything that reads what the user already has. */
const OWN_DATA = ['query_table', 'recall_from_brain', 'read_file', 'find_my_file', 'search_local_files',
  'extract_contacts', 'drive_read_file', 'sheets_read', 'read_my_work', 'find_link'];

/** Anything that writes to the Brain. */
const BRAIN_WRITE = ['save_to_brain', 'edit_brain', 'save_link', 'link_in_brain'];

const CALENDAR = ['create_calendar_event', 'gcal_create_event', 'read_my_calendar', 'gcal_list_events', 'get_availability'];

const EMAIL_SEND = ['gmail_send_email', 'gmail_send_bulk', 'compose_email'];

const DOC_MAKE = ['generate_document', 'save_to_my_folder'];

/** A question about the app, or chit-chat, requires nothing. */
function isConversational(t: string): boolean {
  if (t.length < 12) return true;
  if (/^\s*(hi|hey|hello|thanks|thank you|ok|okay|cool|nice|yes|no|sure)\b/i.test(t)) return true;
  // Asking what something IS, or how the app works, is answered from knowledge — correctly.
  if (/^\s*(what is|what's|whats|who is|explain|tell me about|how does|how do you|can you|could you|do you)\b/i.test(t)
      && !/\b(my|our)\b/i.test(t)) return true;
  return false;
}

/**
 * The tools this request cannot honestly be completed without.
 *
 * Conservative by design. An unnecessary requirement is not harmless: it would force a tool call on
 * a request that did not need one, burning the user's quota and slowing every message down. So a
 * rule earns its place only when skipping the tool would necessarily mean making something up.
 */
export function requiredToolsFor(text: string): TaskContract {
  const t = String(text || '').trim();
  const none: TaskContract = { requirements: [], needsRealWork: false };
  if (!t) return none;

  // ── Real-world facts ───────────────────────────────────────────────────────
  // Computed BEFORE the small-talk bail, because "what is the current price of gold today" opens
  // exactly like a question answerable from knowledge and is precisely the kind that is not.
  const findsRealThings = /\b(find|search|look ?up|research|gather|collect|source|scout|identify|compile)\b/i.test(t)
    // "list" is a verb only at the start — "build an xlsx of my lead list" is a NOUN, and reading
    // it as a verb made a file request demand a web search.
    || /^\s*list\b/i.test(t);
  const aboutRealEntities = /\b(compan(y|ies)|business(es)?|firms?|startups?|brands?|vendors?|suppliers?|manufacturers?|founders?|ceos?|people|prospects?|leads?|competitors?|investors?|creators?|influencers?|agencies|customers?|clients?)\b/i.test(t);
  const isWritingTask = /\b(blog|article|essay|deck|presentation|slides?|script|outline|strategy|plan|template|summary|explain|ideas?)\b/i.test(t);
  const asksCurrentFacts = /\b(current|latest|today'?s|right now|live|up[- ]to[- ]date|this (week|month|year)|202[5-9]|price of|news)\b/i.test(t)
    && /\b(price|news|rate|stock|weather|score|release|update|status|trend)\b/i.test(t);
  const needsLookup = (findsRealThings && aboutRealEntities && !isWritingTask) || asksCurrentFacts;

  if (isConversational(t) && !needsLookup) return none;

  const reqs: ToolRequirement[] = [];
  const add = (r: ToolRequirement) => { if (!reqs.some((x) => x.what === r.what)) reqs.push(r); };

  // ── The user's own data ────────────────────────────────────────────────────
  // "my sheet", "the vendor list", a named Brain note. The model has never seen any of it, so an
  // answer produced without reading it is fiction by construction.
  //
  // A DESTINATION IS NOT A SOURCE. "save them to my brain" and "put them in the list" name where
  // the output goes; read as a source they made every save-and-search request also demand a read
  // of data that does not exist yet. The destination phrase is cut out before this test runs.
  const withoutDestinations = t.replace(
    /\b(save|store|keep|put|add|write|record|file|output|append)\b[^.]{0,30}?\b(to|in|into|onto)\b\s*(?:my |our |the |a |an |new )*(brain|lists?|notes?|folder|file)\b/gi, ' ');
  const refersToOwnData =
    // Allow a couple of adjectives between "my" and the noun: "my top 10 customers", "our main list".
    /\b(my|our)\s+(?:[\w-]+\s+){0,3}(sheet|spreadsheet|list|lists|note|notes|file|files|data|brain|contacts?|leads?|vendors?|suppliers?|customers?|clients?|connections?|campaign|calendar|inbox|emails?)\b/i.test(withoutDestinations)
    || /\b(vendor master|lead list)\b/i.test(withoutDestinations)
    || /\b(from|in|on)\s+the\s+(sheet|spreadsheet|list|note|file|brain)\b/i.test(withoutDestinations)
    || /\bquery_table\b/i.test(withoutDestinations);
  if (refersToOwnData) {
    add({ anyOf: [...OWN_DATA, ...HANDOFF], what: 'read the user\'s own data',
          why: 'This request is about data the user already has. You have never seen it, so it MUST be read with query_table (for a sheet) or recall_from_brain (for a note) before you answer. Never ask the user to paste or export it.' });
  }

  if (needsLookup) {
    add({ anyOf: [...LOOKUP, ...HANDOFF], what: 'actually look it up',
          why: 'This asks for real things that exist outside this app. You MUST call web_search (or open a page in the browser, or delegate to a specialist who will) and build the answer from what comes back. Answering from memory is not allowed here — you have live tools, and anything you recall is unverified.' });
  }

  // ── Saving ─────────────────────────────────────────────────────────────────
  const asksToSave = /\b(save|store|keep|put|add|write|record|file)\b[^.]{0,40}\b(to|in|into|on)\b[^.]{0,20}\b(brain|list|note|folder)\b/i.test(t)
    || /\b(new|a)\s+brain\s+(list|note)\b/i.test(t)
    || /\bput them in (the|a|my)\b/i.test(t);
  if (asksToSave) {
    add({ anyOf: [...BRAIN_WRITE, ...HANDOFF], what: 'save it for real',
          why: 'The user asked for this to be SAVED. Saying it is saved is not saving it — call save_to_brain (or edit_brain to update an existing note) and tell them the exact title you used.' });
  }

  // ── Calendar ───────────────────────────────────────────────────────────────
  if (/\b(book|schedule|set ?up|arrange|create|add|put)\b[^.]{0,40}\b(meeting|call|event|invite|appointment|slot)\b/i.test(t)
      || /\b(am i|are we)\s+free\b/i.test(t)
      || /\bon my calendar\b/i.test(t)) {
    add({ anyOf: [...CALENDAR, ...HANDOFF], what: 'use the real calendar',
          why: 'This is a calendar action. Use the calendar tools — describing an event the user then has to create themselves is not doing it.' });
  }

  // ── Sending mail ───────────────────────────────────────────────────────────
  if (/\b(send|email|mail)\b[^.]{0,30}\b(to|him|her|them)\b/i.test(t) && /\bemail|mail\b/i.test(t)
      && !/\b(draft|write|prepare|compose)\b/i.test(t)) {
    add({ anyOf: [...EMAIL_SEND, ...HANDOFF], what: 'actually send it',
          why: 'The user asked for mail to be SENT, not drafted. Use the email tool, and confirm what went to whom.' });
  }

  // ── A real file ────────────────────────────────────────────────────────────
  if (/\b(make|create|build|generate|produce|export|give me)\b[^.]{0,40}\b(pdf|xlsx|excel|spreadsheet|docx|word doc|pptx|powerpoint|deck|presentation|report|document|one[- ]?pager|invoice)\b/i.test(t)
      && !/\b(outline|plan for|idea|structure|about)\b/i.test(t)) {
    add({ anyOf: [...DOC_MAKE, ...HANDOFF], what: 'produce the actual file',
          why: 'The user asked for a real file. generate_document writes an actual .pdf/.xlsx/.docx/.pptx — text in the chat that describes the document is not the document.' });
  }

  return { requirements: reqs, needsRealWork: reqs.length > 0 };
}

/** The block that goes into the system prompt for this turn. Empty when nothing is required. */
export function contractDirective(c: TaskContract): string {
  if (!c.requirements.length) return '';
  return [
    '',
    '## What THIS request requires (non-negotiable)',
    'The app has read the user\'s message and worked out what it cannot be done without. These are',
    'not suggestions — a reply that skips them is wrong however good it reads:',
    ...c.requirements.map((r, i) => `${i + 1}. **${r.what}** — ${r.why}`),
    '',
    'If you delegate, the specialist inherits this and must satisfy it. If a tool genuinely fails or',
    'returns nothing, say so plainly in one line — an honest "the search came back empty" is a correct',
    'answer. Filling the gap from memory is not.',
  ].join('\n');
}

/**
 * Which requirements were not met by what actually ran.
 *
 * `used` is the list of tool names that really executed this turn.
 */
export function unmetRequirements(
  c: TaskContract,
  used: string[],
  opts: {
    /**
     * The data was already fetched and handed over — a delegation whose brief carries the rows,
     * or a pipeline stage receiving the previous stage's output.
     *
     * Without this the check backfires: the boss runs query_table, passes 200 rows to a specialist
     * to tag, and the specialist is then told it failed to read the user's data and sent back to
     * re-read a sheet it is holding. Fetching requirements are about not INVENTING data; data you
     * were given is not invented, so they are met.
     */
    dataProvided?: boolean;
  } = {},
): ToolRequirement[] {
  const ran = new Set(used.map((u) => String(u || '')));
  return c.requirements.filter((r) => {
    if (opts.dataProvided && (r.what === 'read the user\'s own data' || r.what === 'actually look it up')) return false;
    return !r.anyOf.some((n) => ran.has(n));
  });
}

/** Does this brief already CARRY the data (a real table, or a substantial pasted body)? */
export function carriesData(brief: string): boolean {
  const t = String(brief || '');
  const rows = t.split('\n').filter((l) => l.trim().startsWith('|') && (l.match(/\|/g) ?? []).length >= 3).length;
  return rows >= 4 || t.length > 4000;
}

/** The correction sent back to the model when it finished without doing what the job needed. */
export function correctionFor(unmet: ToolRequirement[]): string {
  return [
    'STOP — you finished without doing what this request actually needs.',
    '',
    ...unmet.map((r) => `• You did not ${r.what}. ${r.why}`),
    '',
    'Do it now, with the real tool, and then answer from what comes back. Do not describe what you',
    'would do, do not tell the user to do it themselves, and do not produce a result you have not',
    'actually got. If a tool fails or genuinely returns nothing, say that in one line instead.',
  ].join('\n');
}
