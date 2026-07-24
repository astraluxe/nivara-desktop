import { useState, useEffect, useMemo, useRef } from 'react';
import { brain } from '../../lib/knowledgeStore';
import { todos } from '../../lib/todoStore';
import { setAgentBrowserHold, bestProfileMatch } from '../../lib/krewTools';
import { planReply, planFollowUp, verifyWork, type ReplyPlan, type VerifyResult } from '../../lib/verify';
import { listAttachableDocs, type GeneratedDoc } from '../../lib/docgen';

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
    return [...product, ...avail].join('\n').slice(0, 3500);
  } catch { return ''; }
}

// ─── Human-in-the-loop LinkedIn / email outreach ─────────────────────────────
// Why this exists instead of full automation:
// LinkedIn's User Agreement forbids automated messaging/connecting, and their
// systems flag it fast — accounts that auto-DM get restricted or permanently
// banned. That is the LAST thing we want right before the user pitches real
// clients. So adris does everything AROUND the send — drafts each message,
// opens the right profile, tracks who was contacted and who accepted — and the
// user does the one thing only a human safely can: paste and hit send (2s each).

export type OutreachStatus = 'todo' | 'connect' | 'sent' | 'accepted' | 'replied' | 'skip';

export interface OutreachContact {
  name: string;
  company?: string;
  linkedin_url?: string;
  email?: string;
  linkedin_message?: string;
  email_subject?: string;
  email_body?: string;
  status?: OutreachStatus;
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
  const [copied, setCopied] = useState<'msg' | 'email' | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const [search, setSearch] = useState('');   // jump-to-a-contact by name, instead of Prev/Next spam
  const [opening, setOpening] = useState(false);
  const [openNote, setOpenNote] = useState('');
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
  const planRef = useRef<HTMLDivElement | null>(null);

