import { useState, useEffect, useMemo, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { brain, nodeToMarkdown } from '../../lib/knowledgeStore';
import { todos } from '../../lib/todoStore';
import { setAgentBrowserHold, bestProfileMatch } from '../../lib/krewTools';
import { checkPendingConnections, runBrowserCmd, waitingLabel, type ReconcileResult } from '../../lib/outreachConnections';
import { outreachStatusToLeadCell, setLeadConnStatus, setLeadProfileUrl, normaliseLinkedInUrl, isCompanyLinkedInUrl } from '../../lib/leadTable';
import {
  planReply, planFollowUp, verifyWork, refineMessage, applyPromiseAudit, parseMeetingTime,
  actionableIssues, madeProgress, MAX_FIX_ROUNDS, auditScheduling, parseCalendarBusy,
  type ReplyPlan, type VerifyResult,
} from '../../lib/verify';
import { listAttachableDocs, isAttachableFile, type GeneratedDoc } from '../../lib/docgen';

// Assemble what the strategist/verifier needs to know about the USER's side: their pitch and any
// stated availability, pulled from the Brain (product notes, meeting notes) so the drafted reply is
// grounded in real facts instead of invented ones. Kept short — this is context, not a dump.
function buildOwnerContext(): string {
  try {
    const nodes = brain.all().nodes;
    const pick = (re: RegExp, n: number) =>
      nodes.filter((x) => re.test(x.title) || re.test(x.kind))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, n)
        .map((x) => `${x.title}: ${(x.body || '').slice(0, 500)}`);
    const product = pick(/product|pitch|about|adris|company|offer/i, 2);
    const avail = pick(/avail|calendar|meeting|schedule/i, 2);
    // Saved notes are NOT a calendar. Unlabelled, a months-old note reading "meeting with X at
    // 11:30" was treated by the verifier as a live commitment and used to reject a perfectly good
    // proposed time. Only fetchCalendarContext() returns something authoritative.
    const availBlock = avail.length
      ? [
          'SAVED NOTES THAT MENTION TIMES (from the owner\'s own notebook — these are NOT a live',
          'calendar and are very likely out of date. Never treat one as a confirmed commitment or as',
          'a clash unless a live calendar below also shows it):',
          ...avail,
        ].join('\n')
      : '';
    return [...product, availBlock].filter(Boolean).join('\n').slice(0, 3500);
  } catch { return ''; }
}

/** Does this draft put a specific time on the table? If so the calendar has to be consulted, even
 *  when the prospect's own message never mentioned scheduling. */
function proposesATime(draft: string): boolean {
  const d = (draft || '').toLowerCase();
  if (!d) return false;
  return /\b\d{1,2}[:.]\d{2}\s?(am|pm)?\b|\b\d{1,2}\s?(am|pm)\b/.test(d)
    && /\b(tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|this week|call|chat|meet|catch up|slot)\b/.test(d);
}

// ─── Choosing which file to attach ───────────────────────────────────────────
// The old rule was `docs.find(title contains the whole hint) || docs[0]`. The first half almost
// never matched (the hint is a phrase like "a one-pager about the product", which is not a
// substring of any filename), so in practice it fell through to docs[0] — whatever happened to be
// most recent. That is how a spreadsheet of the user's own leads came within one click of being
// sent TO one of those leads.
//
// So: score on token overlap, never fall back to "the first one", and refuse outright to attach
// anything that looks like internal working material.

/** Files that must never be offered to a prospect no matter how well they score. A lead list is
 *  the user's own pipeline — sending it out leaks every other prospect's details. */
function isInternalDoc(d: GeneratedDoc): boolean {
  const hay = `${d.title} ${d.filename} ${d.summary || ''}`.toLowerCase();
  return /\b(lead|leads|prospect|prospects|contact list|outreach|campaign|pipeline|scan|connections|export|raw|internal|draft notes)\b/.test(hay)
    // Spreadsheets are working files by nature; one is only ever sendable if it is explicitly
    // named as something for the recipient (a pricing sheet, a quote, an invoice).
    || (['xlsx', 'xls', 'csv'].includes(d.kind) && !/\b(pricing|price|quote|invoice|proposal|estimate)\b/.test(hay));
}

const DOC_STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'with', 'about', 'that', 'this', 'our', 'your', 'their', 'it', 'is', 'are', 'be', 'on', 'in', 'as', 'file', 'document', 'doc', 'something', 'more', 'info', 'information', 'send', 'share', 'attach', 'attachment']);
const docTokens = (s: string): string[] =>
  (s || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !DOC_STOPWORDS.has(t));

/**
 * Pick the generated file that genuinely matches what the plan asked for — or nothing at all.
 * `hint` is the strategist's attachHint; `context` is the thread + person, so a doc that talks
 * about the prospect's own field wins over one that doesn't. Returns null when nothing clears the
 * bar, because attaching the wrong file is worse than attaching none: the user has to notice and
 * undo it, and if they don't, the prospect receives something irrelevant or private.
 */
function pickAttachment(docs: GeneratedDoc[], hint: string, context: string): GeneratedDoc | null {
  const sendable = docs.filter((d) => !isInternalDoc(d));
  if (!sendable.length) return null;
  const hintToks = docTokens(hint);
  const ctxToks = new Set(docTokens(context).slice(0, 400));
  let best: GeneratedDoc | null = null;
  let bestScore = 0;
  for (const d of sendable) {
    const hay = `${d.title} ${d.filename} ${d.summary || ''}`.toLowerCase();
    const hayToks = new Set(docTokens(hay));
    // The hint is what the plan actually asked for, so it carries the most weight.
    let score = hintToks.reduce((n, t) => n + (hayToks.has(t) ? 3 : 0), 0);
    // An exact kind request ("pdf", "deck") is a strong signal on its own.
    if (hint && (d.kind === hint.toLowerCase().trim() || hay.includes(hint.toLowerCase().trim()))) score += 4;
    // Weak tie-break: words the conversation itself is about.
    for (const t of hayToks) if (ctxToks.has(t)) score += 1;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  // Below this, the "match" is one incidental shared word — which is not a reason to attach a file.
  return bestScore >= 3 ? best : null;
}

// ─── Human-in-the-loop LinkedIn / email outreach ─────────────────────────────
// Why this exists instead of full automation:
// LinkedIn's User Agreement forbids automated messaging/connecting, and their
// systems flag it fast — accounts that auto-DM get restricted or permanently
// banned. That is the LAST thing we want right before the user pitches real
// clients. So adris does everything AROUND the send — drafts each message,
// opens the right profile, tracks who was contacted and who accepted — and the
// user does the one thing only a human safely can: paste and hit send (2s each).

// 'meeting' and 'met' close the loop the list previously stopped short of: "Replied" was the last
// thing you could record, so a booked call and a call that already happened looked identical to
// someone who had merely answered a message.
export type OutreachStatus = 'todo' | 'connect' | 'sent' | 'accepted' | 'replied' | 'meeting' | 'met' | 'skip';

/** Where a person came from. 'connections' = already a 1st-degree connection (from /scan);
 *  'leads' = a prospect off a Brain lead list, who probably still needs a connection request. */
export type OutreachSource = 'connections' | 'leads';

export interface OutreachContact {
  name: string;
  company?: string;
  linkedin_url?: string;
  email?: string;
  /** X/Twitter handle — stored bare or as a URL; bareHandle() normalises either. */
  x_handle?: string;
  /** Instagram handle — same. Used for influencer outreach, where there is no LinkedIn. */
  instagram_handle?: string;
  linkedin_message?: string;
  email_subject?: string;
  email_body?: string;
  status?: OutreachStatus;
  // ── Connection tracking. All optional: campaigns saved before this existed load unchanged and
  // simply behave as connections, which is what they were.
  source?: OutreachSource;
  /** ≤300 chars — what LinkedIn allows on a connection request. Used instead of the full message
   *  while the person is not connected yet. */
  connect_note?: string;
  /** When the user marked the request as sent, so the copilot can say "waiting 6 days". */
  requestedAt?: number;
  /** Set when a check confirmed they accepted — drives the one-time auto-draft of the real message. */
  acceptedAt?: number;
  /** Brain lead-list note this person came from, so their Connection Status can be written back. */
  leadList?: string;
  /** LinkedIn's own age for a still-pending request ("1 week ago"). Covers invites the user sent
   *  by hand, long before this campaign existed. */
  sentAgo?: string;
}

export interface OutreachCampaign {
  title: string;
  contacts: OutreachContact[];
  channel?: 'linkedin' | 'email' | 'both';
  deckAttached?: boolean;
  updatedAt?: number;
}

const LS_KEY = 'nv-outreach-v1';
// A title-keyed archive of every campaign's latest state. The single LS_KEY "current" slot gets
// overwritten by whatever campaign was opened last — so drafting a 1-person REPLY used to clobber a
// 35-person outreach still in progress. The archive keeps each campaign recoverable, and
// loadResumableCampaign() below picks the one with the most people still to contact.
const CAMPAIGNS_KEY = 'nv-outreach-campaigns-v1';
// One stable key: re-running outreach refreshes the SAME To-do card instead of stacking a new one.
const OUTREACH_TODO_KEY = 'outreach:current';

/** People not yet handled (anything other than sent/accepted/replied/skip). */
function remainingOf(c: OutreachCampaign): number {
  return c.contacts.filter((x) => !(x.status === 'sent' || x.status === 'accepted' || x.status === 'replied' || x.status === 'skip')).length;
}
function loadCampaignArchive(): Record<string, OutreachCampaign> {
  try {
    const r = JSON.parse(localStorage.getItem(CAMPAIGNS_KEY) || '{}');
    return (r && typeof r === 'object' && !Array.isArray(r)) ? (r as Record<string, OutreachCampaign>) : {};
  } catch { return {}; }
}
function saveCampaignArchive(map: Record<string, OutreachCampaign>): void {
  // Keep only the 12 most-recent campaigns so this can never grow without bound.
  const entries = Object.entries(map)
    .filter(([, c]) => c && Array.isArray(c.contacts) && c.contacts.length)
    .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
    .slice(0, 12);
  try { localStorage.setItem(CAMPAIGNS_KEY, JSON.stringify(Object.fromEntries(entries))); } catch { /* quota */ }
}

const STATUS_META: Record<OutreachStatus, { label: string; cls: string }> = {
  todo:     { label: 'To do',            cls: 'border-nv-border text-nv-faint' },
  connect:  { label: 'Connect requested', cls: 'border-amber-500/60 text-amber-600 bg-amber-500/15' },
  sent:     { label: 'Message sent',      cls: 'border-sky-600/60 text-sky-600 bg-sky-600/15' },
  accepted: { label: 'Accepted',          cls: 'border-emerald-600/60 text-emerald-600 bg-emerald-600/15' },
  replied:  { label: 'Replied',           cls: 'border-violet-600/60 text-violet-600 bg-violet-600/15' },
  meeting:  { label: 'Meeting booked',    cls: 'border-teal-600/60 text-teal-600 bg-teal-600/15' },
  met:      { label: 'Meeting done',      cls: 'border-emerald-700/60 text-emerald-700 bg-emerald-700/20' },
  skip:     { label: 'Skipped',           cls: 'border-nv-border text-nv-faint/60 line-through' },
};

function openLink(url: string) {
  import('@tauri-apps/plugin-shell').then(({ open }) => open(url)).catch(() => window.open(url, '_blank'));
}
async function copyText(t: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(t); return true; }
  catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy');
      document.body.removeChild(ta); return true;
    } catch { return false; }
  }
}

