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
export function workOrderInstruction(w: WorkOrder, action: string, day?: number): string {
  const lines: string[] = [];
  lines.push(`WORK ORDER${day ? ` — day ${day} of my plan` : ''}: ${action}`);
  if (w.who.trim()) lines.push(`\nThis is for ${w.who.trim()}. Hand it to them.`);
  if (w.summary.trim() && w.summary.trim() !== action.trim()) lines.push(`\n${w.summary.trim()}`);
  if (w.steps.length) lines.push(`\nDo these, in order:\n${w.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
  if (w.uses.length) lines.push(`\nUse what I already have — specifically: ${w.uses.join(', ')}. Check these before creating anything new.`);
  if (w.doneWhen.trim()) lines.push(`\nIt is finished when: ${w.doneWhen.trim()}`);
  if (w.asks.length) {
    lines.push(`\nAsk me these FIRST and wait for my answer — do not guess:\n${w.asks.map((a) => `- ${a}`).join('\n')}`);
  }
  lines.push(
    '\nI have read and approved this work order, so start on it rather than proposing it back to me. '
    + 'Do the parts you can with your tools — browser, files, calendar, connected apps — instead of describing how they would be done. '
    + 'If a step turns out to be genuinely impossible, do every other step, then tell me which one you could not do and why.',
  );
  return lines.join('\n');
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