  // Pull the user's REAL upcoming calendar so a proposed meeting time is checked against what they're
  // actually doing — the gap the user hit: a reply offered "tomorrow 10:30" while they had a 9am that
  // could run over. Prefers the Google API when connected; otherwise reads the calendar straight from
  // the logged-in agent browser, so this works even without connecting Google via ConnectApps.
  async function fetchCalendarContext(schedulingLikely: boolean): Promise<string> {
    const { invoke } = await import('@tauri-apps/api/core');
    const preface = "The owner's REAL calendar (do NOT propose or confirm a time that clashes with these; if a slot is close to or right after one of these, flag it to confirm — a meeting before it could run over):";

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
  // just generated ("make a PDF") should appear here without a reload.
  useEffect(() => { setDocs(listAttachableDocs()); }, [idx, campaign]);

  // Clear any plan/verification when moving to a different contact — a plan belongs to one person.
  useEffect(() => {
    if (planIdx !== idx) { setPlan(null); setVerify(null); setPlanNote(''); setDraftReply(''); setAttachDoc(null); }
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

  function setStatus(s: OutreachStatus) {
    setContacts((prev) => prev.map((c, i) => (i === idx ? { ...c, status: s } : c)));
    // The user asked for this explicitly: the moment someone is marked "Replied", don't just log it
    // — read what they actually said and plan the next move. Auto-runs the scan (if not already done
    // for this person) so the flow never dead-ends at "Replied".
    if (s === 'replied' && !(plan && planIdx === idx)) { scanReplyAndPlan(); }
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
    let thread = '';
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      setAgentBrowserHold(true); setBrowserOpen(true);

      // Open ONLY this person's chat and read it — no whole-inbox scan. We need their profile URL;
      // if we don't have it yet, find it once by name and save it for next time.
      let targetUrl = contact.linkedin_url && /linkedin\.com\/in\//i.test(contact.linkedin_url) ? contact.linkedin_url : '';
      if (!targetUrl) {
        setPlanNote('Finding their profile…');
        try {
          const fp = await invoke<string>('run_browser_persistent', { args: `findprofile "${(contact.name || '').replace(/["\n\r]/g, ' ').trim()}"` });
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
        const raw = await invoke<string>('run_browser_persistent', { args: `readthread ${targetUrl}` }).catch((e) => String(e));
        if (raw.includes('SIGN_IN_REQUIRED') || raw.includes('[NEEDS_LOGIN]')) {
          setPlanNote('Sign in to LinkedIn in the ADRIS browser window, then click "Scan their reply" again.');
          setPlanning(false); await refocusAppToPlan(); return;
        }
        const tj = raw.indexOf('THREAD_JSON:');
        if (tj >= 0) {
          try {
            const obj = JSON.parse(raw.slice(tj + 'THREAD_JSON:'.length).trim()) as { messages?: Array<{ isYou?: boolean; text?: string }> };
            if (obj.messages?.length) {
              thread = obj.messages.map((m) => `${m.isYou ? 'YOU' : (contact.name || 'THEM')}: ${m.text || ''}`).join('\n');
            }
          } catch { /* fall through to manual paste */ }
        }
      }
    } catch { /* browser optional — fall back to a manual paste */ }

    if (!thread.trim()) {
      // The person wasn't in the recent inbox (older thread, or they never replied). Say so plainly
      // and let the user paste the thread — the plan panel still appears.
      setPlanNote(mode === 'followup'
        ? `Couldn't read your past thread with ${contact.name || 'them'} automatically. Paste the last message(s) below and I'll draft a follow-up.`
        : `Couldn't find a recent reply from ${contact.name || 'them'} in your inbox. If they DID reply, paste it below and I'll draft your response; otherwise there's nothing to reply to yet.`);
      setPlanning(false);
      setPlan({ intent: 'unclear', read: `Paste your thread with ${contact.name || 'them'} here and I'll ${mode === 'followup' ? 'draft a follow-up' : 'plan your response'}.`, draftReply: '', attachSuggested: false });
      await refocusAppToPlan();
      return;
    }

    // Only involve the calendar when the thread is actually about timing (a call, a meeting, "when
    // are you free", a day/time) — so an ordinary reply doesn't open Calendar in the browser.
    const schedulingLikely = /\b(call|meet(ing)?|schedule|available|availability|free|calendar|catch up|hop on|zoom|google meet|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d\s?(am|pm)|\d{1,2}[:.]\d{2})\b/i.test(thread);
    setPlanNote(mode === 'followup' ? 'Reading the thread & drafting a follow-up…' : (schedulingLikely ? 'Checking your calendar & planning the next move…' : 'Planning the next move…'));
    // Read the real calendar first (when timing is in play) so the plan and the verifier both know
    // what the owner is actually doing before proposing or confirming any time.
    const calendar = await fetchCalendarContext(schedulingLikely);
    const ownerContext = [buildOwnerContext(), calendar].filter(Boolean).join('\n\n');
    try {
      const args = { person: contact.name || 'them', company: contact.company, thread, ownerContext, availableDocs: docs.map((d) => ({ title: d.title, kind: d.kind, summary: d.summary })), aiCall };
      const p = mode === 'followup' ? await planFollowUp(args) : await planReply(args);
      setPlan(p);
      setDraftReply(p.draftReply || '');
      // Point the user to where the draft now is, so the flow never dead-ends silently.
      setPlanNote(p.degraded ? p.read : (mode === 'followup' ? '✓ Follow-up drafted below — review & send.' : '✓ Read their reply — your draft is ready below to review & send.'));
      setTimeout(() => setPlanNote((n) => (n.startsWith('✓ ') ? '' : n)), 4000);
      // If the plan suggests attaching something, pre-select the best-matching generated doc.
      if (p.attachSuggested && docs.length) {
        const hint = (p.attachHint || '').toLowerCase();
        const best = docs.find((d) => hint && (`${d.title} ${d.summary || ''}`.toLowerCase().includes(hint) || d.kind === hint)) || docs[0];
        setAttachDoc(best || null);
      }
      // Verify the drafted reply straight away, so the user sees a vetted draft rather than raw output.
      // Pass the same calendar context so the verifier can catch a clashing meeting time.
      if (p.draftReply && !p.degraded) runVerify(p.draftReply, contact, thread, ownerContext);
      await refocusAppToPlan();
    } catch {
      setPlanNote('Could not plan the reply. Read the thread and respond yourself.');
      await refocusAppToPlan();
    } finally {
      setPlanning(false);
    }
  }

  // Independent verification pass on a drafted reply — the second agent that checks the first
  // agent's work before the human commits to it. Never blocks; only informs. `ownerCtx` carries the
  // owner's real calendar/availability so the verifier can catch a clashing meeting time.
  async function runVerify(text: string, contact: OutreachContact, thread: string, ownerCtx = '') {
    if (!text.trim()) return;
    setVerifying(true); setVerify(null);
    try {
      const v = await verifyWork({
        kind: 'outreach-reply',
        task: `Reply to ${contact.name || 'a prospect'}${contact.company ? ` at ${contact.company}` : ''} on LinkedIn, moving the conversation forward without over-promising.`,
        artifact: text,
        context: `The conversation so far:\n${thread}${ownerCtx ? `\n\nOWNER'S REAL AVAILABILITY / CALENDAR:\n${ownerCtx}` : ''}`,
        checklist: [
          'The reply directly addresses what the prospect actually said, not a generic script.',
          'No invented facts, features, prices, or commitments.',
          'It does not jump straight to "book a call" if the prospect only asked to know more — it gives substance first.',
          'Any proposed or confirmed meeting time does NOT clash with the owner\'s real calendar above, including a nearby event that could run over into it — flag it to confirm if unsure.',
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
      setVerify(v);
    } catch { /* verification is best-effort */ } finally { setVerifying(false); }
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
          const raw = await invoke<string>('run_browser_persistent', { args: `findprofile "${(contact.name || '').replace(/["\n\r]/g, ' ').trim()}"` });
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
          const raw = await invoke<string>('run_browser_persistent', { args: `findprofile "${(cur.name || '').replace(/["\n\r]/g, ' ').trim()}"` });
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
          <button onClick={() => setWhyOpen((v) => !v)} className="flex items-center gap-1.5 text-[10.5px] text-amber-300/90 w-full text-left">
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
            <div className="text-sm font-semibold">{cur.name || 'Unknown contact'}</div>
            {cur.company && <div className="text-xs text-nv-faint">{cur.company}</div>}
          </div>

          {/* Copy the message AND open the chat box in one click */}
          {(channel === 'linkedin' || channel === 'both') && (
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
              {openNote && <p className="text-[10px] text-emerald-300/90 leading-relaxed">{openNote}</p>}
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

          {/* The message to paste */}
          {(channel === 'linkedin' || channel === 'both') && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] text-nv-faint uppercase tracking-wide">LinkedIn message</div>
                <button
                  onClick={() => doCopy('msg')}
                  className={`text-[10px] px-2 py-1 rounded-md border transition-fast ${copied === 'msg' ? 'border-emerald-400/50 text-emerald-300 bg-emerald-400/10' : 'border-accent/40 text-accent hover:bg-accent/10'}`}
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
              <p className="text-[9.5px] text-nv-faint mt-1">
                Not connected yet? Send a connection request with a short note first (free accounts can only
                message 1st-degree connections). Mark <b>Connect requested</b> below, then come back once they accept.
              </p>
            </div>
          )}

          {/* Email secondary action */}
          {cur.email && (channel === 'email' || channel === 'both') && (
            <div className="pt-1 border-t border-nv-border">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] text-nv-faint uppercase tracking-wide">Email · {cur.email}</div>
                <button onClick={() => doCopy('email')} className={`text-[10px] px-2 py-1 rounded-md border transition-fast ${copied === 'email' ? 'border-emerald-400/50 text-emerald-300 bg-emerald-400/10' : 'border-nv-border text-nv-faint hover:bg-nv-surface2'}`}>
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

          {/* Status */}
          <div>
            <div className="text-[10px] text-nv-faint uppercase tracking-wide mb-1.5">After you send, mark it</div>
            <div className="flex flex-wrap gap-1.5">
              {(['connect', 'sent', 'accepted', 'replied', 'skip'] as OutreachStatus[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(cur.status === s ? 'todo' : s)}
                  className={`text-[10px] px-2 py-1 rounded-md border transition-fast ${cur.status === s ? STATUS_META[s].cls : 'border-nv-border text-nv-faint hover:bg-nv-surface2'}`}
                >
                  {STATUS_META[s].label}
                </button>
              ))}
            </div>
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
              className="mt-1.5 w-full flex items-center justify-center gap-2 text-[11px] font-medium px-3 py-2 rounded-lg border border-violet-500/60 text-violet-300 hover:bg-violet-500/10 transition-fast disabled:opacity-60"
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              No reply yet? Draft a follow-up
            </button>
            {planNote && !planning && <p className="text-[10px] text-amber-300/90 mt-1.5 leading-relaxed">{planNote}</p>}

            {plan && (
              <div className="mt-2 space-y-2 rounded-lg border border-violet-500/25 bg-violet-500/[0.06] p-2.5">
                {/* What they want */}
                <div className="flex items-start gap-1.5">
                  <span className="shrink-0 mt-[1px] text-[9px] px-1.5 py-0.5 rounded border border-violet-500/40 text-violet-300 uppercase tracking-wide">{plan.intent.replace(/_/g, ' ')}</span>
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
                          <span className={`text-[9px] px-1.5 py-0.5 rounded border ${verify.verdict === 'pass' ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10' : verify.verdict === 'fail' ? 'border-red-500/50 text-red-400 bg-red-500/10' : 'border-amber-500/50 text-amber-400 bg-amber-500/10'}`}>
                            {verify.verdict === 'pass' ? '✓ Verified' : verify.verdict === 'fail' ? '⚠ Needs a fix' : '⚠ Review'}
                          </span>
                        )}
                    </div>
                    <textarea
                      value={draftReply}
                      onChange={(e) => { setDraftReply(e.target.value); setVerify(null); }}
                      rows={6}
                      className="w-full text-xs bg-nv-bg border border-nv-border rounded-lg p-2.5 leading-relaxed resize-none focus:outline-none focus:border-accent/40 select-text"
                    />

                    {/* Verifier's notes — readable, not a faint whisper. High-severity items in a
                        clear red, the rest in amber, each on its own line. */}
                    {verify && verify.issues.length > 0 && (
                      <div className="mt-1.5 rounded-md border border-amber-500/30 bg-amber-500/[0.07] px-2.5 py-2">
                        <div className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide mb-1">What to check before sending</div>
                        <ul className="space-y-1">
                          {verify.issues.slice(0, 4).map((it, i) => (
                            <li key={i} className={`text-[11.5px] leading-snug font-medium ${it.severity === 'high' ? 'text-red-400' : 'text-amber-300'}`}>
                              • {it.issue}{it.fix ? <span className="text-nv-faint font-normal"> — {it.fix}</span> : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {verify?.revised && verify.revised !== draftReply.trim() && (
                      <button onClick={() => { setDraftReply(verify.revised!); setVerify({ ...verify, revised: undefined }); }} className="mt-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10 transition-fast">
                        Use the verifier's improved version
                      </button>
                    )}

                    <div className="flex items-center gap-1.5 mt-1.5">
                      <button onClick={sendDraftReply} disabled={opening || !draftReply.trim()} className="flex-1 text-[11px] px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-dim transition-fast disabled:opacity-60">
                        {opening ? 'Opening chat…' : 'Type into their chat →'}
                      </button>
                      <button onClick={() => runVerify(draftReply, cur, plan.read)} disabled={verifying || !draftReply.trim()} className="shrink-0 text-[10px] px-2 py-1.5 rounded-lg border border-nv-border text-nv-faint hover:bg-nv-surface2 transition-fast" title="Re-check the edited draft">
                        Re-verify
                      </button>
                    </div>
                    <p className="text-[9px] text-nv-faint mt-1">A human always sends. Nothing goes out on its own.</p>
                  </div>
                )}

                {/* Attach a professional file if the reply calls for one */}
                {(plan.attachSuggested || attachDoc) && (
                  <div className="pt-1.5 border-t border-violet-500/15">
                    <div className="text-[10px] text-nv-faint uppercase tracking-wide mb-1">
                      {plan.attachSuggested ? 'They want something to look at — attach a file' : 'Attach a file'}
                    </div>
                    {docs.length === 0 ? (
                      <p className="text-[10px] text-nv-faint leading-relaxed">No professional files ready yet. Ask Krew to "make a PDF/one-pager about adris for them" — it'll appear here to attach. (Working notes like .md are never offered.)</p>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-1.5">
                          {docs.slice(0, 6).map((d) => (
                            <button key={d.id} onClick={() => setAttachDoc(attachDoc?.id === d.id ? null : d)}
                              className={`text-[10px] px-2 py-1 rounded-md border transition-fast ${attachDoc?.id === d.id ? 'border-accent/60 text-accent bg-accent/10' : 'border-nv-border text-nv-faint hover:bg-nv-surface2'}`}
                              title={d.summary || d.filename}>
                              {attachDoc?.id === d.id ? '✓ ' : ''}{d.filename}
                            </button>
                          ))}
                        </div>
                        {attachDoc && (
                          <button onClick={() => revealAttachment(attachDoc)} className="mt-1.5 w-full text-[10px] px-2 py-1 rounded-lg border border-nv-border text-nv-faint hover:bg-nv-surface2 transition-fast">
                            Open its folder to drag it into the chat →
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Next real-world step → one tap onto the To-do panel */}
                {(plan.nextAction || plan.meeting) && (
                  <div className="pt-1.5 border-t border-violet-500/15 space-y-1.5">
                    {plan.meeting && (plan.meeting.proposedTime || plan.meeting.note) && (
                      <p className="text-[10px] text-nv-text leading-snug">
                        <span className="text-violet-300 font-medium">Meeting:</span> {plan.meeting.proposedTime || plan.meeting.note} {plan.meeting.confirmed ? '(confirmed)' : '(proposed — confirm it)'}
                      </p>
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
