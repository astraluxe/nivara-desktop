// ─── Answer without typing ───────────────────────────────────────────────────
//
// An agent that ends by asking something — "in PowerPoint or here in the chat?", "shall I include
// the diagrams?", "say 'extend the deck' and I'll add more" — leaves the user to retype the answer.
// For the person this product is built for, that is where the work stops.
//
// The old rule only fired on a trailing list of NUMBERED options in the last 900 characters, so the
// commonest shapes — an either/or question, a yes/no offer, a suggested phrase in quotes — produced
// no buttons at all.
//
// The bar for showing a button: it must be something the user could plausibly send verbatim as
// their next message. A button that sends a sentence the agent cannot act on is worse than no
// button, so every extractor below is narrow and everything is capped, deduped and length-checked.

export interface QuickReply {
  /** What the button says. */
  label: string;
  /** What is actually sent — usually the same, but a yes/no keeps the agent's own wording. */
  send: string;
}

/** Nothing sensible can be offered under these. */
function isUnofferable(text: string): boolean {
  const t = String(text || '');
  if (!t.trim()) return true;
  if (t.startsWith('```status ')) return true;      // the live work panel, not an answer
  if (/^\s*\|/m.test(t) && t.split('\n').filter((l) => l.trim().startsWith('|')).length > 4) {
    return false;                                    // a table is fine; the question may follow it
  }
  return false;
}

/** Strip fenced code so a question inside an example never becomes a button. */
function withoutFences(text: string): string {
  return String(text || '').replace(/```[\s\S]*?```/g, '\n').replace(/`[^`\n]{0,120}`/g, (m) => m);
}

const clean = (s: string) =>
  s.replace(/\*\*/g, '')
    .replace(/^[\s—–\-•*]+/, '')
    .replace(/\s+/g, ' ')
    .replace(/[.,;:]+$/, '')
    .trim();

/** Good enough to put on a button and send as a message. */
function usable(s: string): boolean {
  const t = clean(s);
  if (t.length < 2 || t.length > 64) return false;
  if (/^(day\s*\d|slide\s*\d+\s*$)/i.test(t)) return false;   // plan days / bare slide numbers
  if (/^https?:\/\//i.test(t)) return false;
  if (/[{}<>]/.test(t)) return false;                          // template or markup leftovers
  return true;
}

/**
 * A list of options offered under a question.
 *
 * Generalised from the old trailing-numbers rule: numbers of any length, letters, and bullets all
 * count, and a bolded lead-in ("**Basic** — clean slides") is reduced to the choice itself.
 */
function listedOptions(text: string): string[] {
  const out: string[] = [];
  for (const raw of withoutFences(text).split('\n')) {
    const line = raw.trim();
    const m = line.match(/^(?:\*\*)?(?:\d{1,2}[.)]|[a-d][.)]|[-•*])\s*(.{2,120}?)\s*$/i);
    if (!m) continue;
    // "**Microsoft PowerPoint** — a real .pptx" → "Microsoft PowerPoint"
    let label = m[1].replace(/\s*[—–-]\s.*$/, '');
    label = clean(label).replace(/\?$/, '');
    if (usable(label)) out.push(label);
  }
  return out;
}

/**
 * "A or B?" — the shape the deck question actually takes.
 *
 * Only the last question in the message is considered, and only when both sides are short. Long
 * clauses on either side of an "or" are prose, not a choice.
 */
function eitherOr(text: string): string[] {
  const t = withoutFences(text);
  const questions = t.match(/[^.!?\n]{6,200}\?/g);
  if (!questions) return [];
  const q = questions[questions.length - 1];
  // Take what follows the last colon or the question word, so "Where do you want it — in X or Y?"
  // does not carry the preamble into the buttons.
  const tail = q.replace(/^[\s\S]*?[:—–]\s*/, '').replace(/\?$/, '');
  const m = tail.split(/\s+\bor\b\s+/i);
  if (m.length !== 2) return [];
  const opts = m.map((s) => clean(s).replace(/^(?:in|on|as|with|using|the)\s+/i, ''));
  if (!opts.every(usable)) return [];
  if (opts.some((o) => o.split(' ').length > 6)) return [];   // a clause, not an option
  return opts;
}

/** A straight offer to do something: "shall I…", "would you like me to…". */
function yesNoOffer(text: string): QuickReply[] {
  const t = withoutFences(text);
  const q = /\b(?:shall i|should i|would you like me to|want me to|do you want me to|should we)\b([^?]{3,120})\?/i.exec(t);
  if (!q) return [];
  const what = clean(q[1]).replace(/^(?:also\s+)?/i, '');
  if (!usable(what)) return [{ label: 'Yes, go ahead', send: 'Yes, go ahead' }, { label: 'No thanks', send: 'No thanks' }];
  // Send the agent's own words back, so it does not have to work out what "yes" referred to.
  const affirm = `Yes, ${what}`;
  return [
    { label: 'Yes, go ahead', send: usable(affirm) ? affirm : 'Yes, go ahead' },
    { label: 'No thanks', send: 'No thanks' },
  ];
}

/**
 * Phrases the agent tells the user to say.
 *
 * "Say 'extend the deck' and I'll add more slides" — the exact words are already there, so the
 * button is guaranteed to be something the agent understands.
 */
function suggestedPhrases(text: string): string[] {
  const t = withoutFences(text);
  const out: string[] = [];
  const re = /\b(?:say|type|tell me|just say|ask me to|reply)\b[^"'“`]{0,20}["'“`]([^"'”`\n]{3,60})["'”`]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const s = clean(m[1]);
    if (usable(s)) out.push(s);
  }
  return out;
}

/** Does the message actually ask for anything? */
function invitesAnswer(text: string): boolean {
  const t = withoutFences(text);
  return /\?/.test(t)
    || /\b(pick one|choose|let me know|which would you|your call|tell me which)\b/i.test(t);
}

/**
 * The buttons to show under one assistant message. Up to four, in the order they were offered.
 *
 * Returns [] far more often than not — that is the point. Buttons under every message become
 * furniture nobody reads, and the value of these is that their presence means "this one is asking
 * you something".
 */
export function quickReplies(text: string): QuickReply[] {
  const t = String(text || '');
  if (isUnofferable(t)) return [];

  const out: QuickReply[] = [];
  const push = (label: string, send = label) => {
    const l = clean(label);
    if (!usable(l)) return;
    if (out.some((o) => o.label.toLowerCase() === l.toLowerCase())) return;
    out.push({ label: l, send: clean(send) || l });
  };

  // A phrase the agent explicitly told the user to say is the safest of all — it needs no question
  // mark anywhere, because the agent has already said it will act on those words.
  for (const p of suggestedPhrases(t)) push(p);

  if (invitesAnswer(t)) {
    for (const o of listedOptions(t)) push(o);
    if (out.length < 2) for (const o of eitherOr(t)) push(o);
    if (out.length === 0) for (const yn of yesNoOffer(t)) push(yn.label, yn.send);
  }

  // One lone option is not a choice — it is a button that looks like the only thing you may do.
  // The exception is a suggested phrase, which stands on its own.
  if (out.length === 1 && suggestedPhrases(t).length === 0) return [];
  return out.slice(0, 4);
}
