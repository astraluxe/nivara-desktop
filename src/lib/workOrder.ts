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

const strip = (s: string) => s.replace(/^\*\*|\*\*$/g, '').replace(/[*_`]/g, '').trim();

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
  const steps = stepBlock
    ? stepBlock[1].split('\n').map((l) => l.replace(/^\s*\d+\.\s*/, '').trim()).filter((l) => l.length > 3)
    : [];

  // Everything that is not the delegation preamble or the rules — the actual brief.
  const context = t
    .replace(/\nThis is (more than one person's job|for )[\s\S]*?(?=\n\n)/, '')
    // The full step list is deliberately removed: each stage is handed its OWN steps below, and
    // giving every agent the whole list is how four agents each produce the whole deliverable.
    .replace(/\nDo these, in order:\n[\s\S]*?(?=\n\n|$)/, '')
    .replace(/\nHOW TO NOT WASTE MY TIME:[\s\S]*$/, '')
    .trim();

  // Assign each step to the best-suited member of the named team. A step nobody matches goes to
  // the first agent, so nothing is silently dropped.
  const byAgent = new Map<string, string[]>();
  for (const s of steps) {
    const wanted = routeFor(s).find((k) => keys.includes(k)) ?? keys[0];
    byAgent.set(wanted, [...(byAgent.get(wanted) ?? []), s]);
  }
  // Keep the panel's order, and drop anyone who ended up with nothing to do.
  const ordered = keys.filter((k) => (byAgent.get(k)?.length ?? 0) > 0);
  const crew = ordered.length ? ordered : keys.slice(0, 1);

  return crew.map((key, i) => {
    const mine = byAgent.get(key) ?? steps;
    const isLast = i === crew.length - 1;
    return {
      agent_key: key,
      task: [
        context,
        '',
        mine.length ? `YOUR PART OF THIS — do exactly these, and only these:\n${mine.map((s, j) => `${j + 1}. ${s}`).join('\n')}` : 'YOUR PART: the whole of the above.',
        i > 0 ? '\nWHAT THE PEOPLE BEFORE YOU PRODUCED — build on it, do not repeat it:\n{{prev}}' : '',
        '',
        HONESTY,
        '',
        isLast
          ? 'YOU ARE LAST. Before you finish: save anything the order asked to be saved with save_to_brain under the name the order gives it, and add any genuine follow-up as a to-do with create_todo. Then give the user the finished work — the real content, not a description of it — and one honest line on anything nobody could do.'
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
