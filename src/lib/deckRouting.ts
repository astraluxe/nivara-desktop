// ─── Deciding whether the user actually asked for a deck ─────────────────────
//
// This is a SHORTCUT that runs before the boss ever sees the message: when it returns true the deck
// setup card appears and the request never reaches Arjun. That makes every false positive an
// interception — the user asked one thing and the product answered a different one.
//
// It lives in its own file because it was wrong repeatedly and because it is pure: it can be checked
// against the exact sentences the owner actually typed, with no API key and no app.
//
// ── THE TWO FAULTS THIS FIXES ────────────────────────────────────────────────
//
// **1. A bare noun hijacked the chat.** The rule was, in effect, `if the text contains "ppt" or
// "powerpoint", it is a deck request`. No verb, no intent. So after a deck had been made:
//
//     "give me a script to follow to present the ppt in college"
//
// …put the deck BUILDER form on screen again instead of writing the script. The owner reported it
// several times, in those words: *"if once slade design is called for ppt it doesn't go away"*.
//
// **2. It ignored the user naming their own application.** Asked to
// *"use Microsoft PowerPoint"* with a PDF attached, the shortcut fired first, so the boss never got
// the message and never got the chance to call `office_automation` — the tool that drives the
// PowerPoint already installed on the machine. The capability was there the whole time; the
// shortcut was standing in front of it.
//
// **The rule that follows, and it is the owner's:** *"let arjun.boss see what the user is asking
// and then give that to the user"*. A shortcut may only fire when the request is unambiguous. In
// every other case it stands down and the boss decides.

/** What the message is really after. */
export type DeckRoute =
  | 'build'        // unambiguous "make me a deck" — the setup card is right
  | 'office'       // they named their own Office app; the boss must drive it
  | 'boss';        // anything else — the boss reads it and decides

/**
 * Asking ABOUT a deck is not asking FOR one.
 *
 * A script, speaker notes, a summary, advice on presenting — all mention the deck and none of them
 * want the builder. This is the veto the old rule was missing entirely.
 */
export function asksAboutADeck(t: string): boolean {
  return /\b(script|speaker notes?|talk track|notes to (say|present)|what (do|should) i say|how (do|should) i (present|deliver|open|start)|rehearse|practice|present it|walk me through|explain|summar(y|ise|ize)|feedback|review|critique|shorten|questions?\b.{0,20}\bask)\b/.test(t);
}

/** They named an application that is installed on their own computer. */
export function namesOwnApp(t: string): boolean {
  return /\b(microsoft|ms)\s*(power\s?point|word|excel)\b|\buse\s+(my\s+)?(power\s?point|word|excel)\b|\bin\s+(power\s?point|word|excel)\b|\b(power\s?point|word|excel)\s+(file|on my|installed)\b/.test(t);
}

/**
 * WHICH application they named.
 *
 * `namesOwnApp` answers "did they name one of their own programs", which is the right question for
 * the boss. It is the WRONG question for the deck builder: Word and Excel match it too, so routing
 * every "office" message into the presentation builder would answer "write this up in Microsoft
 * Word" with a slide-deck form. The caller needs to know which one.
 */
export function namedApp(t: string): 'powerpoint' | 'word' | 'excel' | null {
  const s = String(t || '').toLowerCase();
  if (!namesOwnApp(s)) return null;
  // Most specific first: "the ppt in Microsoft PowerPoint" names one application, not two. The
  // word boundaries matter — without them "word" matches "keyword" and "wordy".
  if (/\bpower\s?point\b|\bppt\b|\.pptx\b/.test(s)) return 'powerpoint';
  if (/\bexcel\b|\.xlsx?\b/.test(s)) return 'excel';
  if (/\bword\b|\.docx?\b/.test(s)) return 'word';
  return null;
}

