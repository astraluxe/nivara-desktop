// ─── Picking an option has to actually reply ─────────────────────────────────
//
// The boss can end a message with a CHOICES_BLOCK — two to four concrete things the user could do
// next — and the chat renders them as a card. The card says, in its own subtitle:
//
//     "Tap one, then confirm — it is sent as your reply"
//
// It was not sent. The confirm handler wrote the choice to the database and the card rendered that
// same text back inside itself, styled as an assistant answer. So the user picked "Explain SDN vs
// Orchestration in more detail" and got either their own request echoed at them, or — when the
// model had not pre-written that option's text, which is the normal case for a "shall I go deeper?"
// offer — **nothing at all**. A card that promises a reply, takes a click, and does nothing.
//
// The type has said what `content` is for all along: "What gets sent as if the user had typed it,
// so it must read in their voice and stand alone." This module decides what that message is, and
// guarantees it is never empty — because an empty send is exactly the silent dead end above.

import type { ChoiceItem, ChoiceSet } from './agentBrain';

/** Is there real text here, rather than whitespace or a placeholder the model left behind? */
function meaningful(s: string | undefined | null): boolean {
  const t = String(s ?? '').trim();
  if (t.length < 2) return false;
  // Models fill a field they have nothing for with a stub rather than omitting it.
  if (/^(n\/?a|tbd|todo|none|null|undefined|\.\.\.|-+)$/i.test(t)) return false;
  return true;
}

/**
 * The message to send when the user confirms a choice.
 *
 * Prefers the pre-written `content`, which is the model's own phrasing of what the user wants. When
 * that is missing — and it usually is, for an offer of "want me to go deeper on X?" — the label and
 * preview are what the user actually read and clicked, so they are what gets sent.
 *
 * Never returns an empty string. `send('')` is a silent no-op, which is the whole bug.
 */
export function replyForChoice(choice: ChoiceItem, set?: ChoiceSet): string {
  if (meaningful(choice?.content)) return String(choice.content).trim();

  const label = meaningful(choice?.label) ? String(choice.label).trim() : '';
  const preview = meaningful(choice?.preview) ? String(choice.preview).trim() : '';

  // The label alone can be a fragment ("In more detail"), so the card's own title is carried with
  // it — that is the context the user had on screen when they chose.
  const title = meaningful(set?.title) ? String(set!.title).trim() : '';

  if (label && preview && preview.toLowerCase() !== label.toLowerCase()) {
    return `${label} — ${preview}`;
  }
  if (label) return title && !label.toLowerCase().includes(title.toLowerCase()) ? `${title}: ${label}` : label;
  if (preview) return preview;
  if (title) return title;
  // Nothing usable at all. Say something the agent can still act on rather than sending nothing.
  return 'Go ahead with the option I picked.';
}
