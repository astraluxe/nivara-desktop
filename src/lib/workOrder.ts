// ─── The work order behind a plan step ───────────────────────────────────────
//
// A plan line is a TITLE. "Day 8: Publish the comparison page" tells you nothing about which page,
// what goes on it, which of your own notes it draws from, or how you would know it was finished —
// and it is certainly not enough to hand to someone else and walk away.
//
// This is the thing you hand over instead: what the task actually means, who takes it, which of the
// user's real lists and apps it touches, the ordered steps, what "done" looks like, and the
// decisions only the user can make. An agent drafts it, the USER edits and signs it off, and only
// then does anyone start. That is the difference between an office and a button that fires.
//
// The format is labelled lines rather than JSON on purpose. This gets drafted by whatever model the
// user is running — including small local ones — and a dropped brace should not cost them the whole
// draft. Every parser here degrades: an unrecognised line joins the field above it, and a reply
// that parses to nothing at all becomes the summary, which the user can then simply edit.

export interface WorkOrder {
  /** What this task actually means, in the user's own situation. */
  summary: string;
  /** The agent handle it goes to, e.g. "dev.ops". Empty means "whoever the boss thinks". */
  who: string;
  /** The user's real lists, files, notes and connected apps this will touch. */
  uses: string[];
  /** The ordered actions. This is the part the user edits most. */
  steps: string[];
  /** How anyone can tell it is finished. */
  doneWhen: string;
  /** Decisions or facts only the user can supply — asked BEFORE the work starts, not halfway. */
  asks: string[];
}

/** An agent the work can go to: the key the TOOL needs, and the handle a PERSON reads. */
export interface TeamMember { key: string; handle: string }

export function blankWorkOrder(action = ''): WorkOrder {
  return { summary: action, who: '', uses: [], steps: [], doneWhen: '', asks: [] };
}

export function isEmptyOrder(w: WorkOrder): boolean {
  return !w.summary.trim() && !w.steps.length && !w.doneWhen.trim() && !w.uses.length && !w.asks.length;
}

/** The labels a draft may use, and the field each one fills. */
const LABELS: Array<[RegExp, keyof WorkOrder]> = [
  [/^(?:what it means|what this means|means|summary|the job|context)$/i, 'summary'],
  // "handed to" is how formatWorkOrder writes it back out, so it has to read back in — a saved
  // brief is re-parsed every time the sheet is reopened.
  [/^(?:who|owner|agent|assign(?:ed)? to|hand(?:ed)? to)$/i, 'who'],
  [/^(?:uses?|using|inputs?|needs? \(?data\)?|materials?|from my brain)$/i, 'uses'],
  [/^(?:steps?|plan|how|actions?|do this|the steps)$/i, 'steps'],
  [/^(?:done when|finished when|success|definition of done|acceptance)$/i, 'doneWhen'],
  [/^(?:ask me|asks?|needs? from you|questions?|decisions?|before we start|blockers?)$/i, 'asks'],
];

