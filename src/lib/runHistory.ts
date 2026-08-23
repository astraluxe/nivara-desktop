// ─── Keeping the ACTUAL TASK in the tool loop's context ───────────────────────
//
// Every agent loop in the app does the same thing: stream a turn, run the tool it asked for, push
// the result back, go round again. Context has to stay bounded or the third round costs more than
// the whole task, so each loop trimmed itself with:
//
//     if (history.length > 9) history.splice(1, history.length - 9);
//
// "Keep the first message and the last eight." That is right when the array STARTS at the task —
// which is true for a delegation (`[{ role:'user', content: task }]`) and false for the boss, whose
// array is the WHOLE CONVERSATION with the new request pushed onto the end:
//
//     [ ...every earlier message..., "explain how B2B deals work" ]
//        ↑ index 0 is whatever was said first, days ago
//
// So the message the trim protected was an old one, and the request the user had just typed sat in
// the middle of the array where the splice ate it. Two tool calls in, the model was looking at an
// unrelated opening message plus a couple of tool results and no statement of what it was doing —
// which is exactly the reported behaviour: fine for the first message or two of a fresh chat, then
// it "forgets the task" or "does something else" partway through a long one.
//
// The fix is to anchor on the request itself rather than on a position. Pure and synchronous so it
// can be unit-tested without a model, a key, or a browser.

export interface HistoryMsg { role: string; content: string }

/**
 * Bound a tool-loop history WITHOUT losing the request it is working on.
 *
 * Keeps the last `keepTail` entries (the recent tool calls and their results) and guarantees the
 * current request is still in front of them. When the request is already inside the tail — a short
 * run, or a fresh chat — nothing is duplicated.
 *
 * @param history        the running history; not mutated
 * @param currentRequest the message the user actually asked for THIS run
 * @param keepTail       how many trailing entries to keep (8 = four tool-call pairs)
 */
export function trimRunHistory(
  history: HistoryMsg[],
  currentRequest: string,
  keepTail = 8,
): HistoryMsg[] {
  // Nothing to do until the array is longer than the anchor plus the tail.
  if (history.length <= keepTail + 1) return history;

  const tail = history.slice(-keepTail);
  const anchor = String(currentRequest ?? '').trim();
  // No usable request to pin (shouldn't happen — but an empty anchor must never be prepended as a
  // blank user turn, which some providers reject outright).
  if (!anchor) return [history[0], ...tail];

  // Already in the tail? Then it is in context and a second copy would only cost tokens and invite
  // the model to answer it twice.
  const stillThere = tail.some((m) => m.role === 'user' && String(m.content ?? '').trim() === anchor);
  if (stillThere) return tail;

  return [{ role: 'user', content: anchor }, ...tail];
}
