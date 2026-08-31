// ─── If they gave you a link, answer about THAT link ─────────────────────────
//
// A user asked for research on `https://iangroup.vc/portfolio/`. What came back opened with:
//
//   "I couldn't access the full portfolio page at `ian-fund.com/portfolio/` — it blocked the
//    browser and didn't load."
//
// Two things wrong with one sentence. `ian-fund.com` is a DIFFERENT SITE — it is a link in the
// navigation of the page they gave, which the agent followed and then reported on as though it
// were the page requested. And `iangroup.vc/portfolio/` was never blocked at all: it returns 200
// and our own browser navigates to it without complaint.
//
// The reader has no way to catch either. They see their own link in their own message, a failure
// reported underneath it, and reasonably conclude their link is broken. So they stop asking.
//
// This is the check that a failure is attributed to the thing that actually failed.

/** Every host named in a piece of text, lower-cased, without `www.`. */
export function hostsIn(text: string): string[] {
  const out: string[] = [];
  // The boundary before a bare domain is NOT just whitespace. The answer that started all this
  // wrote the host inside backticks — `ian-fund.com/portfolio/` — and a \s boundary walked straight
  // past it, so the check found nothing to complain about. Anything that is not itself part of a
  // host counts: backtick, bracket, quote, paren. `@` and `-` stay excluded so an email address is
  // not read as a domain and `ian-fund.com` is not clipped to `fund.com`.
  const re = /https?:\/\/([^\s/"'`<>)\]]+)|(?:^|[^\w@./-])((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/[^\s"'`<>)\]]*)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text || ''))) !== null) {
    const raw = (m[1] || m[2] || '').toLowerCase().replace(/^www\./, '').replace(/[.,;:]+$/, '');
    // Skip things that merely look like a host: file names, version numbers, sentence fragments.
    if (!raw || !/\.[a-z]{2,}$/.test(raw)) continue;
    if (/\.(exe|json|html?|md|txt|png|jpe?g|pdf|ts|tsx|js|mjs|css)$/.test(raw)) continue;
    if (!out.includes(raw)) out.push(raw);
  }
  return out;
}

/**
 * The links a person actually typed, as they typed them.
 *
 * `hostsIn` is for comparing; this is for quoting back. A user who writes a full path meant that
 * path — `iangroup.vc/portfolio/` is not the same request as `iangroup.vc`.
 */
export function linksIn(text: string): string[] {
  const out: string[] = [];
  const re = /https?:\/\/[^\s"'`<>)\]]+|(?:^|[^\w@./-])((?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s"'`<>)\]]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text || ''))) !== null) {
    const raw = (m[1] ? m[1] : m[0]).trim().replace(/[.,;:]+$/, '');
    if (!out.includes(raw)) out.push(raw);
  }
  return out;
}

/** Is this text reporting that it could not read a page? */
export function claimsPageFailure(text: string): boolean {
  const t = String(text || '');
  return /\b(couldn'?t|could not|cannot|can'?t|unable to|failed to)\b[^.\n]{0,40}\b(access|open|load|read|reach|fetch|scrape|view)\b/i.test(t)
      || /\b(blocked|refused|denied|timed out|did ?n'?t load|would ?n'?t load)\b/i.test(t);
}

export interface FidelityCheck {
  /** What the user actually asked, in their words. */
  request: string;
  /** What the agent produced. */
  answer: string;
}

export interface FidelityResult {
  /** Hosts the user named. */
  asked: string[];
  /** Hosts the answer blames for a failure. */
  blamed: string[];
  /**
   * True when the answer reports a failure on a host the user never mentioned, while saying nothing
   * about the one they did. That is the shape that misleads.
   */
  wrongTarget: boolean;
}

/**
 * Did the answer report a failure on something other than what was asked for?
 *
 * Only fires when the user named a host AND the answer blames a different one AND the user's own
 * host is not discussed. Following a link is fine and often necessary; reporting on where you ended
 * up as though it were where you were sent is not.
 */
export function checkUrlFidelity(c: FidelityCheck): FidelityResult {
  const asked = hostsIn(c.request);
  const answerHosts = hostsIn(c.answer);
  const blamed = claimsPageFailure(c.answer) ? answerHosts : [];

  // Sub-domains count as the same site: docs.example.com is not "a different site" from example.com.
  const sameSite = (a: string, b: string) => a === b || a.endsWith('.' + b) || b.endsWith('.' + a);
  const mentionedTheirs = asked.some((a) => answerHosts.some((h) => sameSite(a, h)));
  const blamesOther = blamed.some((b) => !asked.some((a) => sameSite(a, b)));

  return {
    asked,
    blamed,
    wrongTarget: asked.length > 0 && blamesOther && !mentionedTheirs,
  };
}

/**
 * The instruction that stops it happening.
 *
 * Added to the prompt only when the user's message actually contains a link, so an ordinary request
 * is not weighed down by a rule about links it does not have.
 */
export function urlDirective(urls: string[]): string {
  if (!urls.length) return '';
  const list = urls.map((u) => `- ${u}`).join('\n');
  return [
    '',
    '## THE LINK THEY GAVE YOU',
    '',
    'The user named these pages. Open them, exactly as written:',
    list,
    '',
    'You may follow links from those pages — often you must. But when you report back:',
    '',
    '- **Say which page each finding came from.** If you ended up somewhere else, name that place and',
    '  say how you got there.',
    '- **Never report a failure on a different site as though it were theirs.** "I could not open',
    '  <their-link>" and "I could not open <some-site-it-linked-to>" are different sentences and only',
    '  one of them may use their link.',
    '- **If their page opened, say what was on it** — even if what was on it was not what they hoped',
    '  for. "The page loaded and does not publish that figure" is a real answer. "The page would not',
    '  load" when it did is not.',
  ].join('\n');
}

/**
 * The line to add underneath an answer that blamed the wrong site.
 *
 * The directive is the real fix; this is the net under it, for when the model writes the misleading
 * sentence anyway. It states only what can be derived — which host they asked about, which one the
 * answer blames — and never asserts that their page works, because from here we do not know that.
 * Empty string when there is nothing wrong, so it is safe to append unconditionally.
 */
export function fidelityNote(request: string, answer: string): string {
  const r = checkUrlFidelity({ request, answer });
  if (!r.wrongTarget) return '';
  const theirs = r.asked.join(', ');
  const other = r.blamed.filter((b) => !r.asked.includes(b)).join(', ');
  return `

> **On the link you gave:** the failure above is about **${other}**, which is a different site to the **${theirs}** you asked about. I have not reported on your page itself — ask me again and I will go straight to it.`;
}