/** The marks of a real slide-by-slide brief — an email mentioning "the ppt" has none of them. */
export function deckBriefSignals(t: string): number {
  let n = 0;
  const numbered = (t.match(/\bslide\s*#?\s*\d{1,2}\s*[:.–-]/g) || []).length;
  if (numbered >= 2) n += 2; else if (numbered === 1) n += 1;
  if (/\bslide count\b|\b\d{1,2}\s*(?:-|–|to)\s*\d{1,2}\s+slides?\b|\b\d{1,2}\s+slides?\b/.test(t)) n++;
  if (/\b(title slide|agenda slide|closing slide|speaker notes?|slide deck|deck outline|presentation outline|slide[- ]by[- ]slide)\b/.test(t)) n++;
  return n;
}

/**
 * Where this message should go.
 *
 * Deliberately conservative: 'boss' is the safe answer and the default. A wrong 'boss' costs a
 * second of routing; a wrong 'build' replaces the user's question with a form.
 */
export function routeDeckRequest(text: string): DeckRoute {
  const t = (text || '').toLowerCase();

  // ── ORDER MATTERS, AND THIS IS THE ORDER ──────────────────────────────────
  //
  // A named application is the most explicit instruction there is, so it goes first. A full
  // slide-by-slide brief comes next and sits ABOVE the asking-about veto on purpose: a real brief
  // routinely says "with speaker notes", which the veto would otherwise read as a request to WRITE
  // speaker notes and hand the whole thing to the boss. Two independent brief signals are required,
  // so one stray phrase cannot fake it. Only then do the vetoes run.

  // ── Did they name their own application? ──────────────────────────────────
  //
  // Then the answer is their Office, not our in-chat renderer, and only the boss can drive it.
  // Checked before the build test so "make a ppt using Microsoft PowerPoint" goes to Office rather
  // than to the card.
  if (namesOwnApp(t)) return 'office';

  if (deckBriefSignals(t) >= 2) return 'build';

  // ── The vetoes, first ─────────────────────────────────────────────────────
  //
  // Asking about an existing deck is never a request to build one. This alone fixes the reported
  // bug, and it has to run BEFORE anything else or "present the ppt" matches on the noun.
  if (asksAboutADeck(t)) return 'boss';

  // "email me the deck", "attach the ppt" — about sending one that exists.
  if (/\b(e-?mail|send|attach|forward|share)\b[^.]{0,24}\b(deck|presentation|slides?|ppt|pptx)\b/.test(t)) {
    return 'boss';
  }

  // ── Is it unambiguously a request to BUILD one? ───────────────────────────
  const makeVerb = /\b(make|create|build|design|generate|prepare|produce|put together|need|want|draft|turn (this|it) into)\b/;
  const deckNoun = /\b(deck|presentation|slides?|ppt|pptx|pitch\s?deck|keynote|power\s?point)\b/;

  // A full slide-by-slide brief is the ask, whatever else it happens to mention.
  // The primary ask is a written message or a piece of research, and no deck verb — then a "ppt"
  // mention is an attachment, not the job.
  const wantsMessageOrResearch = /\b(message|messages|email|e-?mail|linkedin|outreach|dm|whatsapp|cold\s*(mail|email)|reply|caption|research|analy[sz]e|strategy|go[- ]to[- ]market|gtm)\b/.test(t);

  // BOTH a making verb AND a deck noun, near enough to belong to the same phrase. The old rule
  // accepted the noun ALONE, which is the whole bug: every sentence containing "ppt" became a
  // build request no matter what it asked for.
  const explicitMake = new RegExp(`${makeVerb.source}[^.]{0,28}${deckNoun.source}`).test(t)
    || new RegExp(`${deckNoun.source}[^.]{0,20}\\b(for me|please)\\b`).test(t);

  if (explicitMake && !wantsMessageOrResearch) return 'build';

  // Everything else — including a bare "the ppt" — goes to the boss to read.
  return 'boss';
}

/** Kept for the call sites that only need the yes/no. */
export function looksLikePresentation(text: string): boolean {
  return routeDeckRequest(text) === 'build';
}

/**
 * Is this an instruction to CHANGE the deck that already exists?
 *
 * Runs only once a deck is in the thread, which is what made its failures appear a few messages in
 * rather than on the first one. Three gates, and the first is the one the builder was missing:
 *
 *   1. Asking ABOUT the deck is never an edit. "write speaker notes for the deck" wants prose, not
 *      a redraw, and it contains both a deck noun and an edit verb.
 *   2. An edit instruction is SHORT. "put my logo on slide 1" is twenty-two characters; a pasted
 *      brief is thousands.
 *   3. The noun has to be about a deck, and the verb has to be an editing one.
 */
export function isDeckEdit(text: string, colourNamed = false): boolean {
  const t = (text || '').toLowerCase();
  // The veto the builder was missing, applied here too — same class of bug, same fix.
  if (asksAboutADeck(t)) return false;
  if (t.length > 400) return false;
  if (colourNamed && /\b(make|change|turn|recolou?r|set|use)\b/.test(t)) return true;
  if (!/\b(slides?|decks?|presentations?|ppt|pptx|keynote)\b/.test(t)) return false;
  return /\b(change|edit|replace|update|set|rename|put|add|insert|remove|delete|drop|swap|move|use|make|recolou?r|colou?r|turn)\b/.test(t);
}
