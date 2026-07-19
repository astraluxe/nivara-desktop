import { invoke } from '@tauri-apps/api/core';
import { credentialStore } from './krewDb';
import { guardDb } from './guardDb';
import { callAutomationAI } from './automationRunner';
import { getGuardUses, incrementGuardUse } from '../modules/GuardModule';
import { getPlanConfig } from './planConfig';
import { supabase } from './supabase';

/** The signed-in user's plan, for the inbox-check allowance. Falls back to the safest option. */
async function emailCheckLimit(): Promise<number | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return 0;
    const { data } = await supabase.from('users').select('plan').eq('id', session.user.id).single();
    return getPlanConfig((data?.plan as string) ?? 'free').guardEmailChecks;
  } catch { return 0; }
}

// ─── Guard inbox watch ────────────────────────────────────────────────────────
// The product promises that Guard "checks what arrives" and that you "get alerted when something
// actually matters". Until now the only inbox check was a manual button, so nothing watched
// anything. This is that watcher: it polls Gmail on a timer, looks only at mail it has not seen
// before, and raises an alert when a message looks like phishing.
//
// Deliberately conservative:
//   • only runs when Gmail is connected and the user has left the watch enabled
//   • never re-analyses a message it has already judged (tracked by UID)
//   • one AI call per NEW message, capped per cycle, so a busy inbox cannot burn the token budget
//   • every failure is silent — a watcher must never interrupt the app

const SEEN_KEY     = 'nv-guard-seen-uids';
const ENABLED_KEY  = 'nv-guard-watch';
const LAST_RUN_KEY = 'nv-guard-watch-last';
const POLL_MS      = 10 * 60 * 1000;   // every 10 minutes while the app is open
const MAX_PER_CYCLE = 8;               // most new mails analysed in one pass
const SEEN_CAP      = 400;             // keep the seen-list bounded

export const GUARD_ALERT_EVENT = 'nv-guard-alert';

export interface GuardAlert {
  from: string;
  subject: string;
  severity: 'low' | 'med' | 'high';
  reason: string;
}

export function isWatchEnabled(): boolean {
  try { return localStorage.getItem(ENABLED_KEY) !== 'off'; } catch { return true; }
}
export function setWatchEnabled(on: boolean): void {
  try { localStorage.setItem(ENABLED_KEY, on ? 'on' : 'off'); } catch { /* quota */ }
}
export function lastRunAt(): number {
  try { return parseInt(localStorage.getItem(LAST_RUN_KEY) ?? '0', 10) || 0; } catch { return 0; }
}

function seenUids(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')); } catch { return new Set(); }
}
function rememberUids(uids: string[]): void {
  try {
    const merged = [...seenUids(), ...uids].slice(-SEEN_CAP);
    localStorage.setItem(SEEN_KEY, JSON.stringify(merged));
  } catch { /* quota */ }
}

/**
 * Decode RFC 2047 encoded headers ("=?utf-8?B?…?=" / "=?UTF-8?Q?…?="). Without this the subject
 * reaching the analyser was raw base64, so it was judging gibberish — which is how a plain
 * marketing mail ("Up to ₹1,000 cashback on Debit") ended up flagged as phishing.
 */
export function decodeMimeHeader(s: string): string {
  if (!s || !s.includes('=?')) return s;
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_all, _cs, enc, data) => {
    try {
      if (enc.toUpperCase() === 'B') {
        const bin = atob(data);
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        return new TextDecoder('utf-8').decode(bytes);
      }
      // Quoted-printable: "_" is a space, "=XX" is a byte.
      const bytes: number[] = [];
      const q = data.replace(/_/g, ' ');
      for (let i = 0; i < q.length; i++) {
        if (q[i] === '=' && /[0-9a-f]{2}/i.test(q.slice(i + 1, i + 3))) {
          bytes.push(parseInt(q.slice(i + 1, i + 3), 16)); i += 2;
        } else bytes.push(q.charCodeAt(i));
      }
      return new TextDecoder('utf-8').decode(Uint8Array.from(bytes));
    } catch { return data; }
  }).replace(/\?=\s*=\?/g, '').trim();
}

