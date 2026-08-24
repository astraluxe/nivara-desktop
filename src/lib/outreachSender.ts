// ─── Sending the campaign, without a human on every button ────────────────────
//
// The copilot has always been a review queue: it drafts, you read, you press. That is right for
// the first ten and absurd for the next hundred, which is the whole complaint — the messages are
// written, they are approved, and the only thing standing between them and the recipient is a
// person clicking the same two buttons four hundred times.
//
// So this sends them. Which means this file is the one place in the app that does something to a
// real stranger that cannot be undone, and it is written accordingly:
//
//   NOTHING GOES OUT THAT A HUMAN WOULD NOT HAVE SENT.
//     A draft with `[Name]` still in it, an empty subject, a body that is three words long, a
//     LinkedIn URL that is really a company page — every one of those is a message the user would
//     have caught by eye and the automation would not. They are refused BEFORE the run starts and
//     listed by name, so the queue you approve is the queue that goes.
//
//   A SEND IS ONLY "SENT" IF SOMETHING CONFIRMED IT.
//     SMTP answers with an accept code. The browser path has to be inspected, and when it cannot
//     prove delivery it says so and the contact is NOT marked sent. A false success is worse than
//     a failure: a failure gets retried, a false success means a prospect who never heard from you
//     is filed under "done" forever.
//
//   THE USER'S ACCOUNT IS NOT OURS TO SPEND.
//     Daily caps and randomised gaps exist because platforms restrict accounts that behave like
//     scripts, and it is the user's LinkedIn and the user's sending domain that get burned, not
//     ours. The caps are defaults, not a cage — but they default to safe.
//
// The decisions all live in pure functions so they can be tested without a model, a key, a browser
// or a mailbox. The one impure function is sendOne(), at the bottom.

export type SendChannel = 'email' | 'linkedin';

/** Just enough of an OutreachContact to decide about it — structural, so no circular import. */
export interface SendableContact {
  name?: string;
  /** A file chosen for THIS person, which beats the campaign-wide one. */
  attachmentPath?: string;
  company?: string;
  status?: string;
  email?: string;
  emails?: string[];
  linkedin_url?: string;
  linkedin_message?: string;
  email_subject?: string;
  email_body?: string;
}

export interface SendCandidate {
  /** Position in the campaign's contact list, so the caller can write the result back. */
  idx: number;
  name: string;
  channel: SendChannel;
  /** Email address, or LinkedIn profile URL. */
  to: string;
  subject: string;
  body: string;
  /** File to attach, when one was chosen for this person or for the whole campaign. */
  attachmentPath?: string;
}

export interface SkipReason { idx: number; name: string; channel: SendChannel; why: string }

export interface QueueOptions {
  channels: SendChannel[];
  /** A file to attach to everyone who does not have their own. */
  attachmentPath?: string;
  /** How many more of each may go today, after subtracting what has already gone. */
  emailRemaining: number;
  linkedinRemaining: number;
  /** Cap for this single run, on top of the daily one. */
  runLimit?: number;
}

// ─── What a real person would refuse to send ──────────────────────────────────

/**
 * An unfilled placeholder left in a draft.
 *
 * `[Name]`, `[Company]`, `{name}`, `<your pitch here>`, `TODO`, `XXX`. The token forms the app
 * itself uses ({name}/{company}) are filled in before this runs, so anything still matching here
 * survived that — it is a hole the model left, and it is the single most embarrassing thing that
 * can arrive in a stranger's inbox with your name on it.
 */