function labelFor(raw: string): keyof WorkOrder | null {
  const key = raw.replace(/[*_`#]/g, '').trim();
  for (const [re, field] of LABELS) if (re.test(key)) return field;
  return null;
}

/** Strip list bullets, numbering and markdown emphasis from the front of a line. */
function bare(line: string): string {
  return line
    .replace(/ /g, ' ')
    .replace(/^\s*(?:[-*•–—]\s+|\d+[.)]\s+)?/, '')
    .replace(/^\s*#{1,6}\s*/, '')
    // A bolded label — "**Done when:** the URL is saved" — is the commonest way a draft hides a
    // field from the parser, because the line then starts with a star rather than a letter and no
    // label can match it. The closing stars are removed later by strip().
    .replace(/^\s*(?:\*\*|__)\s*/, '')
    .trim();
}

// UNDERSCORES ARE NOT ALWAYS EMPHASIS. Stripping every `_` turned "research_agent" into
// "researchagent" and "query_table" into "querytable" — so a work order naming the exact agent key
// and the exact tool came out of the parser naming neither, and the step could no longer be routed
// or handed to anybody. Only a matched _pair_ around a word is markdown; an underscore inside an
// identifier is part of the identifier.
const strip = (s: string) => s
  .replace(/^\*\*|\*\*$/g, '')
  .replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s).,;:!?]|$)/g, '$1$2')
  .replace(/[*`]/g, '')
  .trim();

/**
 * Read a drafted work order, however loosely it was written.
 *
 * Handles the three shapes models actually produce: `WHO: dev.ops` on one line, a `## Steps`
 * heading with a numbered list under it, and bolded `**Done when:**` labels. Anything it cannot
 * place goes to the field above, so no sentence is ever silently dropped.
 */
export function parseWorkOrder(text: string, fallbackSummary = ''): WorkOrder {
  const out = blankWorkOrder();
  const lines = (text || '').replace(/\r/g, '').split('\n');
  // The field a bare line belongs to: either the label that opened this line, or the section
  // heading we are currently underneath.
  let section: keyof WorkOrder | null = null;
  let last: keyof WorkOrder | null = null;

  const put = (field: keyof WorkOrder, value: string, append = false) => {
    const v = strip(value);
    if (!v) return;
    if (field === 'steps' || field === 'uses' || field === 'asks') {
      const list = out[field] as string[];
      // A wrapped line continues the bullet above it rather than becoming a new one.
      if (append && list.length) list[list.length - 1] = `${list[list.length - 1]} ${v}`.trim();
      // `USES: a; b, c` on one line is three inputs, not one. A step and a question are SENTENCES,
      // though, and splitting those on their own punctuation turns "Should it name competitors
      // directly, or stay generic?" into two half-questions.
      else if (field === 'uses') list.push(...v.split(/\s*[;,]\s*/).map((x) => x.trim()).filter(Boolean));
      else list.push(v);
      return;
    }
    const cur = out[field] as string;
    out[field] = (append && cur ? `${cur} ${v}` : v).trim() as never;
  };

  for (const raw of lines) {
    if (!raw.trim()) { last = null; continue; }
    const line = bare(raw);
    if (!line) continue;

    // "LABEL: value" — the value may be empty, which opens a section.
    const m = line.match(/^([A-Za-z][A-Za-z ()/]{1,28}?)\s*[:：]\s*(.*)$/);
    if (m) {
      const field = labelFor(m[1]);
      if (field) {
        section = field;
        last = field;
        if (m[2].trim()) put(field, m[2]);
        continue;
      }
    }
    // A bare heading ("Steps", "**Done when**") opens a section with nothing on the line.
    const asHeading = labelFor(line);
    if (asHeading && line.length <= 34) { section = asHeading; last = asHeading; continue; }

    // Everything else belongs to whatever we are under. A new bullet starts a new entry; a plain
    // continuation line is glued to the one before it.
    const target: keyof WorkOrder = section ?? last ?? 'summary';
    const isBullet = /^\s*(?:[-*•–—]\s+|\d+[.)]\s+)/.test(raw.replace(/ /g, ' '));
    put(target, line, !isBullet && last === target);
    last = target;
  }

  // A reply that parsed to nothing is still worth showing — the user can edit prose into shape far
  // more easily than they can recover a draft we threw away.
  if (isEmptyOrder(out)) out.summary = strip(text).trim() || fallbackSummary;
  if (!out.summary.trim()) out.summary = fallbackSummary;
  out.who = out.who.replace(/^@/, '').split(/[\s,]/)[0] || '';
  return out;
}

/** The canonical text kept on the step and shown in the calendar. Reads as a briefing, not a form. */
/**
 * The canonical text kept on the step and shown in the calendar. Reads as a briefing, not a form.
 *
 * It must also survive a ROUND TRIP: this is what gets saved, and it is re-parsed every time the
 * sheet is reopened. A version that read beautifully but lost the steps on the way back in would
 * quietly discard the user's editing work the second time they looked at a task — so every field
 * here is written under a label the parser recognises, and one entry per line where a list can
 * contain punctuation.
 */
