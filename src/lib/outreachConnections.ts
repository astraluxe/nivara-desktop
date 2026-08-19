import { invoke } from '@tauri-apps/api/core';

// ─── Connection-request tracking ─────────────────────────────────────────────
// Sending a connection request is easy; knowing which of thirty pending requests came back is not.
// LinkedIn gives no notification you can query, and a profile's degree badge cannot tell "they
// declined" apart from "you never asked" — both show "Connect".
//
// So we ask two questions in ONE pass and cross-reference the answers:
//   1. `connections`  — who are you connected to now?      (already used by /scan)
//   2. `sentinvites`  — which requests are still pending?  (LinkedIn's own invitation manager)
//
//   in connections            -> ACCEPTED   (message them)
//   still in sent invites     -> PENDING    (keep waiting)
//   in neither                -> GONE       (withdrawn, declined, or expired — worth re-sending)
//
// Two page loads for the whole list, rather than one profile visit per person. That matters: a
// logged-in account opening N stranger profiles in a burst is precisely the pattern LinkedIn's
// automation detection looks for, and a restricted account is far more costly than a slow check.
//
// Everything here is DETERMINISTIC — no model is involved — so it behaves identically on
// adris.tech, on a BYOK key, and on a local model.

export type ConnOutcome = 'accepted' | 'pending' | 'gone' | 'unknown';

export interface ConnPerson {
  name: string;
  url?: string;
  /** LinkedIn's own "1 week ago" for a pending invite — more reliable than asking the user to
   *  remember, and the only age available for invites sent outside this app. */
  sent?: string;
}

export interface ReconcileInput {
  name: string;
  linkedin_url?: string;
  status?: string;
  source?: string;
}

export interface ReconcileResult {
  index: number;
  outcome: ConnOutcome;
  /** Profile URL learned from LinkedIn when the contact had none saved. */
  url?: string;
  /** How long a still-pending invite has been waiting, as LinkedIn reports it. */
  sentAgo?: string;
}

