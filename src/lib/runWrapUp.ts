// ─── A run must never just stop ──────────────────────────────────────────────
//
// Reported: "check this portfolio page and find out how much they invested in each" — it made some
// searches and then nothing came back to the chat at all.
//
// That is what the boss loop does when it runs out of steps while still calling tools. It has six
// steps; a research task spends them on searches; the loop condition goes false; the function falls
// out of its `try` into `finally`, and there is nothing between the last tool result and the end of
// the turn that says anything to the user.
//
// There IS a recovery net for a silent turn — but it only fires when the turn produced NO visible
// output, and the boss almost always painted a line like "Let me look at their portfolio page…"
// on the way. So the net sees output, decides the turn worked, and the user is left with an
// announcement and no answer. The delegate loop has guarded against exactly this for a while
// (`cutOffMidWork`, `isJustAnAnnouncement`, `anyToolRan`); the boss loop never did.
//
// This is that guard, extracted so both paths can share one definition and it can be tested without
// a model.

/**
 * Is this the agent SAYING what it is about to do, rather than doing it?
 *
 * "Let me search for their portfolio companies…" is an announcement. Delivered as a final answer it
 * reads as a response that stopped mid-thought — which is precisely how the reported run looked.
 *
 * Deliberately narrow. A real deliverable after tool use is never three lines that end in a colon,
 * so the length ceiling does most of the work and the phrasing test does the rest.
 */
export function isAnnouncementOnly(text: string): boolean {
  const v = String(text || '').trim();
  if (!v) return true;                      // nothing at all is certainly not an answer
  if (v.length > 600) return false;         // long enough to be real work
  // A trailing ellipsis or colon is someone clearing their throat.
  if (/(\.\.\.|…|:)$/.test(v)) return true;
  return /\b(let me|i'?ll|i will|i am going to|i'?m going to|now i|next,? i|first,? i|let'?s)\b[^.]{0,80}\b(search|look|check|find|dig|gather|research|verify|scan|pull|browse|fetch|review|compile|analyse|analyze)/i.test(v);
}

export interface RunState {
  /** Steps consumed by the loop. */
  stepsUsed: number;
  /** The loop's ceiling. */
  maxSteps: number;
  /** Did any tool actually execute this run? */
  anyToolRan: boolean;
  /** Did the final iteration end on a tool call rather than on an answer? */
  endedOnToolCall: boolean;
  /** What the user can currently see from this turn. */
  visibleText: string;
}

/**
 * Should the run be made to stop and write up what it has?
 *
 * Only when there is something to write up. A run that used no tools and produced nothing is a
 * different failure — a silent model — and the empty-turn recovery already handles that one; asking
 * it to "summarise your findings" when it has none would just produce an invented summary.
 */
export function needsWrapUp(s: RunState): boolean {
  if (!s.anyToolRan) return false;                 // nothing to summarise
  const exhausted = s.stepsUsed >= s.maxSteps;
  const stoppedMidWork = exhausted || s.endedOnToolCall;
  if (!stoppedMidWork) return false;
  return isAnnouncementOnly(s.visibleText);
}

/**
 * The instruction that ends a run properly.
 *
 * Two things it must contain, both learned the hard way elsewhere in this file: an explicit "stop
 * calling tools", because otherwise the model spends the last turn on another search; and explicit
 * permission to say the work failed, because a model told only to "produce the answer" will invent
 * one rather than report an empty search.
 */
export function wrapUpInstruction(what: string): string {
  return [
    'STOP using tools now. You have run out of room to keep searching.',
    '',
    `Write the answer to "${what}" from what you have ALREADY found this run — everything the tools`,
    'returned is above. Give the full result in one message: the figures, the table, the names, whatever',
    'was asked for.',
    '',
    'Do NOT call another tool. Do NOT describe what you were about to do next. Do NOT say you will',
    'continue — this is the last thing you write this turn.',
    '',
    'If what came back genuinely was not enough to answer, say exactly that in one or two lines and',
    'say what IS known so far. That is a real answer and it is the one I want. Never invent a figure,',
    'a company or a number to fill the gap.',
  ].join('\n');
}

/**
 * What to tell the user when even the wrap-up produced nothing.
 *
 * Never "(no response)". It has to say what happened, that the work was not lost for nothing, and
 * what they can do — a dead end the user can act on beats a blank.
 */
export function ranOutMessage(toolsUsed: string[], what: string): string {
  const n = toolsUsed.length;
  const list = n ? ` (${[...new Set(toolsUsed)].slice(0, 4).join(', ')})` : '';
  return `I ran ${n} step${n === 1 ? '' : 's'}${list} on that and then hit the limit for one turn `
    + `without getting to a finished answer. Nothing was made up to cover the gap.\n\n`
    + `Send it again and it will pick up from a clean start — or narrow it a little `
    + `("${what.slice(0, 60)}${what.length > 60 ? '…' : ''}" is a lot for one turn) and it will get further.`;
}