/** "UID/From/Subject/Date/Preview" blocks separated by "---" — the shape gmail_fetch_emails returns. */
export function parseEmailBlocks(raw: string) {
  if (!raw || /^No emails found/i.test(raw.trim())) return [];
  const field = (b: string, name: string) =>
    (b.match(new RegExp('^' + name + ':\\s*(.*)$', 'im'))?.[1] ?? '').trim();
  return raw.split(/\n\s*---\s*\n/)
    .map((b) => ({
      uid: field(b, 'UID'),
      from: decodeMimeHeader(field(b, 'From')),
      subject: decodeMimeHeader(field(b, 'Subject')),
      date: field(b, 'Date'),
      snippet: decodeMimeHeader(field(b, 'Preview')),
    }))
    .filter((e) => e.uid && (e.from || e.subject));
}

// ─── Local triage ─────────────────────────────────────────────────────────────
// Runs entirely on this machine with NO model call. Only mail that scores above the threshold is
// worth spending a token on. Everything else is settled locally and for free, which is what stops
// a busy inbox from quietly eating a month's allowance — and it also removes the false positives,
// because ordinary promotional mail scores at or below zero.

const CREDENTIAL_BAIT = /(verify|confirm|validate|re-?activate|restore|update)\s+(your\s+)?(account|password|identity|details|kyc|card|payment)|sign[- ]?in attempt|unusual (sign|login|activity)|your account (has been|will be) (suspended|locked|closed|blocked|disabled)|password (will )?expir|click here to (login|sign in|verify)/i;
const PAYMENT_FRAUD  = /(wire|bank) transfer|change of bank (details|account)|invoice (is )?(overdue|attached|unpaid)|gift ?card|bitcoin|crypto ?wallet|remit(tance)? (urgently|immediately)|update (your )?(payment|billing) (details|information)/i;
const URGENCY        = /within \d+ ?(hours?|hrs|days?)|immediately|urgent(ly)?|final (notice|warning)|last chance to (keep|avoid|restore)|act now to avoid|failure to (respond|comply)/i;
const MARKETING      = /unsubscribe|cashback|% ?off|\bsale\b|\bdeals?\b|newsletter|webinar|offer ends|don'?t miss|new(sletter)? edition|coupon|discount|refer a friend|invit(e|ation) to|survey|tick tock|claim your/i;
const FREEMAIL       = /@(gmail|yahoo|outlook|hotmail|proton(mail)?|aol|rediffmail)\./i;
const RISKY_TLD      = /\.(zip|mov|top|xyz|click|link|cam|rest|quest|country|gq|tk|ml)\b/i;
const BRANDS         = /(paypal|hdfc|icici|sbi|axis|kotak|microsoft|google|apple|amazon|netflix|linkedin|whatsapp|instagram|facebook|dhl|fedex|irs|income tax|gst|uidai|aadhaar)/i;

export interface Triage { score: number; signals: string[] }

/** Heuristic score. >= AI_THRESHOLD means "worth asking the model about". */
export function triageEmail(e: { from: string; subject: string; snippet: string }): Triage {
  const signals: string[] = [];
  let score = 0;
  const from = (e.from || '').toLowerCase();
  const body = `${e.subject || ''} ${e.snippet || ''}`;
  const domain = (from.match(/@([a-z0-9.-]+)/i)?.[1] ?? '').toLowerCase();
  const display = from.split('<')[0];

  if (CREDENTIAL_BAIT.test(body)) { score += 4; signals.push('asks you to verify or restore an account'); }
  if (PAYMENT_FRAUD.test(body))   { score += 4; signals.push('payment or bank-detail language'); }
  if (URGENCY.test(body))         { score += 2; signals.push('urgency or threat wording'); }
  if (RISKY_TLD.test(domain))     { score += 2; signals.push(`unusual domain (${domain})`); }
  // A brand name in the display name sent from a free mailbox is a classic impersonation shape.
  if (BRANDS.test(display) && FREEMAIL.test(from)) { score += 4; signals.push('brand name sent from a personal mailbox'); }
  // Digit-for-letter lookalikes: paypa1, g00gle, 1cici…
  if (/[a-z]\d[a-z]/i.test(domain.split('.')[0] ?? '') && BRANDS.test(domain.replace(/[0-9]/g, 'o'))) {
    score += 4; signals.push('lookalike domain');
  }
  if (domain.startsWith('xn--')) { score += 3; signals.push('punycode domain'); }
  // Promotional mail is the overwhelming majority of a real inbox and is not phishing.
  if (MARKETING.test(body)) { score -= 3; signals.push('reads as marketing'); }

  return { score, signals };
}

/** Below this, nothing is sent to a model. Tuned so ordinary promo mail never crosses it. */
export const AI_THRESHOLD = 4;