export function formatWorkOrder(w: WorkOrder): string {
  const parts: string[] = [];
  if (w.summary.trim()) parts.push(w.summary.trim());
  if (w.steps.length) parts.push(`Steps:\n${w.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
  if (w.uses.length) parts.push(`Uses: ${w.uses.join(', ')}`);
  if (w.doneWhen.trim()) parts.push(`Done when: ${w.doneWhen.trim()}`);
  if (w.asks.length) parts.push(`Needs from you:\n${w.asks.map((a) => `- ${a}`).join('\n')}`);
  if (w.who.trim()) parts.push(`Handed to: ${w.who.trim()}`);
  return parts.join('\n\n');
}

/**
 * Turn the signed-off order into the instruction the team actually receives.
 *
 * Written as a work order rather than a question, because that is what it is: the user has already
 * read it, edited it and approved it. The closing rules exist because the failure mode of a long
 * instruction is an agent that describes the work beautifully and does none of it.
 */
export function workOrderInstruction(
  w: WorkOrder,
  action: string,
  day?: number,
  team: TeamMember[] = [],
): string {
  const lines: string[] = [];
  lines.push(`WORK ORDER${day ? ` — day ${day} of my plan` : ''}: ${action}`);
  // ONE TASK IS USUALLY SEVERAL PEOPLE'S WORK — BUT SAY IT THE WAY THE BOSS UNDERSTANDS.
  //
  // Two separate mistakes lived in the previous version of these three lines, and together they
  // guaranteed nothing would run.
  //
  // First, it named people by their DISPLAY HANDLE — "Nyx.Research". delegate_to_agent takes an
  // agent_key and resolves it with an exact lookup, so even a perfectly formed call would have come
  // back "Unknown agent key". The keys are what the tool accepts; the handle is for the user.
  //
  // Second, it said "use delegate_to_agent for each part", which directly contradicts the boss's own
  // strongest standing rule: a request with more than one deliverable goes to plan_workflow, and
  // repeated delegation is named there as the thing that "goes empty or garbles". Given two orders
  // that cannot both be obeyed, it obeyed neither and printed the calls as prose.
  const crew: TeamMember[] = [];
  for (const m of team) {
    const key = (m?.key || '').trim();
    if (key && !crew.some((c) => c.key === key)) crew.push({ key, handle: (m.handle || key).trim() });
  }
  if (crew.length > 1) {
    lines.push(
      `\nThis is more than one person's job — ${crew.map((c) => c.handle).join(', ')}.`
      + '\nDo it with ONE plan_workflow call: an ordered pipeline, one agent per step, passing each step\'s output into the next with {{prev}}. '
      + 'Do not call delegate_to_agent several times for this, and do not answer the whole thing yourself.'
      + `\nUse these agent_key values EXACTLY as written — they are the only spellings the tool accepts:\n${crew.map((c) => `- "${c.key}"  (${c.handle})`).join('\n')}`,
    );
  } else if (crew.length === 1) {
    lines.push(`\nThis is for ${crew[0].handle}. Delegate it with delegate_to_agent, agent_key exactly "${crew[0].key}".`);
  }
  if (w.summary.trim() && w.summary.trim() !== action.trim()) lines.push(`\n${w.summary.trim()}`);
  if (w.steps.length) lines.push(`\nDo these, in order:\n${w.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
  if (w.uses.length) lines.push(`\nUse what I already have — specifically: ${w.uses.join(', ')}. Check these before creating anything new.`);
  if (w.doneWhen.trim()) lines.push(`\nIt is finished when: ${w.doneWhen.trim()}`);
  if (w.asks.length) {
    lines.push(`\nAsk me these FIRST and wait for my answer — do not guess:\n${w.asks.map((a) => `- ${a}`).join('\n')}`);
  }
  lines.push(
    '\nI have read and approved this work order, so start on it rather than proposing it back to me. '
    + 'Do the parts you can with your tools — browser, files, calendar, connected apps, my saved lists — instead of describing how they would be done.',
  );
  // ── The rules that stop a confident document being mistaken for work ────────
  //
  // Every one of these is something that actually happened on a real work order: an agent invented
  // a git repo and an install script for the user's OWN product, wrote "research conducted via live
  // web search" without searching, quoted pricing "validated with 5 prospects" that no one had ever
  // validated, and said it could not reach the user's list while holding the tool that reads it.
  // A document like that is worse than a refusal, because it looks finished.
  lines.push(
    '\nHOW TO NOT WASTE MY TIME:\n'
    + '- NEVER invent a command, URL, repository, file path, endpoint or install step for my own product or systems. If you do not know it, ask me — a plausible-looking command I then run is worse than no answer.\n'
    + '- Do not claim you searched, read, checked or verified anything unless you actually called the tool that does it in THIS turn. No "research conducted via live web search" unless you ran the search.\n'
    + '- Do not present invented numbers as validated — no prices "validated with 5 prospects", no reply rates, no benchmarks you did not measure. Label a guess as a guess.\n'
    // A run ended "Saved to Brain: ICP-Validation-Pool" having never called save_to_brain, and
    // handed over twenty well-known founders as though they were rows from the user's sheet. Both
    // are worse than doing nothing: the user stops looking for a file that does not exist, and
    // starts outreach against a list they never built.
    + '- Do not say you SAVED, CREATED, SENT or ADDED anything unless you called the tool and it worked. If you produce a list or a document, call save_to_brain so it really exists, and tell me what you named it.\n'
    + '- Any person or company you name must come from a tool result you actually received this turn — query_table on my sheet, a search, a page you opened. A plausible list of well-known founders is not my list, and presenting one as "filtered from your Brain" is the worst thing you can hand me.\n'
    + '- Before saying you cannot reach something of mine, CHECK: you can read my saved lists and notes, filter a spreadsheet by column, search the web, drive a browser and use my connected apps. Try the tool before reporting a limitation.\n'
    // Both agents on the failing run ended by asking the user to paste 525 rows they could have
    // read themselves. Asking someone to hand you data you are holding the key to is the clearest
    // possible signal that no work happened.
    + '- NEVER ask me to paste, export or share my own data with you. My lists and sheets are in the Brain: call query_table on a big sheet (with no filter first, to see its columns), or recall_from_brain for a note. If you cannot find the one you want, say which titles you DID find and ask which of those it is.\n'
    + '- If a step genuinely needs my hands — a physical machine, a password, a decision only I can make — say so in ONE line and move on. Do not write a substitute procedure to fill the gap.\n'
    + '- Do every other step regardless, then tell me plainly which one you could not do and why.',
  );
  return lines.join('\n');
}

// ─── Running a work order without asking anyone's permission to ──────────────
//
// Twice now an approved work order has produced one agent writing a long document about all of the
// work and doing none of it. The instruction has been sharpened twice and it did not help, because
// the problem was never the wording — it was that the routing decision belonged to a model at all.
//
// The boss carries a standing rule with the highest priority in its prompt: a task that is WRITING,
// ADVISING or STRATEGISING should be answered directly, "EVEN when the request has several
// sections", and explicitly must NOT be delegated. A work order — "write the one-liner, filter the
// sheet, test the install" — reads exactly like that. So the boss was following its own rules
// correctly, and no amount of "please delegate this" further down the same prompt was going to win.
//
// So the work order does not ask. The pipeline is computed here, from the order's own text, and
// injected as the tool call the boss would have had to make. Same lesson as the council: a button
// whose behaviour depends on a model routing correctly is not a button.

export interface Delegation { agent_key: string; task: string }

// ─── Finding the work in a brief that was never written as a list ────────────
//
// The version before this one only split a work order that had a numbered STEP list, and quietly
// collapsed everything else onto one agent. That is not an edge case: it is what the user's own
// day-3 order looked like. Their whole brief — write the one-liner, filter the sheet to Tier 1/2,
// send twenty messages, smoke-test the install, save the pool — arrived as ONE prose paragraph,
// because a drafting model that does not emit `STEP:` lines has its whole reply parked in the
// summary by parseWorkOrder's degrade path. So three approved agents became one, which is the
// exact failure the pipeline exists to prevent, and I shipped it with a test asserting it.
//
// A brief like that is still a list; it is just punctuated as sentences. So read it as one.

/** Abbreviations whose full stop ends nothing. Kept short — these are the ones that actually appear. */
const ABBREV = /(?:^|\s)(?:e\.g|i\.e|etc|vs|approx|no|fig|dept|est|min|max|hrs?|mr|mrs|ms|dr|prof|inc|ltd|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.$/i;

/**
 * Split prose into sentences without cutting inside a quote or a bracket.
 *
 * Naive splitting on `.` tears the deliverable in half, and the deliverable is usually the quoted
 * bit: the one-liner in that order is `"adris.tech = your private AI office: local models scan
 * your code & docs, answer questions, nothing leaves your network."` — four sentence-ends, all of
 * them inside the quotation marks, none of them a boundary.
 */
function splitSentences(line: string): string[] {
  const out: string[] = [];
  let buf = '';
  let quoted = false;
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    buf += c;
    if (c === '"' || c === '“' || c === '”') quoted = !quoted;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    if (quoted || depth > 0) continue;
    // The full stop that ends the one-liner is INSIDE its quotation marks — `nothing leaves your
    // network."` — so the boundary is the closing quote, not the stop. Allow the stop to be
    // followed by whatever closes around it.
    if (!/[.!?]["”')\]]?$/.test(buf)) continue;
    // A boundary also needs whitespace after it AND something that starts a new thought — a
    // capital, a digit or an opening quote. "adris.tech" has no space and never splits.
    const m = line.slice(i + 1).match(/^\s+(.)/);
    if (!m || !/[A-Z0-9"“]/.test(m[1]) || ABBREV.test(buf)) continue;
    out.push(buf.trim());
    // Land on the character that opens the next sentence; the loop's own i++ moves past it.
    i += m[0].length;
    buf = m[1];
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/**
 * The units of work inside a brief, whether or not anyone numbered them.
 *
 * Deliberately conservative: a fragment too short to route is glued back onto the one before it,
 * because "Record time-to-first-answer" is a real instruction and "Pass/fail:" alone is not.
 */
/**
 * The part of a step that says what the WORK is, with the deliverable's own content taken out.
 *
 * A work order quotes the thing being made — the one-liner to write, the cold message to send —
 * and the router reads the whole step, so the quoted material votes on who does the job. It votes
 * badly, because it is written in the language of its own subject rather than of the task:
 *
 *   "Message = 3 sentences naming the pain ("… Open to a 15-min call to see if this hurts you?")"
 *
 * routes to the AUTOMATION agent, on "15-min call", because that looks like scheduling. It is not
 * scheduling; it is a sentence somebody has to write. Same trap in step one, where "local models
 * scan your code & docs" inside the quoted one-liner pulls in the engineers.
 *
 * Only ever used to decide WHO. The agent is always handed the step in full — they need the quote,
 * it is the thing they are making.
 */
export function routingText(step: string): string {
  // Quotation marks only. Brackets were tried too and cost more than they saved: "(Brain or CSV)"
  // is what identifies "save the filtered sheet" as spreadsheet work, and dropping it left the step
  // matching nothing, so the one agent on that team who could have taken it never saw it.
  const stripped = step
    .replace(/"[^"]*"/g, ' ')
    .replace(/“[^”]*”/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // A step that was almost entirely quotation has nothing left to route on — better the noisy
  // original than a two-word fragment that matches whatever rule happens to be first.
  return stripped.length >= 12 ? stripped : step;
}

export function deriveSteps(brief: string, max = 8): string[] {
  const text = (brief || '').replace(/\r/g, '').trim();
  if (!text) return [];
  const out: string[] = [];
  for (const block of text.split(/\n+/)) {
    const line = block.replace(/^\s*(?:[-*•–—]\s+|\d+[.)]\s+)/, '').trim();
    if (!line) continue;
    // Merged WITHIN a line only. A stray "OK." belongs to the sentence beside it, but a short
    // BULLET is its own instruction — glue those together and "Filter the sheet" disappears into
    // the line above it, which is how a whole step stops being anybody's job.
    // The bar is low on purpose. At 28 characters it ate "Then send it to the list." and
    // "Then log every reply." — whole instructions, silently folded into the sentence before them
    // and therefore routed to whoever owned that one. Only true scraps ("OK.", "Pass/fail:") merge.
    const units: string[] = [];
    for (const s of splitSentences(line)) {
      if (units.length && s.length < 16) units[units.length - 1] = `${units[units.length - 1]} ${s}`;
      else units.push(s);
    }
    out.push(...units);
  }
  return out.filter((s) => s.length > 12).slice(0, max);
}

/** The rules every delegate gets, whichever stage it is running. */
const HONESTY = [
  'GROUND RULES:',
  '- NEVER invent a command, URL, repository, file path or install step for the user\'s own product. If you do not know it, say so in one line.',
  '- Do not claim you searched, read or verified anything unless you called the tool in THIS turn.',
  // The failure this was written for: an answer that ended "Saved to Brain: ICP-Validation-Pool"
  // having never called save_to_brain. A claimed save is worse than no save, because the user
  // stops looking for the thing.
  '- Do not claim you SAVED, CREATED, SENT or ADDED anything unless you actually called the tool and it succeeded. If you produce a list or a document, call save_to_brain so it really exists, and say what you called it.',
  '- Do not present invented rows as the user\'s data. If you name people or companies, they must come from a tool result you actually received — query_table on their sheet, a web search, a browser page. A plausible list of well-known founders is not their list.',
  '- NEVER ask the user to paste or export their own data. Their sheets are in the Brain: call query_table with no filter first to see the columns, then again with a filter. recall_from_brain reads an ordinary note.',
  '- If a step genuinely needs the user\'s hands, say so in ONE line. Do not write a substitute procedure.',
].join('\n');

/**
 * Turn an approved work order back into the pipeline that should run it.
 *
 * Reads the instruction that workOrderInstruction() produced — the agent keys, the numbered steps,
 * the context — and assigns each step to whichever named agent suits it, using the same router the
 * panel used to name them. Returns null for anything that is not a work order, so ordinary messages
 * are untouched.
 */
/**
 * The name the order says the result must be saved under, if it says one.
 *
 * "Save the filtered sheet as ICP-Validation-Pool" is a deliverable with a name, and the name is
 * the whole point: it is what Days 4, 13 and 22 go looking for. An agent reported exactly that
 * save as done, in those words, having never called save_to_brain — so the rule was in its brief,
 * the claim was in its answer, and the note was not in the Brain. A rule the model has to remember
 * is a rule that holds most of the time; this one is worth holding every time, so the name comes
 * out here and the save happens in code once the pipeline is finished.
 *
 * Conservative on purpose. It must not fire on "save time as much as possible", so the captured
 * name has to look like a name — a capital or a hyphen, and no sentence-punctuation inside it.
 */
/**
 * The name in a "done when" line, but only when it really is a name.
 *
 * "It is finished when: ICP-Qualified-40 (CSV in Brain)" names the deliverable; "It is finished
 * when: the landing page is live" does not, and creating a Brain note called "the landing page"
 * would be worse than creating nothing. So the capture has to look like an identifier — one token,
 * or something carrying a hyphen — rather than the opening words of a sentence.
 */
function doneWhenName(t: string): RegExpMatchArray | null {
  const m = t.match(/\b(?:it is finished when|finished when|done when)\s*[:—–-]\s*["“']?([^\n"”'(),.;:—–]{3,60})/i);
  const raw = (m?.[1] ?? '').trim();
  if (!raw) return null;
  const looksLikeAName = !/\s/.test(raw) || /-/.test(raw);
  return looksLikeAName ? m : null;
}

export function saveTargetFromOrder(text: string): string {
  const t = text || '';
  const m =
    t.match(/\bsav(?:e|ed|ing)\b[^\n]{0,44}?\bas\s+["“']?([^\n"”'(),.;:—–]{3,60})/i)
    ?? t.match(/\b(?:call|name)\s+it\s+["“']?([^\n"”'(),.;:—–]{3,60})/i)
    ?? t.match(/\b(?:called|named|titled)\s+["“']([^\n"”']{3,60})["”']/i)
    // THE DELIVERABLE IS USUALLY NAMED IN "DONE WHEN", NOT IN A "SAVE IT AS" SENTENCE.
    //
    // The user's own day-3 order ends: "It is finished when: ICP-Qualified-40 (CSV in Brain) —
    // columns: Name, Company, …". Nobody wrote "save it as", so this returned nothing, the
    // deterministic Brain save never ran, and the only thing standing between the user and a note
    // that does not exist was an agent remembering to call save_to_brain. It did not.
    ?? doneWhenName(t);
  const name = (m?.[1] ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    // WHERE it goes is not part of WHAT it is called. "Save the sheet as Tier1-Leads in the Brain"
    // has no punctuation to stop at, so the destination rides along and the note is created under a
    // title nobody will ever search for. Narrow on purpose — only a known destination is trimmed,
    // so a genuine title like "Leads for Q3" survives intact.
    .replace(/\s+\b(?:in|into|to|on|under|as)\b\s+(?:an?\s+|the\s+)?(?:brain|csv|xlsx?|sheet|spreadsheet|notion|drive|doc|document|file|folder|note)\b.*$/i, '')
    .trim();
  if (!name || name.length < 3) return '';
  // A real title carries a capital or a hyphen. Prose ("much as possible") carries neither.
  if (!/[A-Z]/.test(name) && !name.includes('-')) return '';
  return name;
}

export function planFromWorkOrder(
  text: string,
  routeFor: (s: string) => string[],
): Delegation[] | null {
  const t = text || '';
  if (!/^\s*WORK ORDER\b/.test(t)) return null;

  // The team, in the order the panel listed them: `- "content_planner"  (Meera.Content)`
  const keys: string[] = [];
  for (const m of t.matchAll(/^-\s*"([a-z_0-9]+)"\s*\(/gim)) {
    if (!keys.includes(m[1])) keys.push(m[1]);
  }
  // A single-owner order says it in prose instead.
  const solo = t.match(/agent_key exactly "([a-z_0-9]+)"/i);
  if (!keys.length && solo) keys.push(solo[1]);
  if (!keys.length) return null;

  // The numbered steps, if the order has them.
  const stepBlock = t.match(/Do these, in order:\n([\s\S]*?)(?:\n\n|$)/);
  const listed = stepBlock
    ? stepBlock[1].split('\n').map((l) => l.replace(/^\s*\d+\.\s*/, '').trim()).filter((l) => l.length > 3)
    : [];

  // THE QUESTIONS CANNOT BE ASKED FROM INSIDE A PIPELINE.
  //
  // "Ask me these FIRST and wait for my answer" is right when a person is reading, and impossible
  // here: a delegate runs under an explicit "there is NO user to answer questions" rule, so an
  // agent that obeys the order stalls and an agent that ignores it has ignored the order. The
  // questions still matter, so they are carried to the end as assumptions to declare, not gates.
  const askBlock = t.match(/\nAsk me these FIRST[^\n]*\n([\s\S]*?)(?=\n\n|$)/);
  const asks = askBlock
    ? askBlock[1].split('\n').map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean)
    : [];

  // Everything that is not the delegation preamble or the rules — the actual brief.
  const context = t
    // Apostrophe-agnostic: an order that has been through a copy-paste or a model rewrite can come
    // back with a curly one, and a preamble that fails to strip leaves the literal text "{{prev}}"
    // in the brief — which the FIRST stage then carries, with nothing before it to substitute in.
    .replace(/\nThis is (more than one person['’]s job|for )[\s\S]*?(?=\n\n)/, '')
    // The full step list is deliberately removed: each stage is handed its OWN steps below, and
    // giving every agent the whole list is how four agents each produce the whole deliverable.
    .replace(/\nDo these, in order:\n[\s\S]*?(?=\n\n|$)/, '')
    .replace(/\nAsk me these FIRST[^\n]*\n[\s\S]*?(?=\n\n|$)/, '')
    .replace(/\nHOW TO NOT WASTE MY TIME:[\s\S]*$/, '')
    .trim();

  // No numbered list? Then the work is in the prose, and it still has to be split — see deriveSteps.
  // Everything the instruction builder writes under a known heading is removed first, so the title,
  // the approval sentence and the done-when line cannot be mistaken for work to hand out.
  const steps = listed.length ? listed : deriveSteps(
    context
      .replace(/^WORK ORDER[^\n]*\n?/, '')
      .replace(/\nUse what I already have[\s\S]*?(?=\n\n|$)/, '')
      .replace(/\nIt is finished when:[^\n]*/, '')
      .replace(/\nI have read and approved[\s\S]*?(?=\n\n|$)/, '')
      .trim(),
  );

  // ── A STAGE IS A CONTIGUOUS PHASE OF THE WORK, NOT A PILE OF MATCHING STEPS ──
  //
  // Matching each step to its best specialist independently is right about WHO and silent about
  // WHEN, and a pipeline runs in one direction. On the user's day-3 order the writer legitimately
  // matched step 1 (the one-liner), step 5 (rewrite the pain sentence) and step 7 (record the
  // install timing) — so she ran FIRST holding two steps that cannot start until the outreach and
  // the install have happened. Her answer was the one-liner, then "both are blocked on other
  // specialists' deliverables, I'll act when those land." She was right, and nothing came back to
  // her, because an agent appears in the pipeline exactly once (the handler skips a repeat key).
  //
  // So steps keep their order and each agent gets ONE unbroken run of them. A step whose specialist
  // has already had their turn joins the run in progress instead of reopening a closed one.
  const owner: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    // Every approved agent the router would consider for this step, best first — not just the top
    // one. Taking only the top name and giving up when their run had closed is what sent "write the
    // 3-sentence pain message" to the automation manager while an approved MARKETING writer, who
    // was sitting right there in the same alternates list and had not run yet, got nothing at all.
    const matches = routeFor(routingText(steps[i])).filter((k) => keys.includes(k));
    // Usable = the agent currently mid-run (their block simply continues), or anyone whose turn has
    // not come yet (they open a new block). Never someone whose block has already closed.
    const match = matches.find((k) => k === owner[i - 1] || !owner.includes(k));
    if (match) { owner[i] = match; continue; }
    // No approved specialist, or the right one has already been and gone. Either way this belongs
    // with the step in front of it: "record the time-to-first-answer" is part of running the test,
    // not a separate job, and whoever just did the test is the only one holding the answer.
    owner[i] = owner[i - 1]
      // Nothing in front of it yet — hand the opening steps to whoever the work reaches first.
      ?? steps.slice(i + 1).map((s) => routeFor(routingText(s)).find((k) => keys.includes(k))).find(Boolean)
      ?? keys[0];
  }
  const byAgent = new Map<string, string[]>();
  steps.forEach((s, i) => byAgent.set(owner[i], [...(byAgent.get(owner[i]) ?? []), s]));
  // Run in the order the WORK runs, not the order the user happened to tick the boxes. The panel's
  // order is alphabetical-ish and means nothing; a pipeline whose second stage needs the third
  // stage's output is the whole problem this function exists to solve. Anyone who ended up with
  // nothing to do is dropped rather than being given a stage to be idle in.
  const ordered = owner.filter((k, i) => owner.indexOf(k) === i);
  const crew = ordered.length ? ordered : keys.slice(0, 1);

  // ONE PERSON DOES THE WHOLE ORDER.
  //
  // deriveSteps reads a prose brief as sentences, which is right when the work has to be divided
  // between several specialists and actively harmful when it does not. On the user's day-3 order
  // — one agent, no numbered list — the only sentence that survived the heading strippers was
  // "Agent: querytable + recallfrombrain; you review 15 min at 11am", so the agent was told its
  // part of the job was a note about an 11am review. The actual task, the deliverable and its
  // columns were all sitting in the context above, marked as background. Splitting is only ever
  // worth its risk when there is more than one person to split between, or when the user actually
  // numbered the steps themselves.
  const splitByStep = crew.length > 1 || listed.length > 0;
  /** The name the order gives its deliverable, if it gives one — see saveTargetFromOrder. */
  const orderSaveName = saveTargetFromOrder(t);

  return crew.map((key, i) => {
    const mine = splitByStep ? (byAgent.get(key) ?? steps) : [];
    const isLast = i === crew.length - 1;
    return {
      agent_key: key,
      task: [
        context,
        '',
        mine.length ? `YOUR PART OF THIS — do exactly these, and only these:\n${mine.map((s, j) => `${j + 1}. ${s}`).join('\n')}` : 'YOUR PART: the whole of the above.',
        // The brief above describes the WHOLE job, and an agent reading a whole job tends to do a
        // whole job. Saying who covers the rest is what makes the rest somebody else's.
        crew.length > 1
          ? `The rest of the order is context only — ${crew.length - 1} other specialist${crew.length === 2 ? ' is' : 's are'} covering it in this same pipeline. Do not do their parts.`
          : '',
        i > 0 ? '\nWHAT THE PEOPLE BEFORE YOU PRODUCED — build on it, do not repeat it:\n{{prev}}' : '',
        '',
        HONESTY,
        // Carried from the order's ASK ME block, which cannot be asked from in here.
        asks.length
          ? `\nTHE USER WAS NEVER ASKED THESE, AND CANNOT BE ASKED NOW:\n${asks.map((a) => `- ${a}`).join('\n')}\nMake the most reasonable assumption, carry on, and LABEL it clearly as an assumption in what you hand back. Do not stop and do not ask.`
          : '',
        '',
        isLast
          // NAME THE DELIVERABLE. "Under the name the order gives it" asks the agent to find the
          // name in a page of prose; saveTargetFromOrder has already found it, so say it.
          ? `YOU ARE LAST. Before you finish: ${orderSaveName
              ? `call save_to_brain with the title EXACTLY "${orderSaveName}" and the finished content as the body — that named note IS the deliverable, and a later day goes looking for it`
              : 'save anything the order asked to be saved with save_to_brain under the name the order gives it'}`
            + '. Also save any page or document you created or will need again with save_link, and add any genuine follow-up as a to-do with create_todo. '
            + 'Then give the user the finished work — the real content, not a description of it — and one honest line on anything nobody could do.'
          : 'Hand back the finished content itself, not a summary of it. The next person builds directly on what you write.',
      ].filter(Boolean).join('\n'),
    };
  });
}

/**
 * The brief given to the agent that DRAFTS the work order.
 *
 * It is told to ask rather than invent, because the whole point of showing the draft to the user
 * first is that the wrong assumptions get caught before anyone acts on them — an invented list name
 * that reaches the run stage is an agent confidently working on nothing.
 */
export function draftPrompt(opts: {
  action: string;
  day?: number;
  doneWhen?: string;
  note?: string;
  planTitle?: string;
  planSource?: string;
  roster?: string;
}): string {
  return [
    `Write the WORK ORDER for one task from my plan${opts.planTitle ? ` ("${opts.planTitle}")` : ''}.`,
    '',
    `THE TASK${opts.day ? ` (day ${opts.day})` : ''}: ${opts.action}`,
    opts.doneWhen ? `The plan says it is done when: ${opts.doneWhen}` : '',
    opts.note ? `My own note on it: ${opts.note}` : '',
    opts.planSource ? `\nWHERE THIS TASK CAME FROM — the answer the plan was written from. The detail behind the task is in here, so use it rather than inventing your own:\n"""\n${opts.planSource.slice(0, 4000)}\n"""` : '',
    opts.roster ? `\nWHO YOU CAN HAND IT TO:\n${opts.roster}` : '',
    '',
    'This goes in front of me to read, edit and approve BEFORE anyone starts work, so it must be specific enough to act on and honest about what it does not know.',
    '',
    'Rules:',
    '- Name MY real things. My actual lists, notes and connected apps — never a placeholder like "your CRM" or a list I do not have. If you are not sure a thing exists, put it under ASK ME instead of asserting it.',
    '- Steps are actions, not topics. "Filter <list> to rows with an email and a Bengaluru address" is a step; "Do research" is not.',
    '- Between 3 and 7 steps. If it needs more than 7, the task is really two tasks — say so in WHAT IT MEANS.',
    '- Put anything you would otherwise guess under ASK ME. A short work order with two honest questions beats a long one built on assumptions.',
    '',
    'Reply in EXACTLY this format and nothing else — no preamble, no closing remarks:',
    'WHAT IT MEANS: <2-3 sentences on what this task really is for me and why it is on the plan>',
    'WHO: <one agent handle from the list above>',
    'USES: <my real lists / notes / apps, separated by semicolons>',
    'STEP: <first action>',
    'STEP: <second action>',
    'STEP: <…>',
    'DONE WHEN: <how anyone can tell it is finished>',
    'ASK ME: <a decision or fact only I can give — one per line, or omit entirely if there genuinely are none>',
  ].filter((l) => l !== '').join('\n');
}
