// ─── A refusal is never an acceptable answer to "make me this file" ──────────
//
// A user attached a document and five figures and asked for a PowerPoint. What came back was:
//
//   "I **cannot create or send a `.pptx` file directly** — I am a text-based AI and do not have
//    the ability to generate binary files … or 'read attached files' from your message (no files
//    were received in this chat)."
//
// followed by a table of slide titles and "Your move: paste the document text".
//
// Every clause of that is false in this product. The app generates real .pptx, .docx and .xlsx
// files, it drives the user's own Office, and the document HAD been received and read — its text
// and its five figures were sitting in the request. The model was describing a generic chatbot's
// limits, not this one's.
//
// This is the model talking about itself, so no prompt wording reliably prevents it. What CAN be
// made reliable is that such a reply never reaches the user as the final answer: detect it, throw
// it away, and run the deterministic builder that was always going to do the work.
//
// The detector is deliberately hard to trip. A false positive throws away a real answer, so every
// rule below requires the model to be denying a CAPABILITY, not merely using the word "cannot".

/** The phrases that only appear when a model is disclaiming what it is. */
const IDENTITY = [
  /\bi(?:'m| am) (?:just |only |simply )?an? (?:text[- ]based|language|ai) (?:ai|model|assistant)\b/i,
  /\bas an ai (?:language )?(?:model|assistant)\b/i,
  /\bi(?:'m| am) not able to (?:create|generate|produce|make|write|attach|send)\b/i,
  /\bi (?:do not|don't) have the ability to\b/i,
  /\bi (?:cannot|can't|can not) (?:directly )?(?:create|generate|produce|make|attach|send|export|save)\b[^.]{0,80}\b(?:file|binary|\.?pptx|\.?docx|\.?xlsx|\.?pdf|presentation|document|spreadsheet|attachment)/i,
  /\bi (?:cannot|can't|can not) access (?:your )?(?:local )?(?:file ?system|files|computer|drive)\b/i,
];

/** Claiming the attachment did not arrive — when it did. */
const NO_FILES = [
  /\bno files? (?:were|was) (?:received|attached|provided|shared)\b/i,
  /\bi (?:cannot|can't|can not|am unable to|don't|do not) (?:see|read|open|access|receive)\b[^.]{0,40}\b(?:attach(?:ed|ment)|uploaded? file|the file|your (?:file|document))/i,
  /\bi (?:did not|didn't|haven't) receive(?:d)? (?:any )?(?:file|attachment|document)/i,
  /\bthere (?:are|is|were|was) no (?:files?|attachments?|documents?) (?:in|attached|provided)/i,
];

/** Handing the work back: "paste it and I'll tell you what to do". */
const HANDS_BACK = [
  /\b(?:paste|share|provide|send|give)\b[^.\n]{0,40}\b(?:the )?(?:full )?(?:document|doc|text|content|key points|outline)\b/i,
  /\btell me[^.\n]{0,30}\bwhat each (?:attached )?image shows\b/i,
  /\byour move\b/i,
  /\bonce you (?:give|paste|provide|share) me\b/i,
  /\bthat you can (?:copy[- ]?paste|copy and paste|paste) into\b/i,
];

const hits = (res: RegExp[], text: string) => res.filter((r) => r.test(text)).length;

/** Is the model disclaiming what this product can plainly do? */
export function looksLikeCapabilityRefusal(text: string): boolean {
  const t = String(text || '');
  if (t.trim().length < 40) return false;          // too short to be a considered refusal
  return hits(IDENTITY, t) > 0;
}

/** Is it claiming the user's attachment never arrived? */
export function claimsNoFilesReceived(text: string): boolean {
  return hits(NO_FILES, String(text || '')) > 0;
}

/** Is it asking the user to supply what they already supplied? */
export function asksUserToPasteContent(text: string): boolean {
  return hits(HANDS_BACK, String(text || '')) > 0;
}

export interface RefusalContext {
  /** The assistant's finished reply. */
  reply: string;
  /** Did the user actually attach anything to the request? */
  hadFiles: boolean;
  /** Did the user ask for a FILE to be produced (a deck, a document, a sheet)? */
  wantedArtifact: boolean;
}

/**
 * Should this reply be thrown away and the work done properly instead?
 *
 * Three independent grounds, any one of which is enough — but each needs the request to have
 * actually been a "make me this" so that a genuine, honest "I can't do that" about something else
 * is never suppressed:
 *
 *  1. It denies a capability this product has.
 *  2. It says no files arrived, while files did arrive.
 *  3. It asks the user to paste content they already attached.
 */
export function shouldOverrideRefusal(ctx: RefusalContext): boolean {
  const { reply, hadFiles, wantedArtifact } = ctx;
  const t = String(reply || '');
  if (!t.trim()) return false;

  if (claimsNoFilesReceived(t) && hadFiles) return true;
  if (!wantedArtifact) return false;                        // only guard "make me a file" requests
  if (looksLikeCapabilityRefusal(t)) return true;
  // Asking for the content back is only wrong when the content was already there.
  if (hadFiles && asksUserToPasteContent(t)) return true;
  return false;
}

/** Did the user ask for a real file to be produced? Used as the gate above. */
export function wantsAnArtifact(text: string): boolean {
  const t = String(text || '');
  const noun = /\b(ppt|pptx|powerpoint|presentation|slide deck|slides|deck|word document|docx|document|report|spreadsheet|excel|xlsx|sheet|pdf)\b/i;
  const verb = /\b(make|create|build|generate|write|prepare|produce|draft|put together|turn (?:it|this) into)\b/i;
  return noun.test(t) && verb.test(t);
}

/**
 * What to say when a refusal has been overridden.
 *
 * Never repeat the refusal, and never pretend nothing happened — the user watched it stall. One
 * plain line that says the work is being done, because the next thing on screen is the work.
 */
export function recoveryNote(kind: 'deck' | 'document' | 'sheet'): string {
  const thing = kind === 'deck' ? 'presentation' : kind === 'sheet' ? 'spreadsheet' : 'document';
  return `Ignore that — I can build the ${thing} from what you attached, and I have your file and its pictures right here. Doing it now.`;
}
