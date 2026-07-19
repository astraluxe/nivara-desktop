import { invoke } from '@tauri-apps/api/core';
import { credentialStore } from './krewDb';
import { guardDb } from './guardDb';
import { callAutomationAI } from './automationRunner';

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

/** "UID/From/Subject/Date/Preview" blocks separated by "---" — the shape gmail_fetch_emails returns. */
export function parseEmailBlocks(raw: string) {
  if (!raw || /^No emails found/i.test(raw.trim())) return [];
  const field = (b: string, name: string) =>
    (b.match(new RegExp('^' + name + ':\\s*(.*)$', 'im'))?.[1] ?? '').trim();
  return raw.split(/\n\s*---\s*\n/)
    .map((b) => ({
      uid: field(b, 'UID'), from: field(b, 'From'), subject: field(b, 'Subject'),
      date: field(b, 'Date'), snippet: field(b, 'Preview'),
    }))
    .filter((e) => e.uid && (e.from || e.subject));
}

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
export async function runWatchCycle(): Promise<number> {
  if (!isWatchEnabled()) return 0;
  const creds = await credentialStore.get('gmail').catch(() => null) as { email?: string; app_password?: string } | null;
  if (!creds?.email || !creds?.app_password) return 0;

  const raw = await invoke<string>('gmail_fetch_emails', {
    email: creds.email, appPassword: creds.app_password, query: 'UNSEEN', limit: 20,
  }).catch(() => '');
  const emails = parseEmailBlocks(raw);
  if (!emails.length) { try { localStorage.setItem(LAST_RUN_KEY, String(Date.now())); } catch { /* quota */ } return 0; }

  const seen = seenUids();
  const fresh = emails.filter((e) => !seen.has(e.uid)).slice(0, MAX_PER_CYCLE);
  let flagged = 0;

  for (const em of fresh) {
    try {
      const out = await callAutomationAI(
        `From: ${em.from}\nSubject: ${em.subject}\nPreview: ${em.snippet}\n\n`
        + `Return ONLY JSON: {"is_phishing": true|false, "severity": "low"|"med"|"high", "reason": "<one short sentence>"}`,
        'You are a cautious security analyst. Flag phishing, spoofed senders, credential harvesting and payment-fraud wording. Ordinary marketing email is NOT phishing. Respond only with valid JSON.',
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

  rememberUids(fresh.map((e) => e.uid));
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
