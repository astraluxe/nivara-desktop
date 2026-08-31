// ─── Pasting Markdown into a note ────────────────────────────────────────────
//
// A Brain note is a `contentEditable` showing HTML — the editor IS the preview, there is no second
// mode to switch to. So pasting Markdown put the SOURCE on the page: rows of `| a | b |`, literal
// `## Heading`, `**bold**` with the asterisks showing. The note was stored exactly as pasted and was
// unreadable, and the only way out was to reformat it by hand.
//
// This decides whether a pasted block is Markdown worth rendering. It is the whole risk of the
// feature: converting ordinary prose would rewrite what someone typed, which is far worse than
// leaving Markdown unrendered. So the test is deliberately hard to pass.
//
// ── THE RULE ────────────────────────────────────────────────────────────────
//
// One STRUCTURAL signal is enough, because none of them occur by accident in prose: a table row, a
// fenced code block, an ATX heading, a horizontal rule. Anything weaker — a bullet, a bold run, a
// link — needs TWO different kinds, because a hyphen at the start of a line is just a hyphen and a
// sentence with `*emphasis*` is just a sentence.

export interface MarkdownSignals {
  tables: number;
  headings: number;
  fences: number;
  rules: number;
  bullets: number;
  numbered: number;
  bold: number;
  links: number;
}

export function markdownSignals(text: string): MarkdownSignals {
  const lines = String(text || '').split('\n');
  const trimmed = lines.map((l) => l.trim());
  return {
    // A row needs at least two pipes, or "a | b" in ordinary prose would count.
    tables:   trimmed.filter((l) => l.startsWith('|') && (l.match(/\|/g) || []).length >= 2).length,
    headings: trimmed.filter((l) => /^#{1,6}\s+\S/.test(l)).length,
    fences:   trimmed.filter((l) => /^```/.test(l)).length,
    rules:    trimmed.filter((l) => /^(-{3,}|\*{3,}|_{3,})$/.test(l)).length,
    bullets:  trimmed.filter((l) => /^[-*+]\s+\S/.test(l)).length,
    numbered: trimmed.filter((l) => /^\d{1,2}[.)]\s+\S/.test(l)).length,
    // Paired asterisks on one line. A single stray `*` is not emphasis.
    bold:     (String(text || '').match(/\*\*[^*\n]+\*\*/g) || []).length,
    links:    (String(text || '').match(/\[[^\]\n]+\]\([^)\s]+\)/g) || []).length,
  };
}

/**
 * Is this pasted text Markdown that should be rendered?
 *
 * Returns false for anything it is not sure about. An unrendered paste is a small annoyance the
 * user can fix; a rendered one that should not have been is their text silently rewritten.
 */
export function looksLikeMarkdown(text: string): boolean {
  const t = String(text || '');
  if (t.trim().length < 12) return false;

  // Already HTML — the browser's own paste handles it, and running it through a Markdown renderer
  // would escape its tags into visible text. That exact bug has bitten this codebase before.
  if (/<\/?(p|div|table|tr|td|h[1-6]|ul|ol|li|strong|em|span|a)\b[^>]*>/i.test(t)) return false;

  const s = markdownSignals(t);

  // A table needs a body, not just one line that happens to contain pipes.
  if (s.tables >= 2) return true;
  // An opening and a closing fence.
  if (s.fences >= 2) return true;
  // A heading is unambiguous: no one starts a line with "## " by accident.
  if (s.headings >= 1) return true;
  // A rule on its own line, with something around it.
  if (s.rules >= 1 && (s.bullets + s.bold + s.numbered) >= 1) return true;

  // Everything else is weak on its own, so two DIFFERENT kinds are required.
  const weak = [s.bullets >= 2, s.numbered >= 2, s.bold >= 2, s.links >= 2].filter(Boolean).length;
  return weak >= 2;
}

/**
 * What to do with a paste.
 *
 * 'html'     — the clipboard already carried rich text; let the editor take it.
 * 'markdown' — plain text that is Markdown; render it.
 * 'plain'    — leave it exactly as typed.
 */
export function pasteMode(html: string, plain: string): 'html' | 'markdown' | 'plain' {
  // Real HTML from another app wins: it is already structured, and re-parsing it as Markdown would
  // be a downgrade. Browsers put a bare wrapper around plain text too, so a fragment with no actual
  // block tags does not count as rich.
  if (html && /<(p|div|table|tr|td|h[1-6]|ul|ol|li|strong|b|em|i|a)\b/i.test(html)) return 'html';
  return looksLikeMarkdown(plain) ? 'markdown' : 'plain';
}
