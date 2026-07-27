// ─── Who the user is ──────────────────────────────────────────────────────────
// The agents knew WHERE the user was (userLocation) but never WHO they were, and that gap produced
// a very specific, very bad failure.
//
// Asked to prep for a meeting, the agent read the calendar, found "Amogh x Keshav intro call" with
// the attendee line "Amogh Misra, Accepted", and researched Amogh Misra — the account owner. It
// came back with a full briefing about the user, to the user, and even opened the user's own
// LinkedIn to do it. From the agent's point of view that was reasonable: two names, no way to tell
// which one it was working for.
//
// So the owner's name is stored, put in the prompt, and used to pick the OTHER party out of an
// event title. Same shape as userLocation: localStorage for fast synchronous reads, mirrored to the
// Krew profile (SQLite in the app-data dir) so it survives an update or reinstall.

import { krewMemoryDb } from './krewDb';

const LS_KEY = 'nv-user-identity';
const PROFILE_SCOPE = '__krew_profile__';   // === KREW_PROFILE_KEY (kept literal to avoid a cycle)
const PROFILE_KEY   = 'identity';

export interface UserIdentity {
  name: string;            // "Amogh Misra" — how they appear in a calendar invite
  company?: string;        // "adris.tech"
  role?: string;           // "Founder"
}

/** The saved identity, or null when we've never been told. Null means ASK — never guess a name. */
export function loadUserIdentity(): UserIdentity | null {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return null;
    const name = String(raw.name || '').trim();
    if (!name) return null;
    return {
      name,
      company: String(raw.company || '').trim() || undefined,
      role: String(raw.role || '').trim() || undefined,
    };
  } catch { return null; }
}

export function saveUserIdentity(id: UserIdentity): void {
  const clean: UserIdentity = {
    name: (id.name || '').trim(),
    company: (id.company || '').trim() || undefined,
    role: (id.role || '').trim() || undefined,
  };
  if (!clean.name) return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(clean)); } catch { /* quota — non-fatal */ }
  krewMemoryDb.save(PROFILE_SCOPE, PROFILE_KEY, JSON.stringify(clean)).catch(() => { /* the localStorage copy still works */ });
  try { window.dispatchEvent(new CustomEvent('nv-identity-changed', { detail: clean })); } catch { /* no window */ }
}

export function clearUserIdentity(): void {
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  krewMemoryDb.delete(PROFILE_SCOPE, PROFILE_KEY).catch(() => { /* ignore */ });
  try { window.dispatchEvent(new CustomEvent('nv-identity-changed', { detail: null })); } catch { /* ignore */ }
}

/** Restore from the durable copy when webview storage has been reset. Call once at startup. */
export async function hydrateUserIdentity(): Promise<UserIdentity | null> {
  const current = loadUserIdentity();
  if (current) return current;
  try {
    const rows = await krewMemoryDb.getAll(PROFILE_SCOPE);
    const row = (rows || []).find((r) => r.key === PROFILE_KEY);
    if (!row?.value) return null;
    const saved = JSON.parse(row.value) as UserIdentity;
    if (saved?.name) {
      try { localStorage.setItem(LS_KEY, JSON.stringify(saved)); } catch { /* quota */ }
      try { window.dispatchEvent(new CustomEvent('nv-identity-changed', { detail: saved })); } catch { /* no window */ }
      return loadUserIdentity();
    }
  } catch { /* db unavailable */ }
  return null;
}

/** Every way the owner's own name might appear, lowercased — full name, first name, "A. Misra". */
export function ownerNameForms(id: UserIdentity | null): string[] {
  const n = (id?.name || '').trim();
  if (!n) return [];
  const parts = n.split(/\s+/).filter(Boolean);
  const forms = new Set<string>([n.toLowerCase()]);
  if (parts[0]) forms.add(parts[0].toLowerCase());
  if (parts.length > 1) {
    forms.add(parts[parts.length - 1].toLowerCase());
    forms.add(`${parts[0][0]}. ${parts[parts.length - 1]}`.toLowerCase());
  }
  return [...forms];
}

/** Is this name the account owner? Used to make sure we never research the user themselves. */
export function isOwnerName(candidate: string, id: UserIdentity | null = loadUserIdentity()): boolean {
  const c = (candidate || '').trim().toLowerCase().replace(/[.,]/g, '');
  if (!c) return false;
  return ownerNameForms(id).some((f) => {
    const ff = f.replace(/[.,]/g, '');
    return c === ff || c.startsWith(`${ff} `) || c.endsWith(` ${ff}`);
  });
}

/**
 * Pull the OTHER party out of a meeting title. "Amogh x Keshav intro call" → "Keshav".
 * Splits on the usual separators people put between two names in an invite, drops the part that is
 * the owner, and strips the trailing noise ("intro call", "sync", "1:1", "meeting").
 */
export function otherPartyFromTitle(title: string, id: UserIdentity | null = loadUserIdentity()): string {
  const t = (title || '').trim();
  if (!t) return '';
  const parts = t.split(/\s+(?:x|×|\/|<>|&|and|with|\|)\s+|\s*[-–—]\s*/i).map((p) => p.trim()).filter(Boolean);
  const noise = /\b(intro|introduction|call|sync|meeting|catch[- ]?up|chat|demo|1[:\- ]?1|discussion|kickoff|standup|review|interview)\b/gi;
  const cleaned = parts
    .map((p) => p.replace(noise, '').replace(/\s{2,}/g, ' ').trim())
    .filter((p) => p && !isOwnerName(p, id));
  // Prefer something that reads like a person's name rather than a leftover fragment.
  return cleaned.find((p) => /^[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,3}$/.test(p)) || cleaned[0] || '';
}

/** One line for the system prompt. Empty when we don't know who they are. */
export function identityBlock(id: UserIdentity | null = loadUserIdentity()): string {
  if (!id?.name) {
    return [
      "\n\n## Who you work for",
      "You do NOT yet know the user's own name. If a task depends on telling the user apart from someone else — reading a calendar invite, a thread, an attendee list — ask them their name once and call set_user_name to remember it.",
    ].join('\n');
  }
  const who = [id.name, id.role, id.company].filter(Boolean).join(' — ');
  return [
    '\n\n## Who you work for',
    `You work for **${who}**. That is the USER — the person reading your answer.`,
    `NEVER research, profile, or write a briefing about ${id.name}. They know who they are; a briefing about the user, addressed to the user, is a complete failure of the task.`,
    `When a calendar event, email or thread contains two names and one of them is ${id.name}, the person of interest is ALWAYS the OTHER one. "${id.name} x Keshav intro call" means the meeting is with **Keshav** — research Keshav.`,
    'Attendee lists include the user themselves; skip them and take the other attendee. If the only name you can find is the user\'s, say you could not identify the other party and ask who it is — do not fall back to profiling the user.',
  ].join('\n');
}