function notify(alert: GuardAlert): void {
  // OS notification when granted; the in-app event always fires so an alert is never lost.
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Guard — suspicious email', {
        body: `${alert.from}\n${alert.subject}\n${alert.reason}`,
      });
    }
  } catch { /* fall through to the in-app banner */ }
  try { window.dispatchEvent(new CustomEvent(GUARD_ALERT_EVENT, { detail: alert })); } catch { /* ignore */ }
}

/**
 * One watch cycle. Returns how many new messages were judged suspicious.
 * Exported so the Guard screen can trigger a check on demand as well as on the timer.
 */
export async function runWatchCycle(deep = false): Promise<number> {
  if (!isWatchEnabled()) return 0;
  const creds = await credentialStore.get('gmail').catch(() => null) as { email?: string; app_password?: string } | null;
  if (!creds?.email || !creds?.app_password) return 0;

  const raw = await invoke<string>('gmail_fetch_emails', {
    email: creds.email, appPassword: creds.app_password, query: 'UNSEEN', limit: 20,
  }).catch(() => '');
  const emails = parseEmailBlocks(raw);
  if (!emails.length) { try { localStorage.setItem(LAST_RUN_KEY, String(Date.now())); } catch { /* quota */ } return 0; }

  const seen = seenUids();
  const unseen = emails.filter((e) => !seen.has(e.uid));

  // Local triage first — free, instant, and settles the overwhelming majority. Only what looks
  // genuinely dangerous is worth a model call. `deep` (an explicit user action) skips the filter.
  const suspicious = deep ? unseen : unseen.filter((e) => triageEmail(e).score >= AI_THRESHOLD);

  // Plan allowance. Only messages that actually reach the MODEL are counted — locally-cleared mail
  // costs nothing, so a Solo user's 50 checks buy far more than 50 emails of protection.
  const limit = await emailCheckLimit();
  const remaining = limit === null ? Infinity : Math.max(0, limit - getGuardUses('email'));
  if (remaining <= 0) {
    try { localStorage.setItem(LAST_RUN_KEY, String(Date.now())); } catch { /* quota */ }
    rememberUids(unseen.map((e) => e.uid));
    return 0;
  }

  const fresh = suspicious.slice(0, Math.min(MAX_PER_CYCLE, remaining));
  if (fresh.length) incrementGuardUse('email', fresh.length);
  let flagged = 0;

  for (const em of fresh) {
    try {
      const out = await callAutomationAI(
        `From: ${em.from}\nSubject: ${em.subject}\nPreview: ${em.snippet}\n\n`
        + `Return ONLY JSON: {"is_phishing": true|false, "severity": "low"|"med"|"high", "reason": "<one short sentence>"}`,
        'You are a cautious security analyst. Flag ONLY genuine phishing: credential harvesting, spoofed or lookalike senders, and payment redirection. Promotional and transactional mail from a real company — offers, cashback, newsletters, statements, ads — is NOT phishing even when it is pushy or urgent. When unsure, answer false. Respond only with valid JSON.',
      );
      const m = out.replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
      if (!m) continue;
      const verdict = JSON.parse(m[0]) as { is_phishing?: boolean; severity?: string; reason?: string };
      if (!verdict.is_phishing) continue;

      const sev = (verdict.severity === 'high' || verdict.severity === 'low') ? verdict.severity : 'med';
      await guardDb.log('phishing_detected', sev, `Phishing · ${em.from} · ${em.subject}`,
        { from: em.from, subject: em.subject, reason: verdict.reason ?? '' });
      notify({ from: em.from, subject: em.subject, severity: sev, reason: verdict.reason ?? 'Looks like phishing.' });
      flagged++;
    } catch { /* one bad message must not stop the cycle */ }
  }

  // Remember every message we looked at, including the ones triage cleared locally —
  // otherwise safe mail would be re-examined on every single poll.
  rememberUids(unseen.slice(0, deep ? unseen.length : undefined).map((e) => e.uid));
  try { localStorage.setItem(LAST_RUN_KEY, String(Date.now())); } catch { /* quota */ }
  return flagged;
}

/** Start the timer. Returns a stop function. Safe to call once at app start. */
export function startGuardWatch(): () => void {
  let stopped = false;
  const tick = () => { if (!stopped) runWatchCycle().catch(() => {}); };
  // A short delay on launch so it never competes with sign-in and first paint.
  const kickoff = setTimeout(tick, 45_000);
  const id = setInterval(tick, POLL_MS);
  return () => { stopped = true; clearTimeout(kickoff); clearInterval(id); };
}