function profileUrl(c: OutreachContact): string {
  if (c.linkedin_url && /linkedin\.com\/in\//i.test(c.linkedin_url)) return c.linkedin_url;
  // No profile URL saved → open a LinkedIn people-search for their name ONLY (never the company/
  // headline, which can be a generated fit-description that garbles the query) so the user lands on
  // or one click from the right person instead of a dead "no results" search.
  const q = encodeURIComponent((c.name || '').trim());
  return `https://www.linkedin.com/search/results/people/?keywords=${q}`;
}

/** Pick the best LinkedIn profile URL from findprofile results for a given contact name, or ''
 *  when nothing matches confidently (so we never point a button at a stranger who merely shares a
 *  surname). The matching rule itself lives in krewTools as bestProfileMatch — the copilot's
 *  self-heal, /verifylinks and research_person all go through that one rule. */
export function bestProfileUrl(results: Array<{ name?: string; url?: string; degree?: string }>, contactName: string): string {
  return bestProfileMatch(results, contactName)?.url || '';
}
/**
 * How can THIS person actually be reached?
 *
 * The campaign carries a channel, but it is one setting for everybody — so a lead with an email
 * and no LinkedIn profile was shown a LinkedIn-shaped panel with nothing on it that would work,
 * and a lead with neither looked identical to one that was ready to go. Deciding per person is
 * what makes a mixed list usable: profiles go to LinkedIn, the rest go to email, and anyone with
 * neither is called out rather than sitting there looking finished.
 */
/**
 * Extra search terms that tell two people with the same name apart.
 *
 * A bare name search on LinkedIn returns everyone who shares it, and taking the top hit is how a
 * lead ends up pointing at a stranger — which then gets a message addressed to the wrong person.
 * The company and city are the two things that actually disambiguate, and both are already on the
 * contact. Role words are dropped: they narrow the search to a job title rather than a person.
 */
function profileFilter(c: OutreachContact): string {
  // The cell comes in BOTH orders — "Sharma Textiles / Owner" and "Co-Founder & CEO, BakeMyTrip"
  // — so taking the part before the separator is wrong half the time. Strip the role words from
  // every part and keep the first that still says something. Taking the first part blindly turned
  // "Co-Founder & CEO, BakeMyTrip" into "&", which would have been appended to the search as
  // literal noise rather than narrowing anything.
  for (const part of (c.company || '').split(/\s*[/|·—–,]\s*|\s+\bat\b\s+/i)) {
    const stripped = part
      .replace(/\b(co-?founders?|founders?|ceo|cto|coo|cmo|cfo|md|managing director|directors?|owners?|partners?|presidents?|heads? of[\w\s]*|head|vp|vice president|leads?|principal)\b/gi, ' ')
      .replace(/[&|,]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Two characters of leftover punctuation is not a company name.
    if (stripped.length > 2) return stripped.slice(0, 60);
  }
  return '';
}
export type ContactChannel = 'linkedin' | 'email' | 'x' | 'instagram' | 'none';

/**
 * Normalise a handle the way people actually write it — "@amogh", "amogh",
 * "x.com/amogh", "https://twitter.com/amogh?s=21", "instagram.com/amogh/" — down to the bare
 * handle. Returns '' when there is nothing usable, so a blank field never produces a button
 * pointing at a broken profile.
 */
export function bareHandle(raw?: string): string {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  s = s.replace(/^(?:x\.com|twitter\.com|instagram\.com)\//i, '');
  s = s.split(/[?#]/)[0].replace(/\/+$/, '');
  s = s.replace(/^@/, '');
  // A handle is one path segment of legal characters; anything else (a post URL, a sentence)
  // is not a profile and must not be turned into one.
  return /^[A-Za-z0-9._]{1,30}$/.test(s) ? s : '';
}

/**
 * Which channel this person is actually reachable on.
 *
 * Order is deliberate and reflects what works, not what is fashionable: LinkedIn and email are
 * the two the copilot can also READ replies from, so they come first. X and Instagram are
 * send-only here — the copilot opens the right DM with the message on your clipboard, and you
 * press send. Nothing is ever sent automatically on any channel; on these two that is doubly
 * deliberate, since automated DMs are what gets a real account restricted.
 */
export function contactChannel(c: OutreachContact): ContactChannel {
  if (c.linkedin_url && /linkedin\.com\/in\//i.test(c.linkedin_url)) return 'linkedin';
  if ((c.email || '').includes('@')) return 'email';
  if (bareHandle(c.x_handle)) return 'x';
  if (bareHandle(c.instagram_handle)) return 'instagram';
  return 'none';
}

/** Every channel this person can be reached on, for showing all the options rather than only the
 *  best one — an influencer with Instagram AND an agency email should show both. */
export function allChannels(c: OutreachContact): ContactChannel[] {
  const out: ContactChannel[] = [];
  if (c.linkedin_url && /linkedin\.com\/in\//i.test(c.linkedin_url)) out.push('linkedin');
  if ((c.email || '').includes('@')) out.push('email');
  if (bareHandle(c.x_handle)) out.push('x');
  if (bareHandle(c.instagram_handle)) out.push('instagram');
  return out;
}

/** The page that opens the DM composer for a handle-based channel. */
export function dmUrl(c: OutreachContact, ch: 'x' | 'instagram'): string {
  const h = bareHandle(ch === 'x' ? c.x_handle : c.instagram_handle);
  if (!h) return '';
  // X opens a real message composer for a handle. Instagram has no public deep link that opens a
  // thread by username, so it opens the profile — one click from Message, and it always resolves,
  // which a guessed thread URL would not.
  return ch === 'x' ? `https://x.com/messages/compose?recipient_id=${encodeURIComponent(h)}`
                    : `https://www.instagram.com/${encodeURIComponent(h)}/`;
}

export const CHANNEL_LABEL: Record<ContactChannel, string> = {
  linkedin: 'LinkedIn', email: 'Email', x: 'X', instagram: 'Instagram', none: 'No contact yet',
};
function gmailComposeUrl(c: OutreachContact): string {
  const su = encodeURIComponent(fillTokens(c.email_subject || '', c));
  const body = encodeURIComponent(fillTokens(c.email_body || c.linkedin_message || '', c));
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(c.email || '')}&su=${su}&body=${body}`;
}
function fillTokens(t: string, c: OutreachContact): string {
  return (t || '').replace(/\{name\}/gi, c.name || 'there').replace(/\{company\}/gi, c.company || 'your company');
}

/** Persist the live campaign so the copilot survives reloads and the Brain shows progress. */
export function saveCampaign(camp: OutreachCampaign) {
  const stamped = { ...camp, updatedAt: Date.now() };
  try { localStorage.setItem(LS_KEY, JSON.stringify(stamped)); } catch { /* quota */ }
  // Archive by title so this campaign is always recoverable even after a different (e.g. a 1-person
  // reply) campaign is opened and overwrites the "current" slot.
  try { if (stamped.title) { const arch = loadCampaignArchive(); arch[stamped.title] = stamped; saveCampaignArchive(arch); } } catch { /* quota */ }
  // Human-readable mirror in the Brain (kind 'outreach') so the user can SEE progress and
  // any agent can recall who's already been contacted — de-duped by title so it updates in
  // place rather than piling up a new node every status change.
  try {
    const done = camp.contacts.filter((c) => c.status === 'sent' || c.status === 'accepted' || c.status === 'replied').length;
    const rows = camp.contacts.map((c) =>
      `| ${c.name || '—'} | ${c.company || '—'} | ${STATUS_META[c.status || 'todo'].label} |`).join('\n');
    const body =
      `Outreach progress — ${done}/${camp.contacts.length} contacted.\n\n` +
      `| Name | Company | Status |\n| --- | --- | --- |\n${rows}\n`;
    brain.addNode({ title: camp.title, kind: 'outreach', body });
  } catch { /* Brain optional */ }
  // Mirror progress onto the To-do panel so "where did I leave off" survives closing the popup,
  // deleting the chat, or restarting the app. The card tracks the campaign with the MOST people
  // still to contact (not just the one being saved) — so finishing a small reply can't wipe the
  // card for a bigger campaign still in progress. `done: false` un-ticks a stale card whenever
  // there is genuinely fresh work, fixing the "the next task showed up already done" bug.
  try {
    const best = loadResumableCampaign();
    if (!best) todos.removeBySource(OUTREACH_TODO_KEY);
    else {
      const left = remainingOf(best);
      const done = best.contacts.length - left;
      todos.upsertResume(
        OUTREACH_TODO_KEY,
        `${best.title} — ${left} still to message (${done}/${best.contacts.length} done)`,
        { kind: 'outreach', label: best.title },
        { done: false },
      );
    }
  } catch { /* To-do optional */ }
}

/**
 * Rename a saved campaign everywhere it is stored.
 *
 * A campaign's title lives in THREE places that must move together: the "current" slot, the
 * title-keyed archive, and the Brain note. Renaming only the Brain note left the campaign still
 * calling itself the old name — so the next save happily recreated a second note under the old
 * title, and the To-do card kept showing it. Returns true if anything was actually renamed.
 */
export function renameCampaign(oldTitle: string, newTitle: string): boolean {
  const from = (oldTitle || '').trim();
  const to = (newTitle || '').trim();
  if (!from || !to || from === to) return false;
  let changed = false;
  try {
    const cur = loadSavedCampaign();
    if (cur && (cur.title || '').trim() === from) {
      localStorage.setItem(LS_KEY, JSON.stringify({ ...cur, title: to }));
      changed = true;
    }
    const arch = loadCampaignArchive();
    if (arch[from]) {
      arch[to] = { ...arch[from], title: to };
      delete arch[from];
      saveCampaignArchive(arch);
      changed = true;
    }
    // Re-point the resume card at the new name so "Continue" still resumes this campaign.
    if (changed) {
      for (const t of todos.all()) {
        if (t.resume?.kind === 'outreach' && t.resume.label === from) {
          todos.update(t.id, { resume: { ...t.resume, label: to }, text: t.text.split(from).join(to) });
        }
      }
    }
  } catch { /* storage optional — a failed rename must never break the note rename itself */ }
  return changed;
}

/** The campaign saved under an exact title — used when the user PICKS a destination, so its
 *  statuses are the ones we resume rather than whichever campaign happens to be largest. */
export function loadCampaignByTitle(title: string): OutreachCampaign | null {
  const want = (title || '').trim().toLowerCase();
  if (!want) return null;
  try {
    const cur = loadSavedCampaign();
    if (cur && (cur.title || '').trim().toLowerCase() === want) return cur;
    for (const c of Object.values(loadCampaignArchive())) {
      if ((c?.title || '').trim().toLowerCase() === want) return c;
    }
  } catch { /* storage optional */ }
  return null;
}

export function loadSavedCampaign(): OutreachCampaign | null {
  try {
    const r = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (r && Array.isArray(r.contacts) && r.contacts.length) return r as OutreachCampaign;
  } catch { /* ignore */ }
  return null;
}

/** The best campaign to RESUME: the one with the most people still to contact (ties → most recent).
 *  Reads the archive as well as the current slot, so drafting a 1-person reply — which overwrites the
 *  "current" slot — never hides a 35-person campaign the user is still working through. */
export function loadResumableCampaign(): OutreachCampaign | null {
  const byTitle = new Map<string, OutreachCampaign>();
  const consider = (c: OutreachCampaign | null) => {
    if (!c || !Array.isArray(c.contacts) || !c.contacts.length) return;
    const k = c.title || '';
    const ex = byTitle.get(k);
    if (!ex || (c.updatedAt || 0) >= (ex.updatedAt || 0)) byTitle.set(k, c);
  };
  consider(loadSavedCampaign());
  for (const c of Object.values(loadCampaignArchive())) consider(c);
  let best: OutreachCampaign | null = null;
  let bestScore = -1;
  for (const c of byTitle.values()) {
    const rem = remainingOf(c);
    if (rem <= 0) continue;
    const score = rem * 1e13 + (c.updatedAt || 0); // most remaining first, then most recent
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

// Where to land when the copilot opens / a campaign loads: the FIRST person still to contact, so
// resuming drops you on the next to-do instead of back at contact #1 (which you may have long done).
function firstUndoneIdx(arr: OutreachContact[]): number {
  const i = arr.findIndex((c) => !(c.status === 'sent' || c.status === 'accepted' || c.status === 'replied' || c.status === 'skip'));
  return i >= 0 ? i : 0;
}

export default function OutreachCopilot({ campaign, onClose, googleToken = '', aiCall }: { campaign: OutreachCampaign; onClose: () => void; googleToken?: string; aiCall?: (user: string, system: string) => Promise<string> }) {
  const [contacts, setContacts] = useState<OutreachContact[]>(
    campaign.contacts.map((c) => ({ ...c, status: c.status || 'todo' })));
  const [idx, setIdx] = useState(() => firstUndoneIdx(campaign.contacts));
  const [copied, setCopied] = useState<'msg' | 'email' | 'note' | 'x' | 'ig' | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const [search, setSearch] = useState('');   // jump-to-a-contact by name, instead of Prev/Next spam
  const [opening, setOpening] = useState(false);
  const [openNote, setOpenNote] = useState('');
  // The LinkedIn box is a DRAFT until it validates — typing half a URL must not blank the saved one.
  const [liDraft, setLiDraft] = useState('');
  const [liNote, setLiNote] = useState('');
  // True once we've opened a chat for this session — the browser window is now the user's
  // workspace, so it must not be auto-closed under them by a background run finishing.
  const [browserOpen, setBrowserOpen] = useState(false);

  // ── Reply scanning + agentic verification (per contact, by index) ──
  // When a contact replies, we read the real thread, plan the next move, and independently verify
  // the drafted reply — all before the user acts. The user reviews and sends; nothing is automatic.
  const [plan, setPlan] = useState<ReplyPlan | null>(null);
  const [planIdx, setPlanIdx] = useState<number>(-1);     // which contact the current plan is for
  const [planning, setPlanning] = useState(false);
  const [planNote, setPlanNote] = useState('');
  const [draftReply, setDraftReply] = useState('');
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [docs, setDocs] = useState<GeneratedDoc[]>([]);
  const [attachDoc, setAttachDoc] = useState<GeneratedDoc | null>(null);
  // ── Making the meeting real ──
  // The copilot could read a calendar and it could put "Meeting: Friday 6 PM" on screen, but it had
  // no way to CREATE anything — so a reply saying "I've sent the calendar invite" was a promise the
  // panel that produced it was structurally incapable of keeping. These carry what genuinely
  // happened, and feed the promise audit above.
  const [meetingMade, setMeetingMade] = useState(false);
  const [meetLink, setMeetLink] = useState('');
  const [meetingGuests, setMeetingGuests] = useState('');
  const [meetingBusy, setMeetingBusy] = useState(false);
  const [meetingNote, setMeetingNote] = useState('');
  // ── Keeping the fix loop finite ──
  // On a free/small model the verifier is not a stable judge: rewrite the draft and it returns a
  // fresh crop of complaints, so "Fix and re-check" could be pressed forever. These track how many
  // goes have been had and whether the last one actually got anywhere.
  const [fixRound, setFixRound] = useState(0);
  const [fixStalled, setFixStalled] = useState(false);
  const [refineInput, setRefineInput] = useState('');
  const [refining, setRefining] = useState(false);
  const [refineNote, setRefineNote] = useState('');       // feedback when a refine fails / returns nothing
  // ── The panel must never look frozen ───────────────────────────────────────────────────────
  //
  // "Checking your calendar & planning the next move…" was written once and then sat there for a
  // minute and a half while a big model read the thread. Ninety-five seconds of a motionless line
  // is indistinguishable from a hang — the user assumed it had broken, and any user would.
  //
  // stageRef holds WHAT is happening; the ticker below appends HOW LONG it has been happening and
  // repaints every second. The elapsed count is the part that proves it is alive, so it matters
  // more than the wording. Live tool progress writes into the same ref rather than to the note
  // directly, so the two cannot fight over the line.
  const stageRef = useRef('');
  const stageStartRef = useRef(0);
  const setStage = (t: string) => { stageRef.current = t; if (!stageStartRef.current) stageStartRef.current = Date.now(); };
  useEffect(() => {
    if (!planning && !verifying && !refining) { stageStartRef.current = 0; stageRef.current = ''; return; }
    let alive = true;
    if (!stageStartRef.current) stageStartRef.current = Date.now();
    const paint = () => {
      if (!alive || !stageRef.current) return;
      const secs = Math.round((Date.now() - stageStartRef.current) / 1000);
      const el = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`;
      // Past a minute, say plainly that a long wait is expected on a big model rather than leaving
      // the user to guess whether to keep waiting.
      const hint = secs >= 60 ? ' — a large model can take a couple of minutes to start' : '';
      setPlanNote(`${stageRef.current} · ${el}${hint}`);
    };
    const iv = setInterval(paint, 1000);
    paint();
    const un = listen<{ text?: string }>('agent-progress', (e) => {
      const t = (e.payload?.text || '').trim();
      if (alive && t) { stageRef.current = t; paint(); }
    });
    return () => { alive = false; clearInterval(iv); un.then((f) => f()).catch(() => {}); };
  }, [planning, verifying, refining]);
  const [statusFilter, setStatusFilter] = useState<OutreachStatus | null>(null);  // filter list by status
  const [sourceFilter, setSourceFilter] = useState<OutreachSource | null>(null);  // connections vs leads
  const [checking, setChecking] = useState(false);        // a connection check is running
  const [checkNote, setCheckNote] = useState('');         // what the last check found
  const [lastThread, setLastThread] = useState('');       // remembered so refine/re-verify have context
  const [lastOwnerCtx, setLastOwnerCtx] = useState('');
  const planRef = useRef<HTMLDivElement | null>(null);

  // Pull the user's REAL upcoming calendar so a proposed meeting time is checked against what they're
  // actually doing — the gap the user hit: a reply offered "tomorrow 10:30" while they had a 9am that
  // could run over. Prefers the Google API when connected; otherwise reads the calendar straight from
  // the logged-in agent browser, so this works even without connecting Google via ConnectApps.
  async function fetchCalendarContext(schedulingLikely: boolean): Promise<string> {
    const { invoke } = await import('@tauri-apps/api/core');
    // The date matters as much as the entries: without it, a past event reads as an upcoming one.
    const today = new Date().toLocaleString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const preface = `The owner's REAL calendar, read just now (it is currently ${today}). Everything listed is in the FUTURE — do NOT propose or confirm a time that clashes with these; if a slot is close to or right after one of these, flag it to confirm, as a meeting before it could run over:`;

    // 1) Fast, structured path — Google connected via OAuth.
    if (googleToken) {
      try {
        const now = new Date().toISOString();
        const end = new Date(Date.now() + 3 * 86_400_000).toISOString();
        const raw = await invoke<string>('krew_http_call', {
          method: 'GET',
          url: `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now}&timeMax=${end}&maxResults=20&orderBy=startTime&singleEvents=true`,
          headers: { Authorization: `Bearer ${googleToken}` },
          body: null,
        });
        const data = JSON.parse(raw) as { items?: Array<{ summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }> };
        const items = (data.items || []).slice(0, 15).map((e) => {
          const s = e.start?.dateTime || e.start?.date || '';
          const en = e.end?.dateTime || e.end?.date || '';
          return `- ${e.summary || '(busy)'}: ${s}${en ? ` → ${en}` : ''}`;
        });
        if (items.length) return `${preface}\n${items.join('\n')}`;
        // Fall through to the browser read if the API returned nothing (wrong calendar / scope).
      } catch { /* fall through to the browser read */ }
    }

    // 2) Browser path — no connection needed. Only bother opening Calendar in the browser when the
    // conversation is actually about timing, so a normal reply doesn't flash the browser open.
    if (!schedulingLikely) return '';
    try {
      setAgentBrowserHold(true); setBrowserOpen(true);
      const raw = await invoke<string>('run_browser_persistent', { args: 'gcalcheck' }).catch((e) => String(e));
      if (raw.includes('SIGN_IN_REQUIRED')) return "(Couldn't check the calendar — the owner isn't signed in to Google in the ADRIS browser. Treat their availability as unknown: do not invent a specific time, ask the prospect what suits them.)";
      const ct = raw.indexOf('CALENDAR_TEXT:');
      if (ct >= 0) {
        const text = raw.slice(ct + 'CALENDAR_TEXT:'.length).trim();
        if (text) return `${preface}\n${text}`;
      }
    } catch { /* no calendar available */ }
    return '';
  }

  // Reading the inbox brings the Chrome window to the front, which hides this copilot — where the
  // drafted reply actually appears. So after a scan we pull the adris window back in front and
  // scroll the plan into view, otherwise the user is left staring at Chrome asking "where's my reply?".
  async function refocusAppToPlan() {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const w = getCurrentWindow();
      await w.show().catch(() => {});
      await w.setFocus().catch(() => {});
    } catch { /* not in Tauri — no-op */ }
    // Let the panel render, then scroll it into view inside the copilot.
    setTimeout(() => { try { planRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { /* ignore */ } }, 120);
  }

  // Release the hold if the copilot goes away for any reason (Done, Esc, unmount) — otherwise the
  // browser could never be auto-closed again for the rest of the session.
  useEffect(() => () => { setAgentBrowserHold(false); }, []);

  // Refresh the attachable-docs list whenever the popup opens or a contact changes — a doc the user
  // just generated ("make a PDF") should appear here without a reload. Includes BOTH Krew-generated
  // docs AND any professional file saved in the Brain (so a PDF the user dropped into the Brain is
  // ready to attach too), de-duplicated by path.
  useEffect(() => {
    const gen = listAttachableDocs();
    const seen = new Set(gen.map((d) => d.path.toLowerCase()));
    const fromBrain: GeneratedDoc[] = [];
    try {
      for (const n of brain.all().nodes) {
        const fp = (n.filePath || '').trim();
        if (!fp || !isAttachableFile(fp) || seen.has(fp.toLowerCase())) continue;
        seen.add(fp.toLowerCase());
        fromBrain.push({ id: `brain-${n.id}`, title: n.title || (fp.split(/[\\/]/).pop() || 'file'), filename: fp.split(/[\\/]/).pop() || 'file', path: fp, kind: (fp.split('.').pop() || '').toLowerCase(), summary: 'From your Brain', createdAt: n.updatedAt || Date.now() });
      }
    } catch { /* brain optional */ }
    setDocs([...gen, ...fromBrain]);
  }, [idx, campaign]);

  // Clear any plan/verification when moving to a different contact — a plan belongs to one person.
  useEffect(() => {
    if (planIdx !== idx) {
      setPlan(null); setVerify(null); setPlanNote(''); setDraftReply(''); setAttachDoc(null);
      // A meeting belongs to ONE person. Carrying "created" across to the next contact would tell
      // the promise audit an invite exists for someone it was never made for.
      setMeetingMade(false); setMeetLink(''); setMeetingGuests(''); setMeetingNote('');
      setFixRound(0); setFixStalled(false);
    }
  }, [idx]); // eslint-disable-line react-hooks/exhaustive-deps

  async function closeBrowserNow() {
    setAgentBrowserHold(false);
    setBrowserOpen(false);
    setOpenNote('');
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('run_browser_persistent', { args: 'close' });
    } catch { /* already gone */ }
  }

  const cur = contacts[idx];
  const channel = campaign.channel || 'linkedin';
  // Someone off a lead list who hasn't accepted yet cannot be messaged on LinkedIn at all, so the
  // card shows the connection-request step instead of a message they'd have no way to send. Once
  // any check (or the user) marks them accepted/sent/replied, they behave like any other contact.
  const needsConnect = !!cur && cur.source === 'leads'
    && !(cur.status === 'accepted' || cur.status === 'sent' || cur.status === 'replied' || cur.status === 'skip');

  // When the parent opens a DIFFERENT campaign object (resume, /verifylinks re-open, a fresh draft),
  // resync the local contacts + jump to the first to-do. The prop reference only changes when
  // setOutreachCampaign is called with a new object — normal auto-saves don't touch it — so this
  // never fights the user's edits, it just refreshes when a genuinely new/updated campaign arrives.
  useEffect(() => {
    const next = campaign.contacts.map((c) => ({ ...c, status: c.status || 'todo' }));
    setContacts(next);
    setIdx(firstUndoneIdx(next));
  }, [campaign]);

  // Auto-save the campaign (with live statuses) whenever it changes.
  useEffect(() => {
    saveCampaign({ ...campaign, contacts });
  }, [contacts]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setCopied(null); }, [idx]);

  const progress = useMemo(() => {
    const by = (s: OutreachStatus) => contacts.filter((c) => c.status === s).length;
    return { sent: by('sent'), accepted: by('accepted'), replied: by('replied'), connect: by('connect'), skip: by('skip') };
  }, [contacts]);

  // Search results: contacts whose name (or company) contains the query — carrying their real index
  // so a click jumps straight there. Capped so a big list stays a short, clickable menu.
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return contacts
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => (c.name || '').toLowerCase().includes(q) || (c.company || '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [search, contacts]);

  function jumpTo(i: number) { setIdx(i); setSearch(''); }

  // ─── Write progress back to the Brain lead list ────────────────────────────────────────────
  // A lead's "Connection Status" cell is the record that survives outside this campaign — it is
  // already protected from being wiped by /verify and /enrich (leadTable.ts LEAD_CANON), so keeping
  // it current is what stops the user re-inviting someone they invited three weeks ago.
  function writeLeadStatus(c: OutreachContact, status: OutreachStatus) {
    if (c.source !== 'leads' || !c.leadList) return;
    const cell = outreachStatusToLeadCell(status);
    if (!cell) return;
    try {
      const node = brain.findByTitle(c.leadList);
      if (!node?.body) return;
      const before = String(node.body);
      const after = setLeadConnStatus(before, c.name, cell);
      if (after !== before) brain.updateNode(node.id, { body: after });
    } catch { /* the campaign is still the source of truth — a failed write-back is not fatal */ }
  }

  /**
   * Correct this person's profile link on the saved lead list too.
   *
   * Fixing it only on the contact fixes it only for THIS campaign: the list in the Brain keeps the
   * wrong link, so the next campaign built from that list makes the same mistake again, and the
   * user has to find the right profile a second time. Returns the list it wrote to, so the UI can
   * say where the correction landed rather than claiming something invisible happened.
   */
  function writeLeadProfileUrl(c: OutreachContact, url: string): string {
    if (c.source !== 'leads' || !c.leadList) return '';
    try {
      const node = brain.findExactByTitle(c.leadList) ?? brain.findByTitle(c.leadList);
      if (!node?.body) return '';
      const before = nodeToMarkdown(String(node.body));
      const after = setLeadProfileUrl(before, c.name, url);
      if (after === before) return '';
      brain.updateNode(node.id, { body: after });
      return node.title;
    } catch { return ''; }
  }

  // ─── Today's meeting → a reminder they will actually get ───────────────────────────────────
  //
  // Reads the real calendar, finds the event that belongs to THIS person, and writes the reminder
  // from the event itself. The time and the day come from the diary, not from a model — which is
  // the whole point, because a reminder with the wrong time is worse than no reminder. The user
  // can still edit it, and it goes through the same verifier as any other draft.
  const [reminderNote, setReminderNote] = useState('');
  const [remindBusy, setRemindBusy] = useState(false);

  /** The calendar entry today that looks like it belongs to this contact. */
  function todaysMeetingFor(calendarText: string, c?: OutreachContact): { title: string; start: Date; end: Date } | null {
    const busy = parseCalendarBusy(calendarText);
    const now = new Date();
    const today = busy.filter((b) => b.start.getFullYear() === now.getFullYear() && b.start.getMonth() === now.getMonth() && b.start.getDate() === now.getDate());
    if (!today.length) return null;
    const first = (c?.name || '').trim().split(/\s+/)[0].toLowerCase();
    // Prefer an event that names them; otherwise, if there is exactly one thing today, that is it.
    const named = first.length > 2 ? today.find((b) => b.title.toLowerCase().includes(first)) : undefined;
    return named || (today.length === 1 ? today[0] : null);
  }

  async function draftMeetingReminder() {
    const c = contacts[idx];
    if (!c) return;
    setRemindBusy(true); setReminderNote('Checking your calendar…');
    try {
      const cal = await fetchCalendarContext(true);
      if (!cal) { setReminderNote("Couldn't read your calendar, so I won't guess at a time. Open Calendar in the adris browser and sign in, then try again."); return; }
      const ev = todaysMeetingFor(cal, c);
      if (!ev) {
        const any = parseCalendarBusy(cal).length;
        setReminderNote(any
          ? `Nothing in today's calendar looks like a meeting with ${c.name || 'them'}. Rename the event to include their name, or write the reminder yourself.`
          : 'Your calendar has nothing today, so there is no meeting to remind them about.');
        return;
      }
      const when = ev.start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      const first = (c.name || '').trim().split(/\s+/)[0] || 'there';
      // Written here, not generated: every fact in it came from the calendar entry above.
      const text = `Hi ${first}, quick reminder that we're on for ${when} today. Looking forward to it. If anything has changed on your side, just say and we'll move it.`;
      setDraftReply(text);
      setLastOwnerCtx((prev) => [prev, cal].filter(Boolean).join('\n\n'));
      setReminderNote(`Reminder ready for "${ev.title}" at ${when} today — review and send.`);
      setFixRound(0); setFixStalled(false);
      void runVerify(text, c, lastThread || `Reminder about ${ev.title}`, cal);
      setTimeout(() => setReminderNote(''), 6000);
    } catch (e) {
      setReminderNote(`Couldn't build the reminder: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
    } finally { setRemindBusy(false); }
  }

  function setStatus(s: OutreachStatus) {
    const c = contacts[idx];
    if (c) writeLeadStatus(c, s);
    setContacts((prev) => prev.map((x, i) => (i === idx
      // Stamp when the request went out so the copilot can say "waiting 6 days" instead of leaving
      // the user counting back through their own memory.
      ? { ...x, status: s, requestedAt: s === 'connect' ? (x.requestedAt || Date.now()) : x.requestedAt }
      : x)));
    // The user asked for this explicitly: the moment someone is marked "Replied", don't just log it
    // — read what they actually said and plan the next move. Auto-runs the scan (if not already done
    // for this person) so the flow never dead-ends at "Replied".
    if (s === 'replied' && !(plan && planIdx === idx)) { scanReplyAndPlan(); }
  }

  /** People we're waiting on — what the "Check all pending" button acts on. */
  const pendingCount = useMemo(
    () => contacts.filter((c) => c.status === 'connect').length,
    [contacts],
  );

  // ─── Did they accept? ───────────────────────────────────────────────────────────────────────
  // Reconciles every pending request in ONE browser pass (see lib/outreachConnections.ts for why
  // that beats visiting each profile). Nothing here calls a model, so it behaves identically on
  // adris.tech, a BYOK key, or a local model — and costs no tokens at all.
  //
  // `only` limits the effect to one person (the per-card button); omitted, it does the whole list.
  async function runConnectionCheck(only?: number) {
    if (checking) return;
    setChecking(true);
    setCheckNote('Checking LinkedIn…');
    try {
      setAgentBrowserHold(true); setBrowserOpen(true);
      const report = await checkPendingConnections(contacts, runBrowserCmd);
      if (report.signIn) {
        setCheckNote('Sign in to LinkedIn in the ADRIS browser window, then press Check again.');
        return;
      }
      if (!report.connectionsOk) {
        // Deliberately explicit: nothing was changed. Silently "finding no updates" after a failed
        // read would look identical to "nobody accepted", and the user would stop trusting it.
        // Say WHY. checkPendingConnections has carried the real reason all along and it was thrown
        // away here, so every distinct failure — Chrome not starting, the page not loading, the
        // window being busy — read as the same shrug and there was nothing to act on or report.
        const why = (report.error || '').replace(/\s+/g, ' ').trim();
        const hint = /browser-crash|not installed/i.test(why) ? ' The ADRIS browser could not start — check Google Chrome is installed.'
          : /timed out|timeout/i.test(why) ? ' LinkedIn took too long to load. Press Check again — a second pass usually gets it.'
          : /custom-browser-unavailable|busy/i.test(why) ? ' The browser window is busy with another job — let it finish, then press Check again.'
          : ' Press Check again in a moment.';
        setCheckNote(`Couldn't read your connections, so nothing was changed.${hint}${why ? ` (${why.slice(0, 120)})` : ''}`);
        return;
      }
      const results: ReconcileResult[] = only === undefined
        ? report.results
        : report.results.filter((r) => r.index === only);

      const accepted = results.filter((r) => r.outcome === 'accepted');
      const gone = results.filter((r) => r.outcome === 'gone');
      const stillPending = results.filter((r) => r.outcome === 'pending');

      if (results.length) {
        setContacts((prev) => prev.map((c, i) => {
          const r = results.find((x) => x.index === i);
          if (!r) return c;
          if (r.outcome === 'accepted') {
            return { ...c, status: 'accepted', acceptedAt: c.acceptedAt || Date.now(), linkedin_url: c.linkedin_url || r.url };
          }
          // An expired or declined invite goes back to To do — it is genuinely actionable again,
          // and leaving it as "requested" forever is exactly the state the user said they lose
          // track of. Their note is kept so re-sending is one tap.
          if (r.outcome === 'gone') return { ...c, status: 'todo', requestedAt: undefined, sentAgo: undefined };
          // LinkedIn's own "1 week ago" is better than our stamp, and it is the ONLY age we have
          // for requests the user sent by hand outside this app.
          if (r.outcome === 'pending' && r.sentAgo) return { ...c, sentAgo: r.sentAgo, linkedin_url: c.linkedin_url || r.url };
          return c;
        }));
        accepted.forEach((r) => { const c = contacts[r.index]; if (c) writeLeadStatus(c, 'accepted'); });
      }

      const bits: string[] = [];
      if (accepted.length) bits.push(`${accepted.length} accepted`);
      if (stillPending.length) bits.push(`${stillPending.length} still pending`);
      if (gone.length) bits.push(`${gone.length} expired or declined — back on your To do list`);
      if (!report.pendingOk && !accepted.length) {
        setCheckNote("Read your connections but couldn't open the sent-invitations page, so only acceptances were checked.");
      } else {
        setCheckNote(bits.length ? bits.join(' · ') : 'No changes — nobody has accepted yet.');
      }

      // The user's ask: once someone accepts, write their real message WITHOUT being told to.
      if (accepted.length) void draftMessagesForAccepted(accepted.map((r) => r.index));
    } catch (e) {
      setCheckNote('Check failed: ' + String(e).slice(0, 140));
    } finally {
      setAgentBrowserHold(false);
      setChecking(false);
    }
  }

  /**
   * Write the real, personalised LinkedIn message for people who just accepted.
   *
   * Uses refineMessage() — the same source-aware path the rest of the copilot uses (it resolves to
   * the user's chosen BYOK key, local model, or adris.tech), so this adds no new assumption about
   * where AI runs. Grounded in the owner context so the message is as personalised as the ones
   * written for existing connections, which is what the user asked for.
   */
  async function draftMessagesForAccepted(indexes: number[]) {
    const ownerContext = lastOwnerCtx || buildOwnerContext();
    for (const i of indexes) {
      const c = contacts[i];
      if (!c || c.linkedin_message?.trim()) continue;   // never overwrite something already written
      try {
        const text = await refineMessage({
          person: [c.name, c.company].filter(Boolean).join(' — '),
          current: c.connect_note || '',
          instruction:
            `${c.name} has just ACCEPTED my connection request. Write the FIRST direct message to send them now — `
            + '30–50 words, warm and specific, referencing what they do. Thank them briefly for connecting, then ONE '
            + 'low-pressure, specific opener. No pitch, no buzzwords, no placeholders. '
            // Nothing on this path has read the user's calendar, so anything it says about their
            // availability is invented — and it is a promise made in their name about their own
            // diary. Ask for a time instead of asserting one.
            + 'NEVER say when I am free and never propose a specific day, date or time window — you have not seen my '
            + 'calendar. Ask what suits them instead. Do not invent a duration, timezone or meeting link.',
          ownerContext,
          aiCall,   // the Krew chat's AI source (BYOK/local/adris) — never a separate global one
        });
        const msg = (text || '').trim();
        if (msg) setContacts((prev) => prev.map((x, j) => (j === i && !x.linkedin_message?.trim() ? { ...x, linkedin_message: msg } : x)));
      } catch { /* leave it blank — the card still works, the user can ask for a draft */ }
    }
  }

  // ── Read this person's real thread and prepare the next message, then verify it ──
  // mode 'reply' = they replied, plan the response. mode 'followup' = they read it but never replied,
  // draft a re-engagement nudge. Reads the live LinkedIn thread (never a guess), runs the strategist,
  // then the independent verifier. The user reviews and sends themselves — this only ever prepares.
  async function scanReplyAndPlan(mode: 'reply' | 'followup' = 'reply') {
    const contact = contacts[idx];
    if (!contact) return;
    setPlanning(true);
    setPlan(null); setVerify(null); setPlanNote('Reading their reply…'); setPlanIdx(idx);
    setFixRound(0); setFixStalled(false);   // a brand-new draft gets a brand-new fix allowance
    let thread = '';
    // Whatever comes back, it is not always a thread. These are the outcomes that are NOT
    // "they never replied" — each needs a different thing from the user.
    let browserBlocked = '';
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      setAgentBrowserHold(true); setBrowserOpen(true);

      // EMAIL CONTACTS read their Gmail conversation instead. Everything after this point — the
      // strategist, the verifier, the draft box, the slot suggestions — works on plain thread text
      // and never cared which channel it came from, so this is the only branch needed. Looking for
      // a LinkedIn chat with someone who was emailed could only ever come back empty.
      if (contactChannel(contact) === 'email' && contact.email) {
        setPlanNote('Reading your email conversation…');
        const gm = await invoke<string>('run_browser_persistent', { args: `gmailthread ${contact.email}` }).catch((e) => String(e));
        if (gm.includes('SIGN_IN_REQUIRED') || gm.includes('[NEEDS_LOGIN]')) {
          setPlanNote('Sign in to Gmail in the ADRIS browser window, then click "Scan their reply" again.');
          setPlanning(false); await refocusAppToPlan(); return;
        }
        const gj = gm.indexOf('GMAIL_JSON:');
        if (gj >= 0) {
          try {
            const obj = JSON.parse(gm.slice(gj + 'GMAIL_JSON:'.length).trim()) as { subject?: string; messages?: Array<{ isYou?: boolean; text?: string }> };
            if (obj.messages?.length) {
              thread = (obj.subject ? `SUBJECT: ${obj.subject}\n` : '')
                + obj.messages.map((m) => `${m.isYou ? 'YOU' : (contact.name || 'THEM')}: ${m.text || ''}`).join('\n');
            }
          } catch { /* fall through to the paste box */ }
        }
      }

      // Open ONLY this person's chat and read it — no whole-inbox scan. We need their profile URL;
      // if we don't have it yet, find it once by name and save it for next time.
      let targetUrl = thread.trim()
        ? ''   // already have the conversation from Gmail — no reason to touch LinkedIn at all
        : (contact.linkedin_url && /linkedin\.com\/in\//i.test(contact.linkedin_url) ? contact.linkedin_url : '');
      // SEND-ONLY CHANNELS. There is no way to read an X or Instagram inbox from here, and hunting
      // LinkedIn for someone who only has an Instagram handle finds either nobody or the wrong
      // person. Say so and take the pasted thread instead — a plan built from their real words is
      // the point, and it works identically once the words are in front of it.
      const only = allChannels(contact);
      if (!thread.trim() && only.length && !only.includes('linkedin') && !only.includes('email')) {
        const where = CHANNEL_LABEL[only[0]];
        setPlanNote(`I can't read ${where} messages, so paste their reply below and I'll plan the response and draft it.`);
        setPlan({ intent: 'unclear', read: `Paste ${contact.name || 'their'} ${where} reply here and I'll draft your response.`, draftReply: '', attachSuggested: false });
        setPlanning(false); await refocusAppToPlan(); return;
      }
      if (!targetUrl && !thread.trim() && contactChannel(contact) !== 'email') {
        setPlanNote('Finding their profile…');
        try {
          const fp = await invoke<string>('run_browser_persistent', { args: `findprofile "${(contact.name || '').replace(/["\n\r]/g, ' ').trim()}" ::: ${profileFilter(contact)}` });
          if (fp.includes('SIGN_IN_REQUIRED') || fp.includes('[NEEDS_LOGIN]')) {
            setPlanNote('Sign in to LinkedIn in the ADRIS browser window, then click "Scan their reply" again.');
            setPlanning(false); await refocusAppToPlan(); return;
          }
          const pj = fp.indexOf('PROFILE_JSON:');
          if (pj >= 0) { const arr = JSON.parse(fp.slice(pj + 'PROFILE_JSON:'.length).trim()); targetUrl = bestProfileUrl(Array.isArray(arr) ? arr : [], contact.name); }
        } catch { /* fall through to the paste box */ }
        if (targetUrl) setContacts((prev) => prev.map((c, i) => (i === idx ? { ...c, linkedin_url: targetUrl } : c)));
      }

      if (targetUrl) {
        setPlanNote('Reading their reply…');
        // RETRY ONCE. The chat overlay is loaded asynchronously by LinkedIn, and on a cold window
        // it sometimes has no message nodes yet when we look — the reader then returns
        // READTHREAD_EMPTY and the user was sent to the "paste it yourself" box for a thread that
        // was sitting right there. Clicking the button again always worked, which is the whole
        // proof that a second attempt is all it needs. So do that second attempt here instead of
        // making the user discover it.
        for (let attempt = 0; attempt < 2 && !thread.trim(); attempt++) {
          if (attempt) {
            setPlanNote('Their chat was still loading — reading it again…');
            await new Promise((r) => setTimeout(r, 1500));
          }
          const raw = await invoke<string>('run_browser_persistent', { args: `readthread ${targetUrl}` }).catch((e) => String(e));
          if (raw.includes('SIGN_IN_REQUIRED') || raw.includes('[NEEDS_LOGIN]')) {
            setPlanNote('Sign in to LinkedIn in the ADRIS browser window, then click "Scan their reply" again.');
            setPlanning(false); await refocusAppToPlan(); return;
          }
          // LinkedIn is asking the USER to prove they are human. Nothing about the inbox is known
          // yet, so saying "no reply found" would be inventing an answer.
          if (raw.includes('HUMAN_CHECK_REQUIRED')) {
            setPlanNote('LinkedIn needs you to confirm this sign-in. Look at the ADRIS browser window — it may be waiting for you to tap Yes in the LinkedIn app on your phone (the page looks blank while it waits). Then click "Scan their reply" again; nothing is lost.');
            setPlanning(false); await refocusAppToPlan(); return;
          }
          // The browser never finished. Also not evidence about their inbox.
          if (/\[(browser-timeout|browser-crash|custom-browser-unavailable)\]/.test(raw)) {
            browserBlocked = raw.includes('browser-crash')
              ? 'The ADRIS browser could not start — check that Google Chrome is installed, then try again.'
              : 'The ADRIS browser did not finish reading the page in time. LinkedIn may be waiting for you to confirm the sign-in — look at the ADRIS window (it can look blank while it waits for you to tap Yes in the LinkedIn app), then try again.';
            break;
          }
          const tj = raw.indexOf('THREAD_JSON:');
          if (tj >= 0) {
            try {
              const obj = JSON.parse(raw.slice(tj + 'THREAD_JSON:'.length).trim()) as { messages?: Array<{ isYou?: boolean; text?: string }>; seen?: string };
              if (obj.messages?.length) {
                thread = obj.messages.map((m) => `${m.isYou ? 'YOU' : (contact.name || 'THEM')}: ${m.text || ''}`).join('\n');
                // LinkedIn's read receipt, when present — "Seen by X at 10:54 AM" means the last
                // message landed and was opened, which a follow-up must not contradict.
                if (obj.seen) thread += `\n[read receipt: ${obj.seen}]`;
              }
            } catch { /* fall through to another attempt, then the manual paste */ }
          }
          // Anything other than "opened it but saw no messages yet" is not worth a second go —
          // a missing chat box or a hard error will fail the same way twice.
          if (!thread.trim() && !/READTHREAD_EMPTY/.test(raw)) break;
        }
      }
    } catch { /* browser optional — fall back to a manual paste */ }

    if (!thread.trim()) {
      // NEVER report on an inbox we failed to open. "Couldn't find a recent reply from X" is a
      // statement about their inbox, and it was being printed when the browser had timed out, been
      // abandoned mid-command, or hit a security check — i.e. when nothing whatsoever was known
      // about whether they replied. That is the difference between "they haven't replied" and "I
      // couldn't look", and the user acted on the wrong one.
      if (browserBlocked) {
        setPlanNote(browserBlocked);
        setPlanning(false);
        setPlan({ intent: 'unclear', read: `I couldn't read your thread with ${contact.name || 'them'} — that is a browser problem, not a sign they didn't reply. Fix the above and try again, or paste the messages here.`, draftReply: '', attachSuggested: false });
        await refocusAppToPlan();
        return;
      }
      // The person wasn't in the recent inbox (older thread, or they never replied). Say so plainly
      // and let the user paste the thread — the plan panel still appears.
      setPlanNote(mode === 'followup'
        ? `Couldn't read your past thread with ${contact.name || 'them'} automatically. Paste the last message(s) below and I'll draft a follow-up.`
        : contactChannel(contact) === 'email'
          ? `Couldn't find an email conversation with ${contact.name || 'them'}${contact.email ? ` (${contact.email})` : ''}. If they DID reply, paste it below and I'll draft your response; otherwise there's nothing to reply to yet.`
          : `Couldn't find a recent reply from ${contact.name || 'them'} in your inbox. If they DID reply, paste it below and I'll draft your response; otherwise there's nothing to reply to yet.`);
      setPlanning(false);
      setPlan({ intent: 'unclear', read: `Paste your thread with ${contact.name || 'them'} here and I'll ${mode === 'followup' ? 'draft a follow-up' : 'plan your response'}.`, draftReply: '', attachSuggested: false });
      await refocusAppToPlan();
      return;
    }

    // Only involve the calendar when the thread is actually about timing (a call, a meeting, "when
    // are you free", a day/time) — so an ordinary reply doesn't open Calendar in the browser.
    const schedulingLikely = /\b(call|meet(ing)?|schedule|available|availability|free|calendar|catch up|hop on|zoom|google meet|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d\s?(am|pm)|\d{1,2}[:.]\d{2})\b/i.test(thread);
    setStage(mode === 'followup' ? 'Reading the thread & drafting a follow-up' : (schedulingLikely ? 'Checking your calendar & planning the next move' : 'Planning the next move'));
    // Read the real calendar first (when timing is in play) so the plan and the verifier both know
    // what the owner is actually doing before proposing or confirming any time.
    const calendar = await fetchCalendarContext(schedulingLikely);
    let ownerContext = [buildOwnerContext(), calendar].filter(Boolean).join('\n\n');
    setLastThread(thread); setLastOwnerCtx(ownerContext);   // remember for refine / re-verify
    try {
      const args = { person: contact.name || 'them', company: contact.company, thread, ownerContext, availableDocs: docs.map((d) => ({ title: d.title, kind: d.kind, summary: d.summary })), aiCall };
      let p = mode === 'followup' ? await planFollowUp(args) : await planReply(args);
      // The gate above looks at THEIR message, but the draft can propose a time even when the thread
      // never mentioned one ("would you be free tomorrow at 11:30?"). That is precisely when the
      // calendar matters, and it was the case where it silently never opened. Read it now and verify
      // against it, rather than vetting a proposed slot with no idea what the owner is doing.
      if (!calendar && p.draftReply && proposesATime(p.draftReply)) {
        setStage('Draft proposes a time, checking your calendar');
        const late = await fetchCalendarContext(true);
        if (late) {
          ownerContext = [ownerContext, late].filter(Boolean).join('\n\n');
          setLastOwnerCtx(ownerContext);
          // RE-PLAN, don't just hand the calendar to the verifier.
          //
          // The draft above was written with NO idea what the owner was doing, so its times are
          // guesses. Previously the late calendar was only used to check them — which relies on
          // the verifier being sharp enough to catch the clash, and on a free key it is not. That
          // is how "today at 2:00 PM" reached the user on a day that already had a meeting.
          // Now the clash is detected deterministically first, and only a draft that actually
          // conflicts is redrafted, so a good draft is never thrown away.
          if (auditScheduling(p.draftReply, late).length) {
            setStage('That time clashes with your calendar, picking another');
            const better = await planReply({ ...args, ownerContext }).catch(() => null);
            if (better?.draftReply && !better.degraded && !auditScheduling(better.draftReply, late).length) p = better;
          }
        }
      }
      setPlan(p);
      setDraftReply(p.draftReply || '');
      // Stop the elapsed ticker BEFORE writing the result, or its next repaint (within a second)
      // would overwrite "✓ your draft is ready" with a stale "planning… · 96s".
      stageRef.current = '';
      // Point the user to where the draft now is, so the flow never dead-ends silently.
      setPlanNote(p.degraded ? p.read : (mode === 'followup' ? '✓ Follow-up drafted below — review & send.' : '✓ Read their reply — your draft is ready below to review & send.'));
      setTimeout(() => setPlanNote((n) => (n.startsWith('✓ ') ? '' : n)), 4000);
      // If the plan suggests attaching something, pre-select the best-matching generated doc —
      // or none, when nothing on file actually matches. See pickAttachment: silently attaching
      // "the most recent file" is how an internal spreadsheet ends up pointed at a prospect.
      if (p.attachSuggested && docs.length) {
        setAttachDoc(pickAttachment(docs, p.attachHint || '', `${contact.name || ''} ${contact.company || ''}\n${thread}`));
      }
      // Verify the drafted reply straight away, so the user sees a vetted draft rather than raw output.
      // Pass the same calendar context so the verifier can catch a clashing meeting time.
      if (p.draftReply && !p.degraded) runVerify(p.draftReply, contact, thread, ownerContext);
      await refocusAppToPlan();
    } catch {
      stageRef.current = '';   // same reason as above: don't let the ticker repaint over this
      setPlanNote('Could not plan the reply. Read the thread and respond yourself.');
      await refocusAppToPlan();
    } finally {
      setPlanning(false);
    }
  }

  // Independent verification pass on a drafted reply — the second agent that checks the first
  // agent's work before the human commits to it. Never blocks; only informs. `ownerCtx` carries the
  // owner's real calendar/availability so the verifier can catch a clashing meeting time.
  async function runVerify(text: string, contact: OutreachContact, thread: string, ownerCtx = ''): Promise<VerifyResult | null> {
    if (!text.trim()) return null;
    setVerifying(true); setVerify(null);
    try {
      const v = await verifyWork({
        kind: 'outreach-reply',
        task: `Reply to ${contact.name || 'a prospect'}${contact.company ? ` at ${contact.company}` : ''} on LinkedIn, moving the conversation forward without over-promising.`,
        artifact: text,
        // The blocks inside ownerCtx label themselves — a live calendar read says so, saved notes say
        // they are notes. Calling the whole blob "the owner's real calendar" is what turned an old
        // notebook line into a "confirmed meeting" the verifier rejected a good time against.
        context: `The conversation so far:\n${thread}${ownerCtx ? `\n\nWHAT WE KNOW ABOUT THE OWNER (read each block's own label — only a live calendar read is authoritative):\n${ownerCtx}` : '\n\n(No calendar was read for this draft — you cannot know the owner is busy. Do not invent a clash.)'}`,
        checklist: [
          'If the prospect asked a direct question, the reply ANSWERS it concretely in the first two sentences. A promise to explain, an offer of a call/document, or a counter-question instead of an answer is a FAIL.',
          'Every concrete example or benefit named in the reply fits THIS prospect\'s actual line of work. An example from an unrelated industry is a FAIL.',
          'The reply directly addresses what the prospect actually said, not a generic script.',
          'If the prospect already replied, the message does not treat them as if they ignored it ("just following up on my previous message").',
          'No invented facts, features, prices, or commitments.',
          'The message does not claim to be attaching, sending or "finally" sharing anything that the conversation above shows was ALREADY sent — and does not apologise for an oversight that never happened. Claiming to attach a file the prospect has already opened is a FAIL.',
          'It states nothing about the CONTENTS of an attached document — no slide numbers, page numbers, section names or figures — unless those details appear in the conversation or the owner context above. Invented document detail is a FAIL.',
          'It does not jump straight to "book a call" if the prospect only asked to know more — it gives substance first.',
          'Any proposed or confirmed meeting time does NOT clash with a LIVE CALENDAR read shown above, including a nearby event that could run over into it — flag it to confirm if unsure. Only a block that says it is a live calendar read counts: never raise a clash against a saved note, and never against an event whose date is already in the past.',
          'The message contains no placeholders like [Time], [Product Name], or [Company] — every detail is concrete.',
        ],
        aiCall,   // use the Krew chat's AI source (BYOK/local/adris) — never a separate global one
      });
      // Guard: never offer a "revised" version that swapped a real detail for a placeholder — that
      // is the exact regression the user hit ("[Time]", "[Tech/Product Name]"). Drop it if so.
      if (v.revised && /\[[^\]]{2,40}\]|<[^>]{2,40}>|\bXYZ\b/i.test(v.revised)) {
        v.revised = undefined;
        v.issues = [{ severity: 'medium', issue: 'A rewrite was discarded because it introduced placeholders. Edit the draft yourself where needed.' }, ...v.issues];
      }
      // Pass the owner context so the scheduling audit can see the LIVE calendar block inside it.
      const finalV = applyPromiseAudit(v, text, outwardState(), ownerCtx);
      setVerify(finalV);
      return finalV;
    } catch {
      // Even when the model-driven verifier fails outright, the deterministic audit still runs —
      // it needs no network and cannot time out. That matters most on a small free-tier key, which
      // is precisely where the verifier returns something unreadable AND the draft over-promises.
      const forced = applyPromiseAudit(
        { verdict: 'warn', summary: 'The draft was not checked by the verifier.', issues: [], degraded: true },
        text, outwardState(), ownerCtx,
      );
      const out = forced.verdict === 'fail' ? forced : null;
      setVerify(out);
      return out;
    } finally { setVerifying(false); }
  }

  /**
   * What has ACTUALLY happened for the contact on screen, for the promise audit to check the draft
   * against. All false until `createMeeting` below has genuinely run — which is exactly why a draft
   * claiming "I've sent the invite" must be caught rather than trusted.
   */
  function outwardState() {
    return {
      calendarCreated: !!meetingMade,
      meetLink: meetLink || undefined,
      guestsInvited: !!meetingGuests,
      attachmentReady: !!attachDoc,
    };
  }

  /**
   * Actually create the meeting the reply is about.
   *
   * The copilot could read a calendar and print "Meeting: Friday 6 PM", but it could not book one —
   * so the only way a meeting ever got made was for the user to notice and go do it themselves,
   * while the drafted reply happily said an invite had been sent. Two routes, best first:
   *
   *   Google connected  → gcal_create_event. A REAL event; with the prospect's email on it Google
   *                       sends them a genuine invitation. This is the one that makes the sentence
   *                       "I've sent you the calendar invite" true.
   *   otherwise         → create_calendar_event, which prefills Google Calendar in the ADRIS browser
   *                       for the user to press Save. Honest about needing that press.
   *
   * The time is parsed deterministically (parseMeetingTime); if it cannot be read with certainty
   * nothing is booked and the user is asked, because a meeting on the wrong day is worse than none.
   */
  async function createMeeting() {
    const cur = contacts[idx];
    if (!cur || meetingBusy) return;
    const raw = plan?.meeting?.proposedTime || plan?.meeting?.note || draftReply;
    const when = parseMeetingTime(raw);
    if (!when) {
      setMeetingNote("I couldn't read a definite date and time from this thread. Put the day and time in the reply (e.g. \"Friday 31 July at 1 PM\") and press this again — I won't book a guess.");
      return;
    }
    setMeetingBusy(true); setMeetingNote('');
    const title = cur.name ? `Call with ${cur.name}` : 'Intro call';
    const guest = (cur.email || '').trim();
    try {
      const { executeTool } = await import('../../lib/krewTools');
      const noApproval = async () => true;
      if (googleToken) {
        // A real event on the real calendar. Local wall-clock + the zone Google resolves from the
        // calendar; the parser already normalised the time.
        const startIso = `${when.date}T${when.time}:00`;
        const endMins = parseInt(when.time.slice(0, 2), 10) * 60 + parseInt(when.time.slice(3), 10) + 30;
        const endIso = `${when.date}T${String(Math.floor(endMins / 60) % 24).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}:00`;
        const res = await executeTool('gcal_create_event', {
          summary: title, start: startIso, end: endIso,
          description: `Agreed on LinkedIn with ${cur.name}.`,
          attendees: guest,
        }, {} as never, noApproval, 'boss', '', 'copilot-cal');
        if (/did NOT approve/i.test(res)) { setMeetingNote('Cancelled — nothing was created.'); return; }
        if (/"error"/i.test(res)) { setMeetingNote(`Google refused to create it: ${res.slice(0, 160)}`); return; }
        const link = res.match(/https:\/\/meet\.google\.com\/[a-z-]+/i)?.[0] ?? '';
        setMeetingMade(true); setMeetLink(link); setMeetingGuests(guest);
        setMeetingNote(`Created: ${title} on ${when.spelled} at ${when.time}.${guest ? ` ${guest} has been sent a real invitation.` : ' No email saved for them, so nobody was invited — add their email and they will get one.'}`);
      } else {
        const res = await executeTool('create_calendar_event', {
          title, date: when.date, start_time: when.time, timezone: when.timezone,
          duration_minutes: 30,
          details: `Agreed on LinkedIn with ${cur.name}.`,
          guests: guest,
        }, {} as never, noApproval, 'boss', '', 'copilot-cal');
        const link = res.match(/https:\/\/meet\.google\.com\/[a-z-]+/i)?.[0] ?? '';
        if (/Couldn't open the browser/i.test(res)) { setMeetingNote(res.slice(0, 240)); return; }
        // NOT booked yet — the template URL needs a Save press. Say so, and leave calendarCreated
        // false so the audit still challenges a draft claiming the invite went out.
        setMeetLink(link); setMeetingGuests(guest);
        setMeetingNote(`Google Calendar is open with "${title}" on ${when.spelled} at ${when.time} filled in — press **Save** in that window and it is booked.${guest ? ` ${guest} is on it and will be emailed once you save.` : ' Nobody is invited to it — add their email in that window if they should be.'}`);
      }
    } catch (e) {
      setMeetingNote(`Couldn't create the meeting: ${String(e).slice(0, 200)}`);
    } finally {
      setMeetingBusy(false);
      // Re-check the draft against what is now true — a promise that was false a moment ago may be
      // honest now, and vice versa.
      if (draftReply) setVerify((v) => (v ? applyPromiseAudit({ ...v, verdict: 'warn', issues: v.issues.filter((i) => !/did not actually happen|calendar invite was sent|no guest email/i.test(i.issue)) }, draftReply, outwardState(), lastOwnerCtx) : v));
    }
  }

  /**
   * Refine THE OUTREACH MESSAGE for the person on screen, from a plain-English instruction.
   *
   * refineMessage() has existed for a while, but it was only ever wired to the REPLY draft — the
   * panel that appears after "Scan their reply". The message you are actually about to send had no
   * way to be improved at all: you either accepted what was drafted, retyped it yourself, or went
   * back to Krew chat and ran /refine over EVERY untouched contact just to fix one. That is why it
   * looked missing from the copilot — the capability was there, the button was not.
   *
   * Writes straight onto the contact, so the auto-save effect persists it exactly like a manual
   * edit does.
   */
  const [msgRefineInput, setMsgRefineInput] = useState('');
  const [msgRefining, setMsgRefining] = useState(false);
  const [msgRefineNote, setMsgRefineNote] = useState('');
  const [msgUndo, setMsgUndo] = useState<string | null>(null);

  /**
   * Check THIS person's saved profile, and correct it if it belongs to somebody else.
   *
   * Lead searches get profiles wrong — a namesake, or a confident guess — and the only fix was to
   * re-run a whole-list pass from the chat. That is minutes of browser work to check one row, so in
   * practice nobody did it and wrong links stayed on the list until they messaged a stranger.
   *
   * Searches LinkedIn for the person by name plus their company, takes the best match, and compares
   * it to what is saved. A mismatch is REPLACED, and the correction is written back to the lead
   * list too, so the next campaign built from that list does not repeat it. When nothing can be
   * confirmed the saved link is left alone and said so — a blank guess is not an improvement.
   */
  const [profVerifying, setProfVerifying] = useState(false);
  const [verifyProfileNote, setVerifyProfileNote] = useState('');

  async function verifyThisProfile() {
    if (!cur || profVerifying) return;
    const name = (cur.name || '').trim();
    if (!name) { setVerifyProfileNote('This contact has no name, so there is nothing to search for.'); return; }
    setProfVerifying(true);
    setVerifyProfileNote('Opening LinkedIn and searching for them…');
    setAgentBrowserHold(true);
    setBrowserOpen(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const raw = await invoke<string>('run_browser_persistent', {
        args: `findprofile "${name.replace(/["\n\r]/g, ' ')}" ::: ${profileFilter(cur)}`,
      });
      if (raw.includes('SIGN_IN_REQUIRED') || raw.includes('[NEEDS_LOGIN]')) {
        setVerifyProfileNote('Sign in to LinkedIn in the ADRIS browser window, then press Verify again.');
        return;
      }
      if (raw.includes('HUMAN_CHECK_REQUIRED')) {
        setVerifyProfileNote('LinkedIn is asking you to confirm the sign-in — check the ADRIS window (it may be waiting for you to tap Yes in the app), then press Verify again.');
        return;
      }
      const pj = raw.indexOf('PROFILE_JSON:');
      if (pj < 0) { setVerifyProfileNote("Couldn't read the search results. Try again in a moment."); return; }
      const arr = JSON.parse(raw.slice(pj + 'PROFILE_JSON:'.length).trim());
      const found = bestProfileUrl(Array.isArray(arr) ? arr : [], name);
      const saved = normaliseLinkedInUrl(cur.linkedin_url || '');
      if (!found) {
        setVerifyProfileNote(saved
          ? `No confident match for ${name}${cur.company ? ` at ${cur.company}` : ''}. The saved link is UNVERIFIED — check it yourself before messaging them.`
          : `No confident match for ${name}. Nothing saved, so paste their profile above if you find it.`);
        return;
      }
      const clean = normaliseLinkedInUrl(found) || found;
      if (saved && clean === saved) {
        setVerifyProfileNote(`✓ Verified — this really is ${name}${cur.company ? ` at ${cur.company}` : ''}.`);
        return;
      }
      // Different person, or nothing saved before: take the confirmed one.
      setContacts((prev) => prev.map((c, i) => (i === idx ? { ...c, linkedin_url: clean } : c)));
      setLiDraft(clean);
      const listTitle = writeLeadProfileUrl(cur, clean);
      setVerifyProfileNote(saved
        ? `Corrected — the saved link was somebody else. Now pointing at the confirmed profile.${listTitle ? ` Fixed on your "${listTitle}" list too.` : ''}`
        : `Found and saved their profile.${listTitle ? ` Added to your "${listTitle}" list too.` : ''}`);
    } catch (e) {
      setVerifyProfileNote(`Couldn't check that profile: ${(e instanceof Error ? e.message : String(e)).slice(0, 140)}`);
    } finally {
      setProfVerifying(false);
      setAgentBrowserHold(false);
      setBrowserOpen(false);
    }
  }

  async function refineOutreachMessage(instructionRaw: string) {
    const instruction = instructionRaw.trim();
    const current = (cur?.linkedin_message || '').trim();
    if (!instruction || !cur) return;
    if (!current) { setMsgRefineNote('There is no message to improve yet — type one first, or let Krew draft it.'); return; }
    setMsgRefining(true); setMsgRefineNote('');
    try {
      const next = await refineMessage({
        current,
        instruction,
        person: cur.name,
        // Their headline is the only context that makes a first message personal; there is no
        // thread yet, which is exactly what distinguishes this from refining a reply.
        thread: cur.company ? `${cur.name || 'They'} — ${cur.company}` : '',
        ownerContext: buildOwnerContext(),
        aiCall,
      });
      if (next && next.trim() && next.trim() !== current) {
        setMsgUndo(current);                       // one-press way back, in case it made it worse
        const fixed = next.trim();
        setContacts((prev) => prev.map((c, i) => (i === idx ? { ...c, linkedin_message: fixed } : c)));
        setMsgRefineInput('');
        setMsgRefineNote('');
      } else if (next && next.trim() === current) {
        setMsgRefineNote('The AI returned the same message — try being more specific about what to change.');
      } else {
        setMsgRefineNote('The AI returned nothing. Try rephrasing, or check the model on your key.');
      }
    } catch (e) {
      setMsgRefineNote(`Couldn't refine: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
    } finally { setMsgRefining(false); }
  }

  // Reshape the current draft from a plain-English instruction the user types ("say yes to the call
  // and suggest tomorrow", "make it shorter", "sound less salesy"), then re-verify the new draft.
  async function refineDraft() {
    const instruction = refineInput.trim();
    if (!instruction || !draftReply.trim()) return;
    setRefining(true); setRefineNote('');
    try {
      const next = await refineMessage({
        current: draftReply,
        instruction,
        person: cur?.name,
        thread: lastThread,
        ownerContext: lastOwnerCtx,
        aiCall,
      });
      if (next && next.trim()) {
        setDraftReply(next.trim());
        setRefineInput('');
        setVerify(null);
        runVerify(next.trim(), cur, lastThread || (plan?.read ?? ''), lastOwnerCtx);
      } else {
        // Don't fail silently — that was the "I clicked Redo and nothing happened" bug.
        setRefineNote('The AI returned an empty result. Try rephrasing your instruction, or check your key.');
      }
    } catch (e) {
      setRefineNote(`Couldn't refine: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
    } finally { setRefining(false); }
  }

  // Attach an EXISTING file from the user's computer (they may already have the deck/PDF), instead of
  // making Krew generate one. Opens a native picker filtered to professional docs, then selects it.
  async function pickFromComputer() {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const path = await invoke<string>('pick_attachment');
      if (path && isAttachableFile(path)) {
        const name = path.split(/[\\/]/).pop() || 'file';
        const doc: GeneratedDoc = { id: `local-${Date.now()}`, title: name, filename: name, path, kind: (name.split('.').pop() || '').toLowerCase(), summary: 'From your computer', createdAt: Date.now() };
        setDocs((prev) => [doc, ...prev.filter((d) => d.path.toLowerCase() !== path.toLowerCase())]);
        setAttachDoc(doc);
      }
    } catch { /* picker cancelled or unavailable */ }
  }

  // Type the (reviewed) reply into this person's LinkedIn chat for the user to send. Reuses the same
  // trusted typemsg path as the outreach send — nothing auto-sends.
  async function sendDraftReply() {
    const contact = contacts[idx];
    const text = draftReply.trim();
    if (!text || !contact) return;
    setOpenNote(''); setOpening(true);
    setAgentBrowserHold(true); setBrowserOpen(true);
    await copyText(text);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      let targetUrl = contact.linkedin_url && /linkedin\.com\/in\//i.test(contact.linkedin_url) ? contact.linkedin_url : '';
      if (!targetUrl) {
        try {
          const raw = await invoke<string>('run_browser_persistent', { args: `findprofile "${(contact.name || '').replace(/["\n\r]/g, ' ').trim()}" ::: ${profileFilter(contact)}` });
          const pj = raw.indexOf('PROFILE_JSON:');
          if (pj >= 0) { const arr = JSON.parse(raw.slice(pj + 'PROFILE_JSON:'.length).trim()); targetUrl = bestProfileUrl(Array.isArray(arr) ? arr : [], contact.name); }
        } catch { /* fall through */ }
      }
      if (!targetUrl) { setOpenNote('Their reply is copied — open their chat and paste it (Ctrl+V).'); setOpening(false); return; }
      const res = await invoke<string>('run_browser_persistent', { args: `typemsg ${targetUrl} ::: ${text}` });
      if (typeof res === 'string' && res.includes('MESSAGE_DRAFTED')) setOpenNote('Typed your reply into their chat — review it and press Enter/Send.' + (attachDoc ? ` Attach ${attachDoc.filename} using LinkedIn's paperclip before sending.` : ''));
      else setOpenNote('Their reply is copied — click Message and paste (Ctrl+V).' + (attachDoc ? ` Attach ${attachDoc.filename} before sending.` : ''));
    } catch {
      setOpenNote('Their reply is copied — open their chat and paste it.');
    } finally { setOpening(false); }
  }

  // Open the folder holding the file to attach, so the user can drag/attach it into the LinkedIn or
  // Gmail compose box (neither lets us attach programmatically from here). Opening the parent folder
  // (not the file) avoids launching the PDF in a viewer when they just want to grab it.
  async function revealAttachment(d: GeneratedDoc) {
    const folder = d.path.replace(/[\\/][^\\/]*$/, '') || d.path;
    try { const { invoke } = await import('@tauri-apps/api/core'); await invoke('open_path', { path: folder }); }
    catch { try { const { open } = await import('@tauri-apps/plugin-shell'); await open(folder); } catch { /* best effort */ } }
  }

  function go(delta: number) {
    setIdx((i) => Math.max(0, Math.min(contacts.length - 1, i + delta)));
  }
  async function doCopy(which: 'msg' | 'email') {
    const text = which === 'msg'
      ? fillTokens(cur.linkedin_message || '', cur)
      : fillTokens(cur.email_body || cur.linkedin_message || '', cur);
    if (await copyText(text)) { setCopied(which); setTimeout(() => setCopied((c) => (c === which ? null : c)), 1600); }
  }

  const msg = fillTokens(cur.linkedin_message || '', cur);
  const hasProfile = !!(cur.linkedin_url && /linkedin\.com\/in\//i.test(cur.linkedin_url));

  // Follow the selected contact. Without this the box keeps showing the PREVIOUS person's link,
  // and a blur would then write that person's profile onto this one.
  useEffect(() => {
    setLiDraft(cur.linkedin_url || '');
    setLiNote('');
  }, [idx, cur.linkedin_url]);

  // Moving to another person must not carry the last one's refine state across — an Undo that
  // restores someone ELSE's message would be worse than no Undo at all.
  useEffect(() => {
    setMsgRefineInput('');
    setMsgRefineNote('');
    setMsgUndo(null);
    setVerifyProfileNote('');   // a verdict about one person must never linger over the next
  }, [idx]);

  /**
   * Take a profile link the user typed, check it, and make it the saved one.
   *
   * Checked rather than trusted: a company page cannot be messaged, and a half-pasted link that
   * merely contains "linkedin" would produce a contact that looks reachable and is not. Anything
   * that isn't a personal /in/ profile is refused with the reason, and nothing is overwritten.
   */
  function saveLinkedInUrl(raw: string) {
    const typed = (raw || '').trim();
    if (!typed) { setLiNote(''); return; }
    const clean = normaliseLinkedInUrl(typed);
    if (!clean) {
      setLiNote(isCompanyLinkedInUrl(typed)
        ? 'That is a company page — you can\'t message a person through it. Open the company page, click the person, and copy the link from their profile (it has /in/ in it).'
        : 'That doesn\'t look like a profile link. It should contain linkedin.com/in/…');
      return;
    }
    if (clean === (cur.linkedin_url || '')) { setLiNote('✓ Already saved.'); return; }
    setContacts((prev) => prev.map((c, i) => (i === idx ? { ...c, linkedin_url: clean } : c)));
    setLiDraft(clean);
    // And correct the list this contact came from, so the next campaign doesn't repeat the mistake.
    const listTitle = writeLeadProfileUrl(cur, clean);
    setLiNote(listTitle
      ? `✓ Saved — and corrected on your "${listTitle}" list too.`
      : '✓ Saved for this campaign.');
  }

  // One click: open this person's LinkedIn chat box AND type the drafted message straight into it
  // (via `typemsg` — the same trusted per-character typing the inbox "Reply on LinkedIn" button
  // uses). The user reviews the pre-filled box and presses Send — nothing is auto-SENT, so the
  // account stays safe. The message is also copied first as a backstop: if typing fails on an odd
  // layout, Ctrl+V still works. Falls back to opening the profile.
  async function copyAndOpenChat() {
    setOpenNote('');
    // Claim the window BEFORE it opens: the user is about to paste and send in it, and any Krew
    // run finishing in the background would otherwise auto-close it mid-task.
    setAgentBrowserHold(true);
    setBrowserOpen(true);
    await copyText(msg);
    setCopied('msg'); setTimeout(() => setCopied((c) => (c === 'msg' ? null : c)), 1600);
    setOpening(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      // No saved profile URL for this person → FIND them by name first, SAVE the correct profile URL
      // onto the contact (so this and every later open goes straight to their chat), then open it.
      // Only falls back to a people-search if we can't confidently match — this is what stops the
      // recurring "opened a search that says No results" and makes the fix stick.
      let targetUrl = cur.linkedin_url && /linkedin\.com\/in\//i.test(cur.linkedin_url) ? cur.linkedin_url : '';
      if (!targetUrl) {
        setOpenNote('Finding the right profile…');
        try {
          const raw = await invoke<string>('run_browser_persistent', { args: `findprofile "${(cur.name || '').replace(/["\n\r]/g, ' ').trim()}" ::: ${profileFilter(cur)}` });
          if (raw.includes('SIGN_IN_REQUIRED') || raw.includes('[NEEDS_LOGIN]')) {
            setOpenNote('Sign in to LinkedIn in the ADRIS browser window, then click again.');
            return;
          }
          const pj = raw.indexOf('PROFILE_JSON:');
          if (pj >= 0) { const arr = JSON.parse(raw.slice(pj + 'PROFILE_JSON:'.length).trim()); targetUrl = bestProfileUrl(Array.isArray(arr) ? arr : [], cur.name); }
        } catch { /* fall through to the search below */ }
        if (targetUrl) {
          // Persist the corrected URL onto this contact — the auto-save effect mirrors it to storage
          // and the Brain, so next time hasProfile is true and it opens directly.
          const fixed = targetUrl;
          setContacts((prev) => prev.map((c, i) => (i === idx ? { ...c, linkedin_url: fixed } : c)));
        } else {
          // Couldn't match confidently → open a name-only people-search as before.
          try { await invoke('run_browser_persistent', { args: `open "${profileUrl(cur)}"` }); }
          catch { openLink(profileUrl(cur)); }
          setOpenNote('Opened a LinkedIn search in the ADRIS browser — click the right person, hit Message, then paste (Ctrl+V).');
          return;
        }
      }
      // typemsg opens the chat box AND types the message in (url unquoted + " ::: " + text — the
      // exact format the reply auto-type uses; the url has no spaces so needs no quotes, and quoting
      // it would break the command's ' ::: ' split).
      const res = await invoke<string>('run_browser_persistent', { args: `typemsg ${targetUrl} ::: ${msg}` });
      const savedNote = !hasProfile ? ' (Saved their profile link for next time.)' : '';
      if (typeof res === 'string' && res.includes('SIGN_IN_REQUIRED')) setOpenNote('Sign in to LinkedIn in the ADRIS browser window, then click again.');
      else if (typeof res === 'string' && res.includes('MESSAGE_DRAFTED')) setOpenNote(`Typed into their chat box in the ADRIS browser — review it and press Enter/Send, then mark them Sent below.${savedNote}`);
      else if (typeof res === 'string' && res.includes('NO_BOX')) setOpenNote(`Opened their profile but couldn't type into the box — it's copied, so click Message and paste (Ctrl+V).${savedNote}`);
      else setOpenNote(`Opened their profile in the ADRIS browser — click Message, then paste & send.${savedNote} (If you\'re not connected yet, send a connection request first.)`);
    } catch {
      openLink(profileUrl(cur));
      setOpenNote('Opened their profile in your browser — click Message and paste.');
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-end bg-black/60 backdrop-blur-md" onClick={onClose}>
      <div
        className="w-full max-w-md h-full bg-nv-surface border-l border-nv-border shadow-2xl flex flex-col animate-[slidein_.18s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-nv-border flex items-center gap-2 shrink-0">
          <svg viewBox="0 0 24 24" className="w-4 h-4 text-accent shrink-0" fill="currentColor"><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45z"/></svg>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold truncate">Outreach copilot</div>
            <div className="text-[10px] text-nv-faint truncate">{contacts.length} contacts · auto-typed, you review &amp; send</div>
          </div>
          <button onClick={onClose} className="text-nv-faint hover:text-nv-text p-1 rounded" title="Close">
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Why-not-automated banner */}
        <div className="px-4 py-2 bg-amber-400/5 border-b border-amber-400/15 shrink-0">
          <button onClick={() => setWhyOpen((v) => !v)} className="flex items-center gap-1.5 text-[10.5px] text-amber-600 w-full text-left">
            <svg viewBox="0 0 24 24" className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4M12 17h.01M10.3 3.9l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0z"/></svg>
            Why doesn't adris just send these itself?
            <svg viewBox="0 0 24 24" className={`w-3 h-3 ml-auto transition-transform ${whyOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          {whyOpen && (
            <p className="text-[10px] text-nv-faint mt-1.5 leading-relaxed">
              LinkedIn's rules forbid automated messaging and connecting — accounts that auto-DM get
              restricted or banned, which would wreck your reputation right when you're winning clients.
              So adris does everything around it (writes each message, opens the right profile, tracks who
              accepted) and you do the one safe step: paste &amp; send. It takes ~2 seconds each.
            </p>
          )}
        </div>

        {/* Progress strip */}
        <div className="px-4 py-2 flex items-center gap-1.5 text-[10px] border-b border-nv-border shrink-0 overflow-x-auto">
          <span className="text-nv-faint">Progress:</span>
          <span className="text-sky-600 font-semibold">{progress.sent} sent</span>
          <span className="text-nv-faint">·</span>
          <span className="text-emerald-600 font-semibold">{progress.accepted} accepted</span>
          <span className="text-nv-faint">·</span>
          <span className="text-violet-600 font-semibold">{progress.replied} replied</span>
        </div>

        {/* Filter — see everyone at a given stage (who replied, who's been messaged) and jump back to
            any of them to continue. Tapping a chip lists those contacts; tapping a name jumps there. */}
        <div className="px-4 py-2 border-b border-nv-border shrink-0">
          {/* Where each person came from. Leads need a connection request first; connections can be
              messaged today — so being able to see one group at a time is the difference between a
              workable list and a confusing one. */}
          {contacts.some((c) => c.source === 'leads') && (
            <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
              <span className="text-[10px] text-nv-faint">Who:</span>
              {([null, 'connections', 'leads'] as (OutreachSource | null)[]).map((s) => {
                const n = s === null ? contacts.length : contacts.filter((c) => (c.source ?? 'connections') === s).length;
                const label = s === null ? 'Everyone' : s === 'leads' ? 'Lead list' : 'My connections';
                return (
                  <button
                    key={String(s)}
                    onClick={() => setSourceFilter(s)}
                    className={`text-[10px] font-medium px-2 py-0.5 rounded-full border transition-fast ${sourceFilter === s ? 'border-accent bg-accent text-white' : 'border-nv-border text-nv-faint hover:bg-nv-surface2'}`}
                  >{label} {n}</button>
                );
              })}
              {pendingCount > 0 && (
                <button
                  onClick={() => runConnectionCheck()}
                  disabled={checking}
                  title="Checks every pending request in one pass, without opening each profile"
                  className="ml-auto text-[10px] font-semibold px-2.5 py-1 rounded-lg border border-amber-500/50 text-amber-600 bg-amber-500/10 hover:bg-amber-500/20 transition-fast disabled:opacity-60"
                >{checking ? 'Checking…' : `Check ${pendingCount} pending`}</button>
              )}
            </div>
          )}
          {checkNote && (
            <div className="mb-1.5 text-[10px] text-nv-faint leading-relaxed">{checkNote}</div>
          )}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-nv-faint">Filter:</span>
            {(['replied', 'sent', 'accepted', 'connect', 'todo', 'skip'] as OutreachStatus[]).map((s) => {
              const n = contacts.filter((c) => (c.status || 'todo') === s).length;
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(statusFilter === s ? null : s)}
                  className={`text-[10px] font-medium px-2 py-0.5 rounded-full border transition-fast ${statusFilter === s ? 'border-accent bg-accent text-white' : 'border-nv-border text-nv-faint hover:bg-nv-surface2'}`}
                >
                  {STATUS_META[s].label} {n}
                </button>
              );
            })}
          </div>
          {/* Picking a source on its own lists that group so you can jump straight to any of them —
              otherwise the chips would only ever narrow the status list, which is not what "show me
              my leads" means. */}
          {sourceFilter && !statusFilter && (
            <div className="mt-1.5 max-h-40 overflow-y-auto rounded-lg border border-nv-border bg-nv-bg">
              {contacts.map((c, i) => ({ c, i })).filter(({ c }) => (c.source ?? 'connections') === sourceFilter).length === 0
                ? <div className="px-3 py-2 text-[10.5px] text-nv-faint">Nobody here yet.</div>
                : contacts.map((c, i) => ({ c, i })).filter(({ c }) => (c.source ?? 'connections') === sourceFilter).map(({ c, i }) => (
                  <button
                    key={i}
                    onClick={() => jumpTo(i)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-nv-surface2 transition-fast ${i === idx ? 'bg-accent/10' : ''}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[11.5px] font-medium truncate">{c.name || 'Unknown'}</div>
                      {c.company && <div className="text-[9.5px] text-nv-faint truncate">{c.company}</div>}
                    </div>
                    <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded border ${STATUS_META[c.status || 'todo'].cls}`}>
                      {STATUS_META[c.status || 'todo'].label}
                    </span>
                  </button>
                ))}
            </div>
          )}
          {statusFilter && (
            <div className="mt-1.5 max-h-40 overflow-y-auto rounded-lg border border-nv-border bg-nv-bg">
              {contacts.map((c, i) => ({ c, i })).filter(({ c }) => (c.status || 'todo') === statusFilter && (!sourceFilter || (c.source ?? 'connections') === sourceFilter)).length === 0
                ? <div className="px-3 py-2 text-[10.5px] text-nv-faint">No one at “{STATUS_META[statusFilter].label}” yet.</div>
                : contacts.map((c, i) => ({ c, i })).filter(({ c }) => (c.status || 'todo') === statusFilter && (!sourceFilter || (c.source ?? 'connections') === sourceFilter)).map(({ c, i }) => (
                  <button
                    key={i}
                    onClick={() => { jumpTo(i); setStatusFilter(null); }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-nv-surface2 transition-fast ${i === idx ? 'bg-accent/10' : ''}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[11.5px] font-medium truncate">{c.name || 'Unknown'}</div>
                      {c.company && <div className="text-[9.5px] text-nv-faint truncate">{c.company}</div>}
                    </div>
                    <span className="shrink-0 text-[9px] text-accent">Open →</span>
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* Search — jump to a contact by name instead of clicking Prev/Next through the whole list */}
        <div className="px-4 py-2 border-b border-nv-border shrink-0 relative">
          <div className="flex items-center gap-2 bg-nv-bg border border-nv-border rounded-lg px-2.5 py-1.5">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-nv-faint shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && matches.length) jumpTo(matches[0].i); if (e.key === 'Escape') setSearch(''); }}
              placeholder="Search a name to jump to them…"
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-nv-faint"
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-nv-faint hover:text-nv-text shrink-0" title="Clear">
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            )}
          </div>
          {search.trim() && (
            <div className="absolute left-4 right-4 top-full mt-1 z-10 bg-nv-surface border border-nv-border rounded-lg shadow-xl overflow-hidden max-h-64 overflow-y-auto">
              {matches.length === 0
                ? <div className="px-3 py-2 text-[11px] text-nv-faint">No contact matches “{search.trim()}”.</div>
                : matches.map(({ c, i }) => (
                  <button
                    key={i}
                    onClick={() => jumpTo(i)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-nv-surface2 transition-fast ${i === idx ? 'bg-accent/5' : ''}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">{c.name || 'Unknown'}</div>
                      {c.company && <div className="text-[10px] text-nv-faint truncate">{c.company}</div>}
                    </div>
                    <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded border ${STATUS_META[c.status || 'todo'].cls}`}>{STATUS_META[c.status || 'todo'].label}</span>
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* Current contact */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <div className="flex items-baseline justify-between">
            <div className="text-[10px] text-nv-faint font-mono">Contact {idx + 1} of {contacts.length}</div>
            <span className={`text-[9.5px] px-1.5 py-0.5 rounded border ${STATUS_META[cur.status || 'todo'].cls}`}>
              {STATUS_META[cur.status || 'todo'].label}
            </span>
          </div>
          <div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-semibold">{cur.name || 'Unknown contact'}</span>
              {/* Which channel this person is actually reachable on. Without it a list mixing
                  profiles and bare email addresses looked uniform, and "no way to reach them"
                  looked exactly like "ready to send". */}
              {(() => {
                // Show EVERY channel this person is reachable on, not just the best one — an
                // influencer with Instagram and an agency email should show both, so the choice
                // of where to reach them is visible rather than decided silently.
                const chans = allChannels(cur);
                const CLS: Record<ContactChannel, string> = {
                  linkedin:  'border-accent/40 text-accent bg-accent/10',
                  email:     'border-emerald-500/40 text-emerald-600 bg-emerald-500/10',
                  x:         'border-nv-border text-nv-text bg-nv-surface2',
                  instagram: 'border-pink-500/40 text-pink-600 bg-pink-500/10',
                  none:      'border-amber-500/40 text-amber-600 bg-amber-500/10',
                };
                if (!chans.length) {
                  return <span className={`shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-md border ${CLS.none}`}
                    title="No LinkedIn profile, email, X or Instagram handle — find one before this person can be contacted">{CHANNEL_LABEL.none}</span>;
                }
                return chans.map((ch) => (
                  <span key={ch} className={`shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-md border ${CLS[ch]}`}>{CHANNEL_LABEL[ch]}</span>
                ));
              })()}
              {/* Which list they came off. Without this the two groups are indistinguishable, and
                  the reason one card asks for a connection request and the next doesn't is a
                  mystery. Untagged contacts predate lead lists, so they are connections. */}
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-medium ${cur.source === 'leads'
                ? 'border-orange-500/50 text-orange-600 bg-orange-500/10'
                : 'border-sky-600/40 text-sky-600 bg-sky-600/10'}`}>
                {cur.source === 'leads' ? 'Lead list' : 'Your connection'}
              </span>
              {cur.source === 'leads' && cur.leadList && (
                <span className="text-[9px] text-nv-faint truncate max-w-[140px]" title={cur.leadList}>from {cur.leadList}</span>
              )}
            </div>
            {cur.company && <div className="text-xs text-nv-faint">{cur.company}</div>}
          </div>

          {/* ── Not connected yet ────────────────────────────────────────────────────────────
              A free LinkedIn account cannot message anyone who isn't a 1st-degree connection, so
              for these people the connection request IS the step — showing them a full message
              they can't send is what made the lead list unusable for outreach. */}
          {needsConnect && (
            <div className="rounded-lg border border-orange-500/30 bg-orange-500/[0.06] p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold text-orange-600">
                  {cur.status === 'connect' ? `Request sent — ${cur.sentAgo ? `sent ${cur.sentAgo}` : (waitingLabel(cur.requestedAt) || 'waiting')}` : 'Not connected yet'}
                </span>
                <span className="text-[9px] text-nv-faint">{(cur.connect_note || '').length}/300</span>
              </div>
              <textarea
                value={cur.connect_note || ''}
                onChange={(e) => setContacts((prev) => prev.map((c, i) => (i === idx ? { ...c, connect_note: e.target.value.slice(0, 300) } : c)))}
                rows={4}
                maxLength={300}
                className="w-full text-xs bg-nv-bg border border-nv-border rounded-lg p-2 leading-relaxed resize-none focus:outline-none focus:border-accent/40 select-text"
                placeholder="Short note to send with the connection request…"
              />
              <div className="flex gap-1.5">
                <button
                  onClick={async () => {
                    const ok = await copyText(fillTokens(cur.connect_note || '', cur));
                    setCopied(ok ? 'note' : null);
                    openLink(profileUrl(cur));
                  }}
                  className={`flex-1 text-[10.5px] px-2 py-1.5 rounded-lg border transition-fast ${copied === 'note' ? 'border-emerald-400/50 text-emerald-600 bg-emerald-400/10' : 'border-accent/40 text-accent hover:bg-accent/10'}`}
                >{copied === 'note' ? '✓ Note copied — paste it in the request' : 'Copy note & open profile'}</button>
                {cur.status !== 'connect' && (
                  <button
                    onClick={() => setStatus('connect')}
                    className="shrink-0 text-[10.5px] px-2 py-1.5 rounded-lg border border-nv-border text-nv-faint hover:bg-nv-surface2 transition-fast"
                  >I sent it</button>
                )}
              </div>
              {cur.status === 'connect' && (
                <button
                  onClick={() => runConnectionCheck(idx)}
                  disabled={checking}
                  className="w-full text-[10.5px] font-semibold px-2 py-1.5 rounded-lg border border-amber-500/50 text-amber-600 bg-amber-500/10 hover:bg-amber-500/20 transition-fast disabled:opacity-60"
                >{checking ? 'Checking LinkedIn…' : 'Check if they accepted'}</button>
              )}
              <p className="text-[9.5px] text-nv-faint leading-relaxed">
                LinkedIn only allows messages to people you're connected to. Send the request with this note —
                once they accept, Krew writes the full message for you automatically.
              </p>
            </div>
          )}

          {/* Copy the message AND open the chat box in one click.
              Hidden while a connection request is still outstanding: LinkedIn has no chat box to
              open for a non-connection, so this button could only ever fail for them. */}
          {(channel === 'linkedin' || channel === 'both') && !needsConnect && (
            <div className="space-y-1.5">
              <button
                onClick={copyAndOpenChat}
                disabled={opening}
                className="w-full flex items-center justify-center gap-2 text-xs px-3 py-2 rounded-lg bg-accent text-white hover:bg-accent-dim transition-fast disabled:opacity-60"
              >
                {opening
                  ? <><span className="w-3 h-3 rounded-full border border-white/40 border-t-white animate-spin" /> Opening &amp; typing…</>
                  : <><svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg> Open chat &amp; type message</>}
              </button>
              <button
                onClick={() => { openLink(profileUrl(cur)); setOpenNote('Opened their profile — use this to connect first if you\'re not connected yet.'); }}
                className="w-full text-[10.5px] px-3 py-1 rounded-lg border border-nv-border text-nv-faint hover:bg-nv-surface2 transition-fast"
              >
                {hasProfile ? 'Just open their profile' : 'Find them on LinkedIn'}
              </button>
              {openNote && <p className="text-[10px] text-emerald-600 leading-relaxed">{openNote}</p>}
              {browserOpen && (
                <div className="flex items-center gap-2 pt-0.5">
                  <span className="flex-1 text-[10px] text-nv-faint leading-relaxed">
                    The browser stays open while you work through the list — nothing closes it but you.
                  </span>
                  <button
                    onClick={closeBrowserNow}
                    className="shrink-0 text-[10px] px-2 py-1 rounded-lg border border-nv-border text-nv-faint hover:text-nv-text hover:bg-nv-surface2 transition-fast"
                  >
                    Close browser
                  </button>
                </div>
              )}
            </div>
          )}

          {/* The message to paste. Only once they can actually receive it. */}
          {(channel === 'linkedin' || channel === 'both') && !needsConnect && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] text-nv-faint uppercase tracking-wide">LinkedIn message</div>
                <button
                  onClick={() => doCopy('msg')}
                  className={`text-[10px] px-2 py-1 rounded-md border transition-fast ${copied === 'msg' ? 'border-emerald-400/50 text-emerald-600 bg-emerald-400/10' : 'border-accent/40 text-accent hover:bg-accent/10'}`}
                >
                  {copied === 'msg' ? '✓ Copied — paste it' : 'Copy message'}
                </button>
              </div>
              <textarea
                value={msg}
                onChange={(e) => setContacts((prev) => prev.map((c, i) => (i === idx ? { ...c, linkedin_message: e.target.value } : c)))}
                rows={7}
                className="w-full text-xs bg-nv-bg border border-nv-border rounded-lg p-2.5 leading-relaxed resize-none focus:outline-none focus:border-accent/40 select-text"
                placeholder="No message drafted for this contact yet — type one, or ask Krew to draft it."
              />
              {/* ── Improve this one message with the AI ────────────────────────────────────
                  The capability existed but had no button here, so fixing ONE message meant going
                  back to Krew chat and running /refine across every untouched contact. Type what
                  you want changed, or press a chip for the three things people always ask for. */}
              <div className="mt-2 rounded-lg border border-nv-border bg-nv-bg/60 p-2">
                <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                  <span className="text-[9.5px] text-nv-faint uppercase tracking-wide shrink-0">Improve with AI</span>
                  {([
                    ['Shorter', 'Make it noticeably shorter — under 40 words, three sentences at most. Keep the specific detail, cut the setup.'],
                    ['More personal', 'Make it more specific to this person — reference their actual company or role concretely, and drop anything that could be sent to anyone else.'],
                    ['Less salesy', 'Remove any pitch, buzzwords and flattery. Make it sound like one human writing to another, with a low-pressure ask.'],
                  ] as const).map(([label, prompt]) => (
                    <button
                      key={label}
                      disabled={msgRefining || !msg.trim()}
                      onClick={() => refineOutreachMessage(prompt)}
                      className="text-[9.5px] px-1.5 py-0.5 rounded-full border border-nv-border text-nv-faint hover:text-nv-text hover:bg-nv-surface2 transition-fast disabled:opacity-40"
                    >{label}</button>
                  ))}
                  {msgUndo !== null && !msgRefining && (
                    <button
                      onClick={() => {
                        const back = msgUndo;
                        setContacts((prev) => prev.map((c, i) => (i === idx ? { ...c, linkedin_message: back } : c)));
                        setMsgUndo(null); setMsgRefineNote('');
                      }}
                      className="ml-auto text-[9.5px] px-1.5 py-0.5 rounded-full border border-amber-500/40 text-amber-600 hover:bg-amber-500/10 transition-fast"
                    >Undo</button>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    value={msgRefineInput}
                    onChange={(e) => { setMsgRefineInput(e.target.value); setMsgRefineNote(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && msgRefineInput.trim() && !msgRefining) refineOutreachMessage(msgRefineInput); }}
                    disabled={msgRefining}
                    placeholder={msgRefining ? 'Rewriting…' : 'Tell it what to change — "mention their Series A", "ask for 15 minutes"'}
                    className="flex-1 min-w-0 text-[11px] bg-nv-bg border border-nv-border rounded-md px-2 py-1 focus:outline-none focus:border-accent/40 select-text disabled:opacity-60"
                  />
                  <button
                    onClick={() => refineOutreachMessage(msgRefineInput)}
                    disabled={msgRefining || !msgRefineInput.trim() || !msg.trim()}
                    className="shrink-0 text-[10px] px-2.5 py-1 rounded-md bg-accent text-white font-medium hover:bg-accent-dim transition-fast disabled:opacity-40"
                  >{msgRefining ? '…' : 'Rewrite'}</button>
                </div>
                {msgRefineNote && <p className="text-[9.5px] text-amber-600 mt-1 leading-snug">{msgRefineNote}</p>}
              </div>
              <p className="text-[9.5px] text-nv-faint mt-1">
                Not connected yet? Send a connection request with a short note first (free accounts can only
                message 1st-degree connections). Mark <b>Connect requested</b> below, then come back once they accept.
              </p>
            </div>
          )}

          {/* Email secondary action */}
          {/* Shown whenever this person has an email — previously gated on the campaign-wide
              channel, so an address found during enrichment sat in the record unusable. */}
          {!!cur.email && (
            <div className="pt-1 border-t border-nv-border">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] text-nv-faint uppercase tracking-wide">Email · {cur.email}</div>
                <button onClick={() => doCopy('email')} className={`text-[10px] px-2 py-1 rounded-md border transition-fast ${copied === 'email' ? 'border-emerald-400/50 text-emerald-600 bg-emerald-400/10' : 'border-nv-border text-nv-faint hover:bg-nv-surface2'}`}>
                  {copied === 'email' ? '✓ Copied' : 'Copy email'}
                </button>
              </div>
              <button onClick={() => openLink(gmailComposeUrl(cur))} className="w-full text-[11px] px-3 py-1.5 rounded-lg border border-nv-border text-nv-faint hover:bg-nv-surface2 transition-fast">
                Open in Gmail compose
              </button>
              {campaign.deckAttached && (
                <p className="text-[9.5px] text-nv-faint mt-1">Tip: to auto-attach the deck PDF to every email, tell Krew "email these contacts with the deck attached" — it sends + attaches for you and reports who got it.</p>
              )}
            </div>
          )}

          {/* ── LinkedIn profile link ─────────────────────────────────────────────────────────
              The lead search finds the wrong profile sometimes — a namesake, or nothing at all —
              and when it does, the user is the one who ends up finding the right page. Until now
              there was nowhere to put it: the URL was only ever written by the automatic search, so
              a correct link the user had in their hand could not be given to the app. This is that
              box, the same shape as the X and Instagram ones.

              It writes to BOTH places on purpose. Saving only to the contact fixes this campaign
              and leaves the saved lead list still wrong, so the next campaign built from that list
              repeats the mistake and the user has to find the profile all over again. */}
          <div className="pt-1 border-t border-nv-border">
            <div className="flex items-center justify-between mb-1 gap-2">
              <div className="text-[10px] text-nv-faint uppercase tracking-wide shrink-0">LinkedIn</div>
              <input
                value={liDraft}
                onChange={(e) => { setLiDraft(e.target.value); setLiNote(''); }}
                onBlur={() => saveLinkedInUrl(liDraft)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveLinkedInUrl(liDraft); } }}
                placeholder="linkedin.com/in/their-profile"
                className="flex-1 min-w-0 text-[11px] bg-nv-bg border border-nv-border rounded-md px-2 py-1 focus:outline-none focus:border-accent/40 select-text"
              />
              {/* CHECK THIS ONE PERSON. Re-running a whole-list verification from the chat is
                  minutes of browser work to check a single row, so in practice nobody did it and
                  wrong links stayed until someone got messaged by mistake. */}
              <button
                onClick={verifyThisProfile}
                disabled={profVerifying || !(cur.name || '').trim()}
                title={`Search LinkedIn for ${cur.name || 'them'} and confirm this link is really their profile`}
                className="shrink-0 text-[10px] px-2 py-1 rounded-md border border-accent/40 text-accent hover:bg-accent/10 transition-fast disabled:opacity-40"
              >{profVerifying ? 'Checking…' : 'Verify'}</button>
            </div>
            {verifyProfileNote
              ? <p className={`text-[9.5px] leading-snug ${verifyProfileNote.startsWith('✓') ? 'text-emerald-600' : /Corrected|Found and saved/.test(verifyProfileNote) ? 'text-accent' : 'text-amber-600'}`}>{verifyProfileNote}</p>
              : liNote
                ? <p className={`text-[9.5px] ${liNote.startsWith('✓') ? 'text-emerald-600' : 'text-amber-600'}`}>{liNote}</p>
                : hasProfile
                  ? <p className="text-[9.5px] text-nv-faint">Used for the chat button above. Press <b>Verify</b> to confirm it is really them, or paste a different link.</p>
                  : <p className="text-[9.5px] text-amber-600">No profile saved for {cur.name || 'them'} — press <b>Verify</b> to find it, or paste theirs here.</p>}
          </div>

          {/* ── X and Instagram ──────────────────────────────────────────────────────────────
              Same shape as the LinkedIn action that already works: put the message on the
              clipboard, open the right place, YOU press send. Deliberately not automated — an
              app that sends DMs on your behalf is how a real account gets restricted, and the
              whole copilot is built on you approving every message that goes out.
              Editing the handle here writes it straight back to the campaign, so a handle found
              during research can be pasted in and used immediately. */}
          {(['x', 'instagram'] as const).map((ch) => {
            const val = ch === 'x' ? cur.x_handle : cur.instagram_handle;
            const h = bareHandle(val);
            const has = allChannels(cur).includes(ch);
            // Show the row when there IS a handle, or when there is no other way to reach them —
            // so a contact with nothing usable gets somewhere to put one instead of a dead end.
            if (!has && allChannels(cur).length) return null;
            return (
              <div key={ch} className="pt-1 border-t border-nv-border">
                <div className="flex items-center justify-between mb-1 gap-2">
                  <div className="text-[10px] text-nv-faint uppercase tracking-wide shrink-0">{CHANNEL_LABEL[ch]}</div>
                  <input
                    value={val || ''}
                    onChange={(e) => setContacts((prev) => prev.map((c, i) => (i === idx
                      ? { ...c, ...(ch === 'x' ? { x_handle: e.target.value } : { instagram_handle: e.target.value }) }
                      : c)))}
                    placeholder={ch === 'x' ? '@handle or x.com/handle' : '@handle or instagram.com/handle'}
                    className="flex-1 min-w-0 text-[11px] bg-nv-bg border border-nv-border rounded-md px-2 py-1 focus:outline-none focus:border-accent/40 select-text"
                  />
                </div>
                {h ? (
                  <button
                    onClick={async () => {
                      const ok = await copyText(fillTokens(msg || cur.linkedin_message || '', cur));
                      setCopied(ok ? (ch === 'x' ? 'x' : 'ig') : null);
                      openLink(dmUrl(cur, ch));
                    }}
                    className="w-full text-[11px] px-3 py-1.5 rounded-lg border border-nv-border text-nv-faint hover:bg-nv-surface2 transition-fast"
                  >
                    {copied === (ch === 'x' ? 'x' : 'ig')
                      ? '✓ Message copied — paste and send'
                      : ch === 'x' ? `Copy & open the DM to @${h}` : `Copy & open @${h} — then tap Message`}
                  </button>
                ) : val ? (
                  <p className="text-[9.5px] text-amber-600">That doesn't look like a handle — use "@name" or the profile link.</p>
                ) : (
                  <p className="text-[9.5px] text-nv-faint">Paste their handle to message them here.</p>
                )}
                {h && ch === 'instagram' && (
                  <p className="text-[9.5px] text-nv-faint mt-1">Instagram has no link that opens a chat directly, so this opens their profile — tap Message and paste.</p>
                )}
              </div>
            );
          })}

          {/* Status */}
          <div>
            <div className="text-[10px] text-nv-faint uppercase tracking-wide mb-1.5">After you send, mark it</div>
            <div className="flex flex-wrap gap-1.5">
              {(['connect', 'sent', 'accepted', 'replied', 'meeting', 'met', 'skip'] as OutreachStatus[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(cur.status === s ? 'todo' : s)}
                  className={`text-[10px] px-2 py-1 rounded-md border transition-fast ${cur.status === s ? STATUS_META[s].cls : 'border-nv-border text-nv-faint hover:bg-nv-surface2'}`}
                >
                  {STATUS_META[s].label}
                </button>
              ))}
            </div>
            {/* Once a meeting is booked the useful next action is not another pitch — it is making
                sure they turn up. Offered on the two statuses where that is true. */}
            {(cur.status === 'meeting' || cur.status === 'replied') && (
              <div className="mt-2">
                <button
                  disabled={remindBusy}
                  onClick={draftMeetingReminder}
                  className="text-[10px] px-2.5 py-1 rounded-lg border border-teal-600/50 text-teal-700 bg-teal-600/10 hover:bg-teal-600/20 transition-fast disabled:opacity-50"
                >
                  {remindBusy ? 'Checking your calendar…' : "Remind them about today's meeting"}
                </button>
                {reminderNote && <p className="text-[9.5px] text-nv-faint mt-1 leading-relaxed">{reminderNote}</p>}
              </div>
            )}
          </div>

          {/* ── They replied → scan the reply & plan the next move ── */}
          <div className="pt-2 border-t border-nv-border">
            <button
              onClick={() => scanReplyAndPlan('reply')}
              disabled={planning}
              className="w-full flex items-center justify-center gap-2 text-xs font-semibold px-3 py-2.5 rounded-lg bg-violet-600 text-white shadow-sm hover:bg-violet-500 active:bg-violet-700 transition-fast disabled:opacity-70"
            >
              {planning
                ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" /> {planNote || 'Working…'}</>
                : <><svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4"/><circle cx="12" cy="12" r="3"/></svg> {cur.status === 'replied' ? 'Scan their reply & plan next move' : 'They replied? Scan & plan the next move'}</>}
            </button>
            {/* No reply yet? Draft a re-engagement follow-up from the past thread. */}
            <button
              onClick={() => scanReplyAndPlan('followup')}
              disabled={planning}
              className="mt-1.5 w-full flex items-center justify-center gap-2 text-xs font-bold px-3 py-2 rounded-lg border-2 border-accent text-accent bg-accent/10 hover:bg-accent/20 transition-fast disabled:opacity-60"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              No reply yet? Draft a follow-up
            </button>
            {planNote && !planning && <p className="text-[10px] text-amber-600 mt-1.5 leading-relaxed">{planNote}</p>}

            {plan && (
              <div className="mt-2 space-y-2 rounded-lg border border-violet-500/25 bg-violet-500/[0.06] p-2.5">
                {/* What they want */}
                <div className="flex items-start gap-1.5">
                  <span className="shrink-0 mt-[1px] text-[9px] px-1.5 py-0.5 rounded border border-accent/50 text-accent font-semibold uppercase tracking-wide">{plan.intent.replace(/_/g, ' ')}</span>
                  <p className="text-[11px] text-nv-text leading-snug">{plan.read}</p>
                </div>

                {/* Manual paste box when the thread couldn't be read automatically */}
                {plan.read.toLowerCase().includes('paste') && (
                  <textarea
                    onBlur={async (e) => {
                      const t = e.target.value.trim(); if (!t) return;
                      setPlanning(true); setPlanNote('Planning from what you pasted…');
                      try {
                        const p = await planReply({ person: cur.name || 'them', company: cur.company, thread: `YOU: ${cur.linkedin_message || ''}\n${cur.name || 'THEM'}: ${t}`, ownerContext: buildOwnerContext(), availableDocs: docs.map((d) => ({ title: d.title, kind: d.kind, summary: d.summary })), aiCall });
                        setPlan(p); setDraftReply(p.draftReply || ''); setPlanNote('');
                        if (p.draftReply && !p.degraded) runVerify(p.draftReply, cur, t);
                      } catch { setPlanNote('Could not plan the reply.'); } finally { setPlanning(false); }
                    }}
                    rows={3}
                    placeholder="Paste what they wrote back…"
                    className="w-full text-xs bg-nv-bg border border-nv-border rounded-lg p-2 leading-relaxed resize-none focus:outline-none focus:border-accent/40 select-text"
                  />
                )}

                {/* The drafted reply — editable, re-verifiable, sendable */}
                {(draftReply || plan.draftReply) && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[10px] text-nv-faint uppercase tracking-wide">Suggested reply — you review &amp; send</div>
                      {verifying
                        ? <span className="text-[9px] text-nv-faint flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full border border-nv-faint/40 border-t-nv-faint animate-spin" /> Checking…</span>
                        : verify && (
                          <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded border ${verify.verdict === 'pass' ? 'border-emerald-600/60 text-emerald-600 bg-emerald-600/10' : verify.verdict === 'fail' ? 'border-red-600/60 text-red-600 bg-red-600/10' : 'border-amber-600/60 text-amber-600 bg-amber-600/10'}`}>
                            {verify.verdict === 'pass' ? '✓ Verified' : verify.verdict === 'fail' ? '⚠ Needs a fix' : '⚠ Review'}
                          </span>
                        )}
                    </div>
                    <textarea
                      value={draftReply}
                      // A hand edit is a fresh start: the user has taken over, so give the checker
                      // its full allowance again rather than leaving it stuck at "you decide".
                      onChange={(e) => { setDraftReply(e.target.value); setVerify(null); setFixRound(0); setFixStalled(false); }}
                      rows={6}
                      className="w-full text-xs bg-nv-bg border border-nv-border rounded-lg p-2.5 leading-relaxed resize-none focus:outline-none focus:border-accent/40 select-text"
                    />

                    {/* Verifier's notes — readable, not a faint whisper. High-severity items in a
                        clear red, the rest in amber, each on its own line. */}
                    {verify && verify.issues.length > 0 && (
                      <div className="mt-1.5 rounded-md border border-amber-500/40 bg-nv-surface2 px-2.5 py-2">
                        <div className="text-[10px] font-bold text-amber-600 uppercase tracking-wide mb-1">What to check before sending</div>
                        <ul className="space-y-1">
                          {verify.issues.slice(0, 4).map((it, i) => (
                            <li key={i} className={`text-[11.5px] leading-snug font-semibold ${it.severity === 'high' ? 'text-red-600' : 'text-amber-600'}`}>
                              • {it.issue}{it.fix ? <span className="text-nv-text font-normal"> — {it.fix}</span> : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {verify?.revised && verify.revised !== draftReply.trim() && (
                      <button onClick={() => { setDraftReply(verify.revised!); setVerify({ ...verify, revised: undefined }); }} className="mt-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border border-emerald-500/50 text-emerald-600 hover:bg-emerald-500/10 transition-fast">
                        Use the verifier's improved version
                      </button>
                    )}
                    {/* FLAGGING IS NOT FIXING. The verifier often reports a problem without offering
                        a rewrite, and "Re-verify" only re-reports it — so the user pressed a button,
                        saw "verified", and the flagged sentence was still sitting in the draft. This
                        turns the issues themselves into the rewrite instruction. */}
                    {/* Only REAL problems earn a rewrite, and only twice. A small model asked to
                        judge the same message twice answers differently, so an unbounded loop was
                        guaranteed on a free key: fix, new nitpicks, fix, new nitpicks. */}
                    {verify && !verify.revised && actionableIssues(verify).length > 0 && fixRound < MAX_FIX_ROUNDS && !fixStalled && (
                      <button
                        disabled={refining || !draftReply.trim()}
                        onClick={() => {
                          setRefineNote('');
                          setRefining(true);
                          const before = verify;
                          const beforeText = draftReply;
                          const todo = actionableIssues(verify);
                          const instruction = `Rewrite the message so that every one of these problems is GONE. Change only what is needed to fix them; keep the rest of the message, the tone and any real detail exactly as it is. Do not introduce placeholders.\n${todo.map((it) => `- ${it.issue}${it.fix ? ` (fix: ${it.fix})` : ''}`).join('\n')}`;
                          refineMessage({ current: draftReply, instruction, person: cur?.name, thread: lastThread, ownerContext: lastOwnerCtx, aiCall })
                            .then(async (next) => {
                              if (!next?.trim()) {
                                setRefineNote("The AI returned nothing for that — edit the draft yourself, or use the Redo box.");
                                return;
                              }
                              setDraftReply(next.trim());
                              setVerify(null);
                              setFixRound((n) => n + 1);
                              const after = await runVerify(next.trim(), cur, lastThread || (plan?.read ?? ''), lastOwnerCtx);
                              // Did that round get anywhere? If the same substantive complaints came
                              // back, another go will not help — stop asking and hand it over.
                              if (!madeProgress(before, after, beforeText, next.trim())) setFixStalled(true);
                            })
                            .catch((e) => setRefineNote(`Couldn't apply the fix: ${(e instanceof Error ? e.message : String(e)).slice(0, 140)}`))
                            .finally(() => setRefining(false));
                        }}
                        className="mt-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border border-amber-500/50 text-amber-600 hover:bg-amber-500/10 transition-fast disabled:opacity-60"
                      >
                        {refining ? 'Fixing…' : `Fix ${actionableIssues(verify).length === 1 ? 'this' : `these ${actionableIssues(verify).length}`} and re-check${fixRound > 0 ? ' (last try)' : ''}`}
                      </button>
                    )}
                    {/* THE LOOP ENDS WITH A PERSON, NOT A VERDICT. Said plainly, because the
                        alternative the user actually lived through was pressing Fix forever. */}
                    {verify && !verify.revised && actionableIssues(verify).length > 0 && (fixRound >= MAX_FIX_ROUNDS || fixStalled) && (
                      <p className="mt-1.5 text-[10px] text-nv-text leading-relaxed rounded-md border border-nv-border bg-nv-surface2 px-2.5 py-1.5">
                        I&apos;ve rewritten this {fixRound === 1 ? 'once' : `${fixRound} times`} and the checker keeps finding something new rather than converging — that&apos;s the checker being fussy, not the draft getting worse.
                        <b className="text-nv-text"> Its remaining notes are above; you decide.</b> Edit the message directly, or tell me exactly what to change in the Redo box below. You were always the one sending it.
                      </p>
                    )}
                    {/* Low-severity remarks alone are not a defect. Saying so stops the panel looking
                        like something is wrong when nothing is. */}
                    {verify && verify.issues.length > 0 && actionableIssues(verify).length === 0 && (
                      <p className="mt-1.5 text-[10px] text-nv-faint leading-relaxed">
                        Nothing above is a real problem — those are style notes. This is fine to send as it is.
                      </p>
                    )}

                    <div className="flex items-center gap-1.5 mt-1.5">
                      <button onClick={sendDraftReply} disabled={opening || !draftReply.trim()} className="flex-1 text-[11px] px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-dim transition-fast disabled:opacity-60">
                        {opening ? 'Opening chat…' : 'Type into their chat →'}
                      </button>
                      <button onClick={() => runVerify(draftReply, cur, lastThread || plan.read, lastOwnerCtx)} disabled={verifying || !draftReply.trim()} className="shrink-0 text-[10px] px-2 py-1.5 rounded-lg border border-nv-border text-nv-faint hover:bg-nv-surface2 transition-fast" title="Re-check the edited draft">
                        Re-verify
                      </button>
                    </div>
                    <p className="text-[9px] text-nv-faint mt-1">A human always sends. Nothing goes out on its own.</p>

                    {/* Tell it how to reshape the message, in plain English. */}
                    <div className="mt-2 flex items-center gap-1.5">
                      <input
                        value={refineInput}
                        onChange={(e) => setRefineInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && refineInput.trim() && !refining) refineDraft(); }}
                        placeholder='Tell it how to change this — e.g. "say yes and suggest tomorrow 3pm"'
                        className="flex-1 text-[11px] bg-nv-bg border border-nv-border rounded-lg px-2.5 py-1.5 outline-none focus:border-accent/50 placeholder:text-nv-faint"
                      />
                      <button
                        onClick={refineDraft}
                        disabled={refining || !refineInput.trim() || !draftReply.trim()}
                        className="shrink-0 text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-500 transition-fast disabled:opacity-50"
                      >
                        {refining ? '…' : 'Redo'}
                      </button>
                    </div>
                    {refineNote && <p className="text-[10px] text-amber-600 font-medium mt-1 leading-snug">{refineNote}</p>}

                    {/* Free-time suggestions from your calendar — tap one to put it in the reply. */}
                    {plan.suggestedSlots && plan.suggestedSlots.length > 0 && (
                      <div className="mt-2">
                        <div className="text-[10px] text-nv-faint mb-1">Free slots from your calendar — tap to propose one:</div>
                        <div className="flex flex-wrap gap-1.5">
                          {plan.suggestedSlots.map((slot, i) => (
                            <button
                              key={i}
                              disabled={refining}
                              onClick={() => { setRefineInput(''); setRefineNote(''); setRefining(true); refineMessage({ current: draftReply, instruction: `Propose ${slot} for the call as the concrete time, warmly and clearly.`, person: cur?.name, thread: lastThread, ownerContext: lastOwnerCtx, aiCall }).then((next) => { if (next?.trim()) { setDraftReply(next.trim()); setVerify(null); runVerify(next.trim(), cur, lastThread || (plan?.read ?? ''), lastOwnerCtx); } else { setRefineNote('The AI returned nothing for that time — try the Redo box instead.'); } }).catch((e) => setRefineNote(`Couldn't apply that time: ${(e instanceof Error ? e.message : String(e)).slice(0, 140)}`)).finally(() => setRefining(false)); }}
                              className="text-[10.5px] font-semibold px-2.5 py-1 rounded-full bg-emerald-600 text-white hover:bg-emerald-500 transition-fast disabled:opacity-50 shadow-sm"
                            >
                              🕑 {slot}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Attach a file — a Krew-made doc, one from your Brain, or one already on your computer */}
                {(plan.attachSuggested || attachDoc || (draftReply && plan.intent !== 'not_interested')) && (
                  <div className="pt-1.5 border-t border-violet-500/15">
                    <div className="text-[10px] text-nv-faint uppercase tracking-wide mb-1">
                      {plan.attachSuggested ? 'They want something to look at — attach a file' : 'Attach a file (optional)'}
                    </div>
                    {docs.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {docs.slice(0, 8).map((d) => (
                          <button key={d.id} onClick={() => setAttachDoc(attachDoc?.id === d.id ? null : d)}
                            className={`text-[10px] px-2 py-1 rounded-md border transition-fast ${attachDoc?.id === d.id ? 'border-accent/60 text-accent bg-accent/10' : 'border-nv-border text-nv-faint hover:bg-nv-surface2'}`}
                            title={`${d.summary || ''} · ${d.filename}`}>
                            {attachDoc?.id === d.id ? '✓ ' : ''}{d.filename}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <button onClick={pickFromComputer} className="flex-1 text-[10px] px-2 py-1 rounded-lg border border-nv-border text-nv-faint hover:bg-nv-surface2 transition-fast">
                        + Choose a file from your computer
                      </button>
                      {attachDoc && (
                        <button onClick={() => revealAttachment(attachDoc)} className="shrink-0 text-[10px] px-2 py-1 rounded-lg border border-accent/40 text-accent hover:bg-accent/10 transition-fast">
                          Reveal to drag in →
                        </button>
                      )}
                    </div>
                    {/* NOTHING ON FILE FITS? MAKE ONE. The panel could only offer documents that
                        already existed, so when a prospect asked to see something the user had to
                        close the copilot and describe the whole thing again in chat. This carries
                        the thread's own context over — who they are, what they asked for — and
                        hands it to the deck builder, which then asks for slide count as usual. */}
                    <button
                      onClick={() => {
                        const who = [cur.name, cur.company].filter(Boolean).join(' — ');
                        const brief = [
                          `Build a presentation to send to ${who || 'this prospect'} after a LinkedIn conversation.`,
                          plan?.read ? `\nWhat they want: ${plan.read}` : '',
                          plan?.attachHint ? `They asked for: ${plan.attachHint}` : '',
                          lastThread ? `\n=== THE CONVERSATION SO FAR ===\n${lastThread.slice(0, 6000)}` : '',
                          lastOwnerCtx ? `\n=== WHAT WE KNOW ABOUT THE SENDER / PRODUCT ===\n${lastOwnerCtx.slice(0, 4000)}` : '',
                          '\nSpeak to THIS person\'s situation, not a generic pitch. Use only facts present above — invent no figures, prices or customers.',
                        ].filter(Boolean).join('\n');
                        try {
                          window.dispatchEvent(new CustomEvent('nv-krew-make-deck', {
                            detail: { brief, ask: `Make a deck for ${who || 'this prospect'}` },
                          }));
                          onClose();
                        } catch { /* no window */ }
                      }}
                      className="w-full mt-1.5 text-[10.5px] px-3 py-1.5 rounded-lg border border-nv-border text-nv-faint hover:bg-nv-surface2 transition-fast text-left"
                    >
                      + Make a deck for {cur.name?.split(' ')[0] || 'them'} — using this thread
                    </button>
                    {docs.length === 0 && !attachDoc && (
                      <p className="text-[9.5px] text-nv-faint leading-relaxed mt-1">Pick a file above, or ask Krew to "make a one-pager PDF about adris for them". A PDF you save in the Brain shows up here too. (Working notes like .md are never offered.)</p>
                    )}
                  </div>
                )}

                {/* Next real-world step → one tap onto the To-do panel */}
                {(plan.nextAction || plan.meeting) && (
                  <div className="pt-1.5 border-t border-violet-500/15 space-y-1.5">
                    {plan.meeting && (plan.meeting.proposedTime || plan.meeting.note) && (
                      <p className="text-[10px] text-nv-text leading-snug">
                        <span className="text-accent font-semibold">Meeting:</span> {plan.meeting.proposedTime || plan.meeting.note} {plan.meeting.confirmed ? '(confirmed)' : '(proposed — confirm it)'}
                      </p>
                    )}
                    {/* MAKE IT REAL. Printing the time was as far as this went, so a reply could
                        promise an invite the copilot had no way to send. One press books it — a
                        genuine Google event when Google is connected, otherwise the calendar
                        prefilled for a Save press, and the wording below never overstates which. */}
                    {plan.meeting && (plan.meeting.proposedTime || plan.meeting.note) && (
                      <>
                        <button
                          onClick={createMeeting}
                          disabled={meetingBusy || meetingMade}
                          className={`w-full text-[10.5px] px-3 py-1.5 rounded-lg border transition-fast text-left ${
                            meetingMade
                              ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
                              : 'border-accent/40 text-accent hover:bg-accent/10 disabled:opacity-50'}`}
                        >
                          {meetingMade ? '✓ Meeting created' : meetingBusy ? 'Creating the meeting…' : (googleToken ? '📅 Create this meeting & invite them' : '📅 Create this meeting')}
                        </button>
                        {!meetingMade && !meetingBusy && (
                          <p className="text-[9px] text-nv-faint leading-relaxed">
                            {googleToken
                              ? 'Google is connected, so this books a real event and emails them the invitation.'
                              : 'Opens your calendar with everything filled in — you press Save. Connect Google in Connect Apps to have it booked and the invite emailed for you.'}
                          </p>
                        )}
                        {meetingNote && <p className="text-[9.5px] text-nv-text leading-relaxed">{meetingNote}</p>}
                      </>
                    )}
                    {plan.nextAction && (
                      <button
                        onClick={() => {
                          todos.add(plan.nextAction!, { url: cur.linkedin_url, priority: 'med' });
                          setPlanNote('Added to your To-do panel.');
                          setTimeout(() => setPlanNote(''), 1800);
                        }}
                        className="w-full text-[10.5px] px-3 py-1.5 rounded-lg border border-nv-border text-nv-faint hover:bg-nv-surface2 transition-fast text-left"
                      >
                        + Add to To-do: {plan.nextAction}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Nav */}
        <div className="px-4 py-3 border-t border-nv-border flex items-center gap-2 shrink-0">
          <button onClick={() => go(-1)} disabled={idx === 0} className="text-xs px-3 py-1.5 rounded-lg border border-nv-border text-nv-faint hover:bg-nv-surface2 disabled:opacity-30 transition-fast">← Prev</button>
          <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: `${((idx + 1) / contacts.length) * 100}%` }} />
          </div>
          {idx < contacts.length - 1 ? (
            <button onClick={() => go(1)} className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-dim transition-fast">Next →</button>
          ) : (
            <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-fast">Done</button>
          )}
        </div>
      </div>
      <style>{`@keyframes slidein{from{transform:translateX(24px);opacity:.4}to{transform:translateX(0);opacity:1}}`}</style>
    </div>
  );
}