export function findPlaceholder(text: string): string | null {
  const t = String(text || '');
  const patterns: RegExp[] = [
    /\[[A-Za-z][A-Za-z0-9 _/'-]{1,40}\]/,        // [Name], [Company Name], [your product]
    /\{\{?\s*[A-Za-z_][A-Za-z0-9_ ]{0,30}\s*\}?\}/, // {name}, {{company}}
    /<[A-Za-z][A-Za-z0-9 _'-]{2,40}>/,            // <your pitch here>
    /\bTODO\b|\bTBD\b|\bXXX+\b|\bLOREM IPSUM\b/i,
    /\byour name here\b|\binsert [a-z ]{2,20}\b/i,
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    // A real email address or a URL can contain <>; don't call those placeholders.
    if (m && !/@/.test(m[0]) && !/^<https?:/i.test(m[0])) return m[0];
  }
  return null;
}

/** A LinkedIn URL that can actually receive a direct message (a person, not a company page). */
export function isMessageableProfile(url?: string): boolean {
  const u = String(url || '');
  return /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/[^/?#]+/i.test(u);
}

/**
 * Statuses that mean "do not cold-send to this person again".
 *
 * `sent` is obvious. `replied`, `meeting`, `met` are people who are already in a conversation —
 * dropping a first-touch template on them is worse than not writing at all. `skip` is an explicit
 * instruction. `connect` means a LinkedIn invite is still pending, so there is no thread to message
 * into; that one is channel-specific and handled below rather than here.
 */
export function isDoneWith(status?: string): boolean {
  return status === 'sent' || status === 'replied' || status === 'meeting' || status === 'met' || status === 'skip';
}

/** Substitute the campaign tokens, exactly as the copilot's preview does. */
export function fillTokens(t: string, c: SendableContact): string {
  return String(t || '')
    .replace(/\{name\}/gi, (c.name || 'there').split(' ')[0])
    .replace(/\{company\}/gi, c.company || 'your company');
}

/**
 * Decide, for one contact and one channel, whether this is sendable — and if not, why not in a
 * sentence the user can act on.
 */
export function checkOne(c: SendableContact, channel: SendChannel): { ok: true; to: string; subject: string; body: string } | { ok: false; why: string } {
  if (isDoneWith(c.status)) {
    return { ok: false, why: c.status === 'sent' ? 'already sent' : `already ${c.status} — a first-touch message would be wrong now` };
  }
  if (channel === 'email') {
    const to = (c.email || (c.emails || [])[0] || '').trim();
    if (!to || !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(to)) return { ok: false, why: to ? `"${to}" is not a usable email address` : 'no email address' };
    const subject = fillTokens(c.email_subject || '', c).trim();
    const body = fillTokens(c.email_body || c.linkedin_message || '', c).trim();
    if (!body) return { ok: false, why: 'no email written yet' };
    if (!subject) return { ok: false, why: 'no subject line — an automated email with a blank subject reads as spam' };
    if (body.length < 40) return { ok: false, why: `the body is only ${body.length} characters — too short to be a real message` };
    const ph = findPlaceholder(subject) || findPlaceholder(body);
    if (ph) return { ok: false, why: `still has a placeholder in it: ${ph}` };
    return { ok: true, to, subject, body };
  }
  // LinkedIn
  if (c.status === 'connect') return { ok: false, why: 'a connection request is still pending — there is no chat to send into yet' };
  if (!isMessageableProfile(c.linkedin_url)) {
    return { ok: false, why: c.linkedin_url ? 'the saved LinkedIn link is not a personal profile' : 'no LinkedIn profile saved' };
  }
  const body = fillTokens(c.linkedin_message || '', c).trim();
  if (!body) return { ok: false, why: 'no LinkedIn message written yet' };
  if (body.length < 30) return { ok: false, why: `the message is only ${body.length} characters — too short to be a real message` };
  const ph = findPlaceholder(body);
  if (ph) return { ok: false, why: `still has a placeholder in it: ${ph}` };
  return { ok: true, to: c.linkedin_url!.trim(), subject: '', body };
}

/**
 * Build the exact list that will go out, and the exact list that will not.
 *
 * Both halves are returned because the second one is the useful half: "37 of your 50 will send" is
 * a number, "and here are the 13 that will not, and why" is something the user can fix.
 */
export function buildSendQueue(
  contacts: SendableContact[],
  opts: QueueOptions,
): { queue: SendCandidate[]; skipped: SkipReason[] } {
  const queue: SendCandidate[] = [];
  const skipped: SkipReason[] = [];
  let emailLeft = Math.max(0, opts.emailRemaining);
  let liLeft = Math.max(0, opts.linkedinRemaining);
  const runLimit = opts.runLimit && opts.runLimit > 0 ? opts.runLimit : Infinity;

  for (let idx = 0; idx < contacts.length; idx++) {
    const c = contacts[idx];
    const name = (c.name || `Contact ${idx + 1}`).trim();
    for (const channel of opts.channels) {
      if (queue.length >= runLimit) break;
      // One message per person per run. Mailing AND LinkedIn-ing the same stranger in the same
      // minute is not twice the outreach, it is the thing that gets you reported.
      if (queue.some((q) => q.idx === idx)) continue;
      const verdict = checkOne(c, channel);
      if (!verdict.ok) {
        // Only report a skip once per person for a reason that is not channel-specific, so a
        // two-channel run does not print "already sent" twice for everybody.
        if (!skipped.some((s) => s.idx === idx && s.why === verdict.why)) {
          skipped.push({ idx, name, channel, why: verdict.why });
        }
        continue;
      }
      if (channel === 'email' && emailLeft <= 0) {
        if (!skipped.some((s) => s.idx === idx)) skipped.push({ idx, name, channel, why: 'today\'s email limit is used up' });
        continue;
      }
      if (channel === 'linkedin' && liLeft <= 0) {
        if (!skipped.some((s) => s.idx === idx)) skipped.push({ idx, name, channel, why: 'today\'s LinkedIn limit is used up' });
        continue;
      }
      if (channel === 'email') emailLeft--; else liLeft--;
      queue.push({
        idx, name, channel, to: verdict.to, subject: verdict.subject, body: verdict.body,
        // Their own file wins over the campaign-wide one — the specific choice is always the more
        // deliberate one. LinkedIn has no attachment, so it never carries a path.
        attachmentPath: channel === 'email'
          ? ((c.attachmentPath || '').trim() || (opts.attachmentPath || '').trim() || undefined)
          : undefined,
      });
    }
  }
  // A PERSON WHO IS BEING CONTACTED IS NOT A PERSON WHO WAS SKIPPED.
  //
  // On a two-channel run, someone with no email address fails the email check and then queues
  // fine for LinkedIn — and both facts were recorded, so they appeared in the "will send" list AND
  // in the "will not send" list at the same time. The second one is what the user reads to decide
  // whether the campaign is ready, so it has to mean what it says: these, and only these, are the
  // people nothing will go to.
  const queuedIdx = new Set(queue.map((q) => q.idx));
  return { queue, skipped: skipped.filter((s) => !queuedIdx.has(s.idx)) };
}

// ─── Pacing ───────────────────────────────────────────────────────────────────

/**
 * How long to wait before the next one.
 *
 * Randomised, not fixed. A message every 45.0 seconds for two hours is a signature no human
 * produces, and pattern is what automated-behaviour detection actually looks for — the volume caps
 * above are only half the job. The spread is deliberately wide (±60%).
 */
export function nextDelayMs(baseSeconds: number, rnd: () => number = Math.random): number {
  const base = Math.max(5, baseSeconds) * 1000;
  const jitter = base * 0.6;
  return Math.round(base - jitter + rnd() * jitter * 2);
}

/** Sensible defaults, sized to what the platforms tolerate rather than to what we could push. */
export const SEND_DEFAULTS = {
  /** LinkedIn restricts accounts that message at volume; this is deliberately conservative. */
  linkedinDailyCap: 20,
  /** A young sending domain that blasts 200 cold emails on day one gets filtered permanently. */
  emailDailyCap: 40,
  /** Seconds between sends, before jitter. */
  gapSeconds: 50,
};

/**
 * How fast to work through the list.
 *
 * A choice rather than a constant, because the right pace genuinely differs: fifteen warm intros
 * from a five-year-old domain is not the same job as ninety cold emails from one registered last
 * month. Slower is always safer, so slower is the default, and the fastest option says plainly
 * what it costs.
 */
export const SEND_PACES: { id: string; label: string; gapSeconds: number; note: string }[] = [
  { id: 'careful', label: 'Careful', gapSeconds: 90, note: 'About 40 an hour. Safest for a new domain or a LinkedIn account you cannot afford to lose.' },
  { id: 'normal', label: 'Normal', gapSeconds: 50, note: 'About 70 an hour. A person working steadily through a list.' },
  { id: 'brisk', label: 'Brisk', gapSeconds: 25, note: 'About 140 an hour. Fine for email from an established domain; noticeably fast for LinkedIn.' },
];

const PACE_KEY = 'nv-send-pace';

/** Seconds between sends, from the saved choice. Never below 5 — see nextDelayMs. */
export function loadGapSeconds(): number {
  try {
    const raw = localStorage.getItem(PACE_KEY);
    if (!raw) return SEND_DEFAULTS.gapSeconds;
    // A number means an explicit override (used by tests and by anyone who edits it deliberately);
    // a name means one of the presets above.
    const asNum = Number(raw);
    if (Number.isFinite(asNum) && asNum > 0) return Math.max(5, asNum);
    return SEND_PACES.find((p) => p.id === raw)?.gapSeconds ?? SEND_DEFAULTS.gapSeconds;
  } catch { return SEND_DEFAULTS.gapSeconds; }
}

export function saveGapSeconds(paceId: string): void {
  try { localStorage.setItem(PACE_KEY, paceId); } catch { /* quota */ }
}

export function loadPaceId(): string {
  try { return localStorage.getItem(PACE_KEY) || 'normal'; } catch { return 'normal'; }
}

// ─── The record of what really went ───────────────────────────────────────────

export interface SendLogEntry {
  at: number;
  channel: SendChannel;
  name: string;
  to: string;
  campaign: string;
  /** 'sent' only when something confirmed it. */
  result: 'sent' | 'failed' | 'unconfirmed';
  detail?: string;
}

const LOG_KEY = 'nv-outreach-sendlog';
/** Keep a month. Long enough to answer "did we already contact them?", short enough to not bloat. */
const LOG_KEEP_MS = 31 * 24 * 60 * 60 * 1000;

export function loadSendLog(): SendLogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const all = JSON.parse(raw) as SendLogEntry[];
    if (!Array.isArray(all)) return [];
    const cutoff = Date.now() - LOG_KEEP_MS;
    return all.filter((e) => e && typeof e.at === 'number' && e.at >= cutoff);
  } catch { return []; }
}

export function appendSendLog(entry: SendLogEntry): void {
  try {
    const all = loadSendLog();
    all.push(entry);
    localStorage.setItem(LOG_KEY, JSON.stringify(all.slice(-2000)));
  } catch { /* quota — the run must not die because the log is full */ }
}

/** Start of the local day, so "today" means the user's today and not UTC's. */
export function startOfLocalDay(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * How many have really gone today, per channel.
 *
 * Counts CONFIRMED sends only. A failure did not consume the user's daily allowance and must not
 * eat into it — otherwise a bad afternoon of connection errors silently halves tomorrow's quota.
 */
export function sentToday(log: SendLogEntry[], channel: SendChannel, now = Date.now()): number {
  const from = startOfLocalDay(now);
  return log.filter((e) => e.at >= from && e.channel === channel && e.result === 'sent').length;
}

/** Has this exact person already been sent to on this channel, ever, in the retained window? */
export function alreadySent(log: SendLogEntry[], channel: SendChannel, to: string): boolean {
  const t = String(to || '').trim().toLowerCase();
  if (!t) return false;
  return log.some((e) => e.channel === channel && e.result === 'sent' && String(e.to || '').trim().toLowerCase() === t);
}

// ─── Actually sending one ─────────────────────────────────────────────────────

export interface SendResult {
  ok: boolean;
  /** True only when something positively confirmed delivery. */
  confirmed: boolean;
  detail: string;
}

/**
 * Send ONE message. The only impure function here.
 *
 * Email goes over SMTP when the mailbox is set up for it — the reliable route, and the only one
 * that works for a Titan/Hostinger/Zoho work address. Gmail without SMTP falls back to driving the
 * compose window. LinkedIn has no protocol, so it is always the browser.
 *
 * Every return path distinguishes CONFIRMED from merely "no error", because the caller uses that
 * to decide whether to mark a human being as contacted.
 */
export async function sendOne(
  cand: SendCandidate,
  ctx: {
    smtp?: { host: string; port: number; username: string; implicitTls: boolean; fromName?: string; fromAddress?: string };
    smtpPassword?: string;
  },
): Promise<SendResult> {
  const { invoke } = await import('@tauri-apps/api/core');

  if (cand.channel === 'email') {
    if (ctx.smtp && ctx.smtp.host && ctx.smtpPassword) {
      try {
        const r = await invoke<string>('smtp_send_email', {
          host: ctx.smtp.host,
          port: ctx.smtp.port,
          username: ctx.smtp.username,
          password: ctx.smtpPassword,
          fromName: ctx.smtp.fromName || '',
          fromAddress: ctx.smtp.fromAddress || '',
          to: cand.to,
          subject: cand.subject,
          body: cand.body,
          implicitTls: ctx.smtp.implicitTls,
          attachmentPath: cand.attachmentPath || null,
        });
        // The server accepted it. This is the strongest confirmation available anywhere in this file.
        return { ok: true, confirmed: /^SMTP_SENT/.test(String(r)), detail: String(r) };
      } catch (e) {
        return { ok: false, confirmed: false, detail: `SMTP refused it: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    // No SMTP: drive Gmail's compose window. Works only for Gmail, and says so when it does not.
    try {
      const raw = await invoke<string>('run_browser_persistent', {
        args: `sendmail ${cand.to} ::: ${cand.subject} ::: ${cand.body}`,
      });
      const r = String(raw || '');
      if (r.includes('EMAIL_SENT')) return { ok: true, confirmed: true, detail: 'Gmail confirmed it was sent.' };
      if (r.includes('SEND_UNCONFIRMED')) return { ok: true, confirmed: false, detail: r.slice(0, 240) };
      return { ok: false, confirmed: false, detail: r.slice(0, 240) || 'The browser returned nothing.' };
    } catch (e) {
      return { ok: false, confirmed: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  try {
    const raw = await invoke<string>('run_browser_persistent', { args: `sendmsg ${cand.to} ::: ${cand.body}` });
    const r = String(raw || '');
    if (r.includes('MESSAGE_SENT')) return { ok: true, confirmed: true, detail: 'Confirmed in the LinkedIn conversation.' };
    if (r.includes('SEND_UNCONFIRMED')) return { ok: true, confirmed: false, detail: r.slice(0, 240) };
    return { ok: false, confirmed: false, detail: r.slice(0, 240) || 'The browser returned nothing.' };
  } catch (e) {
    return { ok: false, confirmed: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

// ─── The campaign, as the copilot stores it ───────────────────────────────────
//
// Paired with saveCampaign() in OutreachCopilot.tsx — same key, same shape. It is read here rather
// than imported from there because an automation must not drag a React component into a background
// run, and it is WRITTEN here for the same reason: a scheduled send that could not record who it
// contacted would re-contact them tomorrow.

export const CAMPAIGN_KEY = 'nv-outreach-v1';

export interface StoredCampaign { title?: string; contacts?: SendableContact[]; [k: string]: unknown }

export function loadCampaignForSending(): StoredCampaign | null {
  try {
    const raw = localStorage.getItem(CAMPAIGN_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as StoredCampaign;
    return c && Array.isArray(c.contacts) ? c : null;
  } catch { return null; }
}

/** Write one contact's new status back, leaving everything else exactly as it was. */
export function markContactStatus(idx: number, status: string): void {
  try {
    const c = loadCampaignForSending();
    if (!c || !c.contacts || !c.contacts[idx]) return;
    c.contacts[idx] = { ...c.contacts[idx], status };
    localStorage.setItem(CAMPAIGN_KEY, JSON.stringify({ ...c, updatedAt: Date.now() }));
  } catch { /* storage full — the send still happened and is in the log */ }
}

// ─── One run, shared by the panel and by an automation ────────────────────────

export interface RunHooks {
  /** Called before each send, and repeatedly during the gap that follows one. */
  onProgress?: (p: { done: number; total: number; who: string; channel: SendChannel; waiting: number }) => void;
  onResult?: (r: { name: string; channel: SendChannel; ok: boolean; confirmed: boolean; detail: string }) => void;
  /** Return true to halt at the next boundary. */
  shouldStop?: () => boolean;
  /** Persist the status change. The panel updates React state; an automation writes storage. */
  onSent?: (idx: number) => void;
}

export interface RunSummary {
  sent: number;
  unconfirmed: number;
  failed: number;
  stopped: boolean;
  results: { name: string; channel: SendChannel; ok: boolean; confirmed: boolean; detail: string }[];
}

/**
 * Work through a queue, one at a time, pausing between each.
 *
 * ONE implementation, two callers. The panel and the scheduled automation used to be an obvious
 * candidate for two copies of this loop, and two copies of a loop is how you end up with one path
 * that marks contacts sent on an unconfirmed result and one that does not — the same class of
 * drift that made a retry stream in one place and stay silent in another. There is no second copy.
 *
 * Deliberately sequential and slow: the goal is a run that behaves like a person working through a
 * list, because the account and the sending domain that get restricted for behaving otherwise are
 * the user's own.
 */
export async function runSendQueue(
  queue: SendCandidate[],
  ctx: {
    campaign: string;
    smtp?: { host: string; port: number; username: string; implicitTls: boolean; fromName?: string; fromAddress?: string };
    smtpPassword?: string;
    gapSeconds?: number;
  },
  hooks: RunHooks = {},
): Promise<RunSummary> {
  const results: RunSummary['results'] = [];
  let sent = 0, unconfirmed = 0, failed = 0;
  const gap = ctx.gapSeconds ?? loadGapSeconds();
  const stop = () => (hooks.shouldStop ? hooks.shouldStop() : false);

  for (let n = 0; n < queue.length; n++) {
    if (stop()) break;
    const cand = queue[n];
    hooks.onProgress?.({ done: n, total: queue.length, who: cand.name, channel: cand.channel, waiting: 0 });
    const r = await sendOne(cand, { smtp: ctx.smtp, smtpPassword: ctx.smtpPassword });
    const entry = { name: cand.name, channel: cand.channel, ok: r.ok, confirmed: r.confirmed, detail: r.detail };
    results.push(entry);
    hooks.onResult?.(entry);
    appendSendLog({
      at: Date.now(), channel: cand.channel, name: cand.name, to: cand.to, campaign: ctx.campaign,
      result: r.confirmed ? 'sent' : r.ok ? 'unconfirmed' : 'failed', detail: r.detail.slice(0, 200),
    });
    // ONLY A CONFIRMED SEND MARKS SOMEBODY CONTACTED. An unconfirmed one is left alone on purpose:
    // filing a person who may never have heard from you under "done" is permanent, and a failure
    // that stays a failure gets another chance tomorrow.
    if (r.confirmed) { sent++; hooks.onSent?.(cand.idx); }
    else if (r.ok) unconfirmed++;
    else failed++;

    if (n < queue.length - 1 && !stop()) {
      const until = Date.now() + nextDelayMs(gap);
      while (Date.now() < until && !stop()) {
        hooks.onProgress?.({
          done: n + 1, total: queue.length, who: queue[n + 1].name, channel: queue[n + 1].channel,
          waiting: Math.ceil((until - Date.now()) / 1000),
        });
        await new Promise((r2) => setTimeout(r2, 250));
      }
    }
  }
  return { sent, unconfirmed, failed, stopped: stop(), results };
}

/**
 * Read an automation step's settings out of its own sentence.
 *
 * The step's prompt IS its configuration — "Send up to 20 approved outreach emails" — because that
 * is the box every other step type already has, and a user editing a flow should not have to learn
 * that this one block hides its settings somewhere else. The canvas sidebar writes this sentence
 * from dropdowns; a user can also just type it.
 *
 * Defaults are the cautious ones: email only, 20 per run. An unreadable sentence must not become
 * "send everything to everyone".
 */
export function parseOutreachStepSettings(prompt: string): { channels: SendChannel[]; runLimit: number } {
  const p = String(prompt || '');
  const channels: SendChannel[] = [];
  const wantsLi = /linkedin/i.test(p);
  const liOnly = /linkedin[- ]only|only linkedin/i.test(p);
  if (!liOnly) channels.push('email');
  if (wantsLi) channels.push('linkedin');
  if (!channels.length) channels.push('email');
  // The FIRST number in the sentence is the cap. Bounded hard at both ends: 0 would mean a step
  // that silently never sends, and an unbounded number is how a typo becomes four hundred emails.
  const m = /\b(\d{1,3})\b/.exec(p);
  const runLimit = m ? Math.max(1, Math.min(200, parseInt(m[1], 10))) : 20;
  return { channels, runLimit };
}

/** One sentence describing how a run went, used by both callers so they cannot word it differently. */
export function summarise(s: RunSummary): string {
  return `${s.stopped ? 'Stopped. ' : ''}${s.sent} sent and confirmed`
    + (s.unconfirmed ? `, ${s.unconfirmed} probably sent but unconfirmed (left unmarked — check those yourself)` : '')
    + (s.failed ? `, ${s.failed} failed` : '')
    + '.';
}
