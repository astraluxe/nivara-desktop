// ─── Email drafts: reading a rewrite back, and deciding who a bulk change hits ─────────────────
//
// Both of these used to be impossible to check without a model, a key and a campaign loaded, which
// is why they live here instead of inside the copilot component: they are the two places a bulk
// email edit can go quietly wrong, and quietly wrong across forty drafts is not a bug you want to
// discover from a prospect's reply.
//
// An email is two fields and the rewriter returns one string, so the subject rides along as a
// leading `Subject:` line. Everything below is about not trusting that shape blindly — a model
// that forgets the line, writes the line and nothing under it, or answers with a preamble must all
// end up with a draft that is no worse than the one the user already had.

export interface EmailDraft { subject: string; body: string }

/**
 * Split a rewritten email back into subject and body.
 *
 * `fallbackSubject` is what the draft had before. It is used whenever the model did not clearly
 * give a new subject — because BLANKING a subject line is the one outcome that is worse than not
 * changing it, and it is the kind of thing that is only noticed after the message has gone.
 */
export function parseEmailRewrite(out: string, fallbackSubject: string): EmailDraft {
  const text = String(out ?? '').trim();
  if (!text) return { subject: fallbackSubject, body: '' };

  const lines = text.split('\n');
  // The subject line is expected first, but a model that opens with a stray blank line or a
  // leftover fence should not cost the user their subject — so skip over empty/fence lines while
  // looking for it, and give up quickly rather than scanning the whole email for the word.
  let i = 0;
  while (i < lines.length && i < 3 && (!lines[i].trim() || /^```/.test(lines[i].trim()))) i++;
  const head = (lines[i] ?? '').trim();
  const m = head.match(/^subject\s*:\s*(.*)$/i);
  if (!m) {
    // No subject line at all — the whole thing is the body, and the old subject stands.
    return { subject: fallbackSubject, body: text };
  }

  const subject = m[1].trim();
  const body = lines.slice(i + 1).join('\n').replace(/^\s*\n+/, '').trimEnd().trim();
  return {
    // "Subject:" with nothing after it is not a new subject, it is a formatting slip.
    subject: subject || fallbackSubject,
    // A subject line and no body means the model answered the wrong question. Keeping the whole
    // reply as the body would put "Subject: …" inside the email; returning empty lets the caller
    // treat it as "nothing usable came back" and leave the draft alone.
    body,
  };
}

/** Anything with a draft on it — structural, so the copilot's OutreachContact fits without importing it. */
export interface BulkCandidate {
  status?: string;
  email_subject?: string;
  email_body?: string;
  linkedin_message?: string;
}

export type BulkScope = 'untouched' | 'all' | 'picked';

/**
 * Which contacts a bulk email change should actually touch.
 *
 * Three rules, and each one exists because the opposite is destructive:
 *   - never the person on screen (they already have the change; rewriting it again undoes it),
 *   - never a contact whose message has been SENT — you cannot edit what has already gone, and a
 *     draft that no longer matches what was sent makes the campaign a record of nothing,
 *   - never a contact with no draft at all, because "rewrite this" with nothing to rewrite is how
 *     a model invents an email from scratch for someone the user never wrote to.
 */
export function bulkEmailTargets(
  contacts: BulkCandidate[],
  currentIdx: number,
  scope: BulkScope,
  picked: number[] = [],
): number[] {
  const hasDraft = (c: BulkCandidate) =>
    !!((c.email_body || c.linkedin_message || '').trim() || (c.email_subject || '').trim());
  const untouched = (s?: string) => !s || s === 'todo';

  if (scope === 'picked') {
    // A ticked box is an explicit instruction, so the status filter does not apply — but the two
    // hard rules still do.
    return picked
      .filter((i) => i !== currentIdx && !!contacts[i])
      .filter((i) => contacts[i].status !== 'sent' && hasDraft(contacts[i]))
      // Ticking in any order must not produce a run that jumps about the list.
      .sort((a, b) => a - b);
  }

  return contacts
    .map((c, i) => ({ c, i }))
    .filter(({ c, i }) => i !== currentIdx && (scope === 'all' ? c.status !== 'sent' : untouched(c.status)))
    .filter(({ c }) => hasDraft(c))
    .map(({ i }) => i);
}
