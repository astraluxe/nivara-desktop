import { useState, useEffect, useMemo } from 'react';
import { brain } from '../../lib/knowledgeStore';
import { todos } from '../../lib/todoStore';
import { setAgentBrowserHold } from '../../lib/krewTools';

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

/** Pick the best LinkedIn profile from findprofile results for a given contact name: the first name
 *  OR surname must match and at least half the name tokens must overlap; a 1st-degree connection
 *  wins ties. Returns the clean /in/ URL, or '' if nothing matches confidently (so we never point a
 *  button at a stranger who merely shares a surname). Shared by the copilot's self-heal and
 *  /verifylinks so both behave identically. */
const NAME_HONORIFICS = new Set(['dr', 'mr', 'mrs', 'ms', 'miss', 'mx', 'prof', 'professor', 'sri', 'shri', 'smt', 'er', 'ca', 'adv', 'advocate', 'capt', 'col', 'gen', 'rev', 'sir', 'hon']);
export function bestProfileUrl(results: Array<{ name?: string; url?: string; degree?: string }>, contactName: string): string {
  const toks = (s: string) => (s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter((t) => t && !NAME_HONORIFICS.has(t));
  const cTokens = toks(contactName);
  if (!cTokens.length) return '';
  const cSet = new Set(cTokens);
  let best = '';
  let bestScore = -1;
  for (const r of results) {
    if (!r?.url || !/linkedin\.com\/in\//i.test(r.url)) continue;
    const rTokens = toks(r.name || '');
    if (!rTokens.length) continue;
    const rSet = new Set(rTokens);
    // Require one name to be a token-subset of the other — so "Syed Zubair" matches "Syed Zubair
    // Ahmed" but NEVER "Rahul Kumar" for a "Nirmesh Kumar" (a shared surname alone isn't enough).
    const cInR = cTokens.every((t) => rSet.has(t));
    const rInC = rTokens.every((t) => cSet.has(t));
    if (!cInR && !rInC) continue;
    const overlap = cTokens.filter((t) => rSet.has(t)).length;
    const score = overlap + (r.degree === '1st' ? 0.5 : 0); // prefer a 1st-degree connection on ties
    if (score > bestScore) { bestScore = score; best = r.url.split('?')[0]; }
  }
  return best;
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

export default function OutreachCopilot({ campaign, onClose }: { campaign: OutreachCampaign; onClose: () => void }) {
  const [contacts, setContacts] = useState<OutreachContact[]>(
    campaign.contacts.map((c) => ({ ...c, status: c.status || 'todo' })));
  const [idx, setIdx] = useState(() => firstUndoneIdx(campaign.contacts));
  const [copied, setCopied] = useState<'msg' | 'email' | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openNote, setOpenNote] = useState('');
  // True once we've opened a chat for this session — the browser window is now the user's
  // workspace, so it must not be auto-closed under them by a background run finishing.
  const [browserOpen, setBrowserOpen] = useState(false);

  // Release the hold if the copilot goes away for any reason (Done, Esc, unmount) — otherwise the
  // browser could never be auto-closed again for the rest of the session.
  useEffect(() => () => { setAgentBrowserHold(false); }, []);

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

  function setStatus(s: OutreachStatus) {
    setContacts((prev) => prev.map((c, i) => (i === idx ? { ...c, status: s } : c)));
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

  // One click: copy the message AND drive the ADRIS browser to open this person's chat box
  // (opens their profile + clicks "Message"). The user just pastes (Ctrl+V) + sends — nothing is
  // auto-typed or auto-sent, so the account stays safe. Falls back to opening the profile.
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
      const res = await invoke<string>('run_browser_persistent', { args: `message "${targetUrl}"` });
      const savedNote = !hasProfile ? ' (Saved their profile link for next time.)' : '';
      if (typeof res === 'string' && res.includes('SIGN_IN_REQUIRED')) setOpenNote('Sign in to LinkedIn in the ADRIS browser window, then click again.');
      else if (typeof res === 'string' && res.includes('MESSAGE_BOX_OPENED')) setOpenNote(`Chat box is open and focused in the ADRIS browser — paste (Ctrl+V) and send, then mark them Sent below.${savedNote}`);
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
            <div className="text-[10px] text-nv-faint truncate">{contacts.length} contacts · you paste &amp; send</div>
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
                  ? <><span className="w-3 h-3 rounded-full border border-white/40 border-t-white animate-spin" /> Opening chat…</>
                  : <><svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg> Copy message &amp; open chat</>}
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