/** LinkedIn profile slug, the only stable identity LinkedIn exposes. */
export function slugOf(url?: string): string {
  if (!url) return '';
  const m = /linkedin\.com\/in\/([^/?#]+)/i.exec(url);
  if (!m) return '';
  // Public profiles often carry a disambiguating hash suffix (…-3a91b7). Two URLs for the same
  // person can differ only by that, so it is not part of identity.
  return decodeURIComponent(m[1]).toLowerCase().replace(/-[0-9a-f]{6,}$/i, '');
}

// Titles and post-nominals that appear on a LinkedIn profile but rarely in a scraped lead list
// (and vice versa). Left in, "Dr. Priya Nair" and "Priya Nair" look like two different people, and
// an accepted request gets reported as expired — the single most annoying way this can be wrong.
const NAME_PREFIX = /^(dr|mr|mrs|ms|miss|prof|professor|er|ca|adv|sir|shri|smt)\b/;
const NAME_SUFFIX = /\b(jr|sr|phd|md|mba|cfa|cpa|pmp|msc|bsc|ii|iii|iv)\b/g;

/** Names as written vary ("Dr. Priya Nair", "priya nair"); compare on letters and digits only. */
export function normName(n?: string): string {
  let s = (n || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ');
  // Strip a leading title repeatedly ("Dr. Prof. X"), then any post-nominals.
  for (let i = 0; i < 3; i++) {
    const next = s.replace(/\s+/g, ' ').trim().replace(NAME_PREFIX, '').trim();
    if (next === s.replace(/\s+/g, ' ').trim() || !next) break;
    s = next;
  }
  s = s.replace(NAME_SUFFIX, ' ');
  const out = s.replace(/[^a-z0-9]/g, '');
  // If stripping consumed the whole name (someone genuinely called "Er"), keep the original —
  // an empty key would match every other emptied name.
  return out || (n || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Does this profile URL plausibly belong to this person?
 *
 * The symptom: on a researched lead list, roughly every profile after the first eight or nine
 * opened the WRONG person. Those URLs were not missing — they were present and confidently wrong,
 * so /verifylinks (which only ever repaired blanks) reported everything fine and the user found out
 * one profile at a time, in front of the people they were trying to reach.
 *
 * The check that catches it costs nothing: a LinkedIn slug is derived from the member's own name
 * ("sapnasinghal", "keshav-sharma", "john-doe-3a91b7"). If the slug shares no part of the name we
 * have, the two are not the same person. Deliberately generous — one matching name token, or a
 * name token appearing anywhere in the slug, is enough — because the cost of a false alarm is one
 * wasted search, while the cost of a miss is messaging a stranger.
 *
 * Returns true when it cannot tell (no URL, no name, an opaque numeric slug), so nothing is thrown
 * away on a hunch.
 */
export function slugLooksLikeName(url: string | undefined, name: string | undefined): boolean {
  const slug = slugOf(url);
  if (!slug) return true;                       // no /in/ URL at all — not this function's business
  const clean = slug.replace(/[^a-z0-9]/g, '');
  // Some profiles have no vanity URL at all — LinkedIn puts its opaque member id there instead
  // ("ACoAAB12cD3e…"). There is no name in that to compare, so it must not be judged as a mismatch.
  if (!/[a-z]/.test(clean) || clean.length < 3) return true;
  if (/^acoa/.test(clean) || (clean.length >= 16 && (clean.match(/\d/g) || []).length >= 4)) return true;
  const tokens = normName(name).length ? (name || '').toLowerCase()
    .normalize('NFKD').replace(/[^a-z\s]/g, ' ').split(/\s+/)
    .map((t) => t.trim()).filter((t) => t.length >= 3) : [];
  if (!tokens.length) return true;              // single-letter or non-Latin name — cannot judge
  return tokens.some((t) => clean.includes(t) || t.includes(clean));
}

function indexPeople(people: ConnPerson[]): { slugs: Map<string, ConnPerson>; names: Map<string, ConnPerson> } {
  const slugs = new Map<string, ConnPerson>();
  const names = new Map<string, ConnPerson>();
  for (const p of people || []) {
    const s = slugOf(p.url);
    if (s && !slugs.has(s)) slugs.set(s, p);
    const n = normName(p.name);
    if (n && !names.has(n)) names.set(n, p);
  }
  return { slugs, names };
}

/**
 * Decide what happened to each tracked contact.
 *
 * `connectionsOk` / `pendingOk` say whether each scrape actually succeeded. This is the important
 * safety property: if the connections scan failed (signed out, LinkedIn changed its markup, the
 * window was closed mid-run) an empty list is NOT evidence that nobody accepted. Treating it as
 * evidence would mark every pending request "gone" and destroy tracking the user has been
 * building for weeks. When a scrape fails we return 'unknown' and change nothing.
 */
export function reconcileConnections(
  contacts: ReconcileInput[],
  connections: ConnPerson[],
  pending: ConnPerson[],
  connectionsOk: boolean,
  pendingOk: boolean,
): ReconcileResult[] {
  const out: ReconcileResult[] = [];
  if (!connectionsOk) {
    // Without a trustworthy connections list nothing can be concluded in either direction.
    contacts.forEach((c, i) => {
      if (c.status === 'connect') out.push({ index: i, outcome: 'unknown' });
    });
    return out;
  }
  const conn = indexPeople(connections);
  const pend = indexPeople(pending);

  contacts.forEach((c, i) => {
    const status = c.status || 'todo';
    // 'connect' = a request we're waiting on. Leads still at 'todo' are worth checking too: if the
    // user is ALREADY connected to them, the connect step can be skipped entirely and they can be
    // messaged today — otherwise the list nags for a request that was never needed.
    const track = status === 'connect' || (status === 'todo' && c.source === 'leads');
    if (!track) return;

    const slug = slugOf(c.linkedin_url);
    const nm = normName(c.name);
    const connHit = (slug && conn.slugs.get(slug)) || (nm ? conn.names.get(nm) : undefined);
    if (connHit) {
      out.push({ index: i, outcome: 'accepted', url: c.linkedin_url || connHit.url || undefined });
      return;
    }
    // A lead we merely haven't contacted yet is not "pending" or "gone" — there is nothing to
    // report about them, so leave them alone.
    if (status !== 'connect') return;

    if (!pendingOk) { out.push({ index: i, outcome: 'unknown' }); return; }
    const pendHit = (slug && pend.slugs.get(slug)) || (nm ? pend.names.get(nm) : undefined);
    out.push(pendHit
      ? { index: i, outcome: 'pending', sentAgo: pendHit.sent, url: c.linkedin_url || pendHit.url || undefined }
      : { index: i, outcome: 'gone' });
  });
  return out;
}

// ─── Browser side ────────────────────────────────────────────────────────────

function parseTagged(raw: string, tag: string): { ok: boolean; people: ConnPerson[]; signIn: boolean } {
  const s = String(raw || '');
  if (/\[SIGN_IN_REQUIRED\]/.test(s)) return { ok: false, people: [], signIn: true };
  const i = s.indexOf(tag);
  if (i === -1) return { ok: false, people: [], signIn: false };
  try {
    const v = JSON.parse(s.slice(i + tag.length).trim());
    // TWO SHAPES, BOTH VALID.
    //
    // `connections` used to emit a bare array and now emits { people, exhausted, loaded } — the
    // extra fields were added so /scan could tell "LinkedIn has no more to give" apart from "this
    // pass ran out of its 45-second budget". /scan was taught both shapes; THIS parser was not, so
    // it hit `!Array.isArray` and reported a total failure on a perfectly good read. That is the
    // copilot's "Couldn't read your connections just now" — it had nothing to do with which model
    // was connected (no model is involved here at all), and it had been failing every single time.
    const arr = Array.isArray(v) ? v : (v && Array.isArray(v.people) ? v.people : null);
    if (!arr) return { ok: false, people: [], signIn: false };
    return {
      ok: true,
      people: arr.filter((p: { name?: unknown; url?: unknown }) => p && (p.name || p.url))
        .map((p: { name?: unknown; url?: unknown; sent?: unknown }) => ({
          name: String(p.name || ''), url: String(p.url || ''), sent: p.sent ? String(p.sent) : undefined,
        })),
      signIn: false,
    };
  } catch { return { ok: false, people: [], signIn: false }; }
}

export interface ConnCheckReport {
  results: ReconcileResult[];
  connectionsOk: boolean;
  pendingOk: boolean;
  signIn: boolean;
  connectionCount: number;
  pendingCount: number;
  error?: string;
}

/**
 * Run both reads and reconcile. Caller supplies the contacts; nothing is written here, so the
 * copilot stays in charge of what it does with the outcome.
 */
export async function checkPendingConnections(
  contacts: ReconcileInput[],
  runBrowser: (args: string) => Promise<string>,
): Promise<ConnCheckReport> {
  let connRaw = '', pendRaw = '';
  try {
    connRaw = await runBrowser('connections');
  } catch (e) { connRaw = String(e); }
  const conn = parseTagged(connRaw, 'CONN_JSON:');
  // If LinkedIn wants a sign-in there is no point loading a second page — say so and stop.
  if (conn.signIn) {
    return { results: [], connectionsOk: false, pendingOk: false, signIn: true, connectionCount: 0, pendingCount: 0 };
  }
  try {
    pendRaw = await runBrowser('sentinvites');
  } catch (e) { pendRaw = String(e); }
  const pend = parseTagged(pendRaw, 'SENTINV_JSON:');

  const results = reconcileConnections(contacts, conn.people, pend.people, conn.ok, pend.ok);
  return {
    results,
    connectionsOk: conn.ok,
    pendingOk: pend.ok,
    signIn: pend.signIn,
    connectionCount: conn.people.length,
    pendingCount: pend.people.length,
    error: conn.ok ? undefined : (connRaw || '').slice(0, 200),
  };
}

/** Default browser runner — kept separate so the logic above can be tested without Tauri. */
export function runBrowserCmd(args: string): Promise<string> {
  return invoke<string>('run_browser_persistent', { args }).catch((e) => String(e));
}

/** Human phrasing for how long a request has been waiting. */
export function waitingLabel(since?: number): string {
  if (!since) return '';
  const days = Math.floor((Date.now() - since) / 86_400_000);
  if (days <= 0) return 'sent today';
  if (days === 1) return 'sent yesterday';
  if (days < 14) return `waiting ${days} days`;
  const weeks = Math.floor(days / 7);
  return `waiting ${weeks} weeks`;
}

// ─── "Has this contact already been written to?" ─────────────────────────────
//
// WHY THIS IS ITS OWN FUNCTION. A drafting run spends a fixed batch (50) on people who have no
// message yet, and decides that with this predicate. It used to live inline in KrewChat and only
// ever checked `linkedin_message` / `connect_note` — but a COMPANY is not messaged on LinkedIn at
// all: its draft is written into `email_subject` / `email_body`, and its `linkedin_message` is
// deliberately left empty.
//
// So for a list of companies the predicate answered "no draft" for every company it had ALREADY
// written. Each run re-picked the same first 50, re-wrote them, and rebuilt the campaign from just
// those 50 — so a 562-company list stayed at 50 for ever and the batch was burned re-doing work.
// That is the bug this fixes; it is pure and exported so it can be tested without React or Tauri.
//
// The rule is simply: whichever text THIS contact actually needs is the one that must exist.
//   company                        -> an email (subject or body)
//   lead, not yet accepted         -> a connection note (LinkedIn's 300-char request)
//   everyone else                  -> the normal LinkedIn message
export interface DraftedLike {
  source?: string;
  status?: string;
  entityKind?: 'person' | 'company';
  linkedin_message?: string;
  connect_note?: string;
  email_subject?: string;
  email_body?: string;
}

export function hasWrittenMessage(prior: DraftedLike | undefined, isCompany = false): boolean {
  if (!prior) return false;
  const filled = (s?: string) => !!s && !!s.trim();
  // The row's own kind wins, but a campaign saved earlier may only carry it on the stored contact.
  if (isCompany || prior.entityKind === 'company') return filled(prior.email_body) || filled(prior.email_subject);
  if (prior.source === 'leads' && prior.status !== 'accepted') return filled(prior.connect_note);
  return filled(prior.linkedin_message);
}
