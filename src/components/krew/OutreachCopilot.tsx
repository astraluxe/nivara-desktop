import { useState, useEffect, useMemo } from 'react';
import { brain } from '../../lib/knowledgeStore';

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

const STATUS_META: Record<OutreachStatus, { label: string; cls: string }> = {
  todo:     { label: 'To do',            cls: 'border-white/20 text-faint' },
  connect:  { label: 'Connect requested', cls: 'border-amber-400/50 text-amber-300 bg-amber-400/10' },
  sent:     { label: 'Message sent',      cls: 'border-sky-400/50 text-sky-300 bg-sky-400/10' },
  accepted: { label: 'Accepted',          cls: 'border-emerald-400/50 text-emerald-300 bg-emerald-400/10' },
  replied:  { label: 'Replied',           cls: 'border-violet-400/50 text-violet-300 bg-violet-400/10' },
  skip:     { label: 'Skipped',           cls: 'border-white/15 text-faint/60 line-through' },
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
  if (c.linkedin_url && /linkedin\.com/i.test(c.linkedin_url)) return c.linkedin_url;
  // No profile URL saved → open a LinkedIn people-search for their name + company so the
  // user lands on (or one click from) the right person instead of a dead link.
  const q = encodeURIComponent([c.name, c.company].filter(Boolean).join(' '));
  return `https://www.linkedin.com/search/results/people/?keywords=${q}`;
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
}

export function loadSavedCampaign(): OutreachCampaign | null {
  try {
    const r = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (r && Array.isArray(r.contacts) && r.contacts.length) return r as OutreachCampaign;
  } catch { /* ignore */ }
  return null;
}

export default function OutreachCopilot({ campaign, onClose }: { campaign: OutreachCampaign; onClose: () => void }) {
  const [contacts, setContacts] = useState<OutreachContact[]>(
    campaign.contacts.map((c) => ({ ...c, status: c.status || 'todo' })));
  const [idx, setIdx] = useState(0);
  const [copied, setCopied] = useState<'msg' | 'email' | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openNote, setOpenNote] = useState('');

  const cur = contacts[idx];
  const channel = campaign.channel || 'linkedin';

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
    await copyText(msg);
    setCopied('msg'); setTimeout(() => setCopied((c) => (c === 'msg' ? null : c)), 1600);
    setOpening(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      // No saved profile URL for this person → open a LinkedIn people-search in the ADRIS browser
      // (not the default browser), so the user finds them and hits Message there.
      if (!hasProfile) {
        try { await invoke('run_browser_persistent', { args: `open "${profileUrl(cur)}"` }); }
        catch { openLink(profileUrl(cur)); }
        setOpenNote('Opened a LinkedIn search in the ADRIS browser — click the right person, hit Message, then paste (Ctrl+V).');
        return;
      }
      const res = await invoke<string>('run_browser_persistent', { args: `message "${cur.linkedin_url}"` });
      if (typeof res === 'string' && res.includes('SIGN_IN_REQUIRED')) setOpenNote('Sign in to LinkedIn in the ADRIS browser window, then click again.');
      else if (typeof res === 'string' && res.includes('MESSAGE_BOX_OPENED')) setOpenNote('Chat box is open in the ADRIS browser — paste (Ctrl+V) and send.');
      else setOpenNote('Opened their profile in the ADRIS browser — click Message, then paste & send. (If you\'re not connected yet, send a connection request first.)');
    } catch {
      openLink(profileUrl(cur));
      setOpenNote('Opened their profile in your browser — click Message and paste.');
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-end bg-black/40 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="w-full max-w-md h-full bg-panel border-l border-white/10 shadow-2xl flex flex-col animate-[slidein_.18s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2 shrink-0">
          <svg viewBox="0 0 24 24" className="w-4 h-4 text-accent shrink-0" fill="currentColor"><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45z"/></svg>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold truncate">Outreach copilot</div>
            <div className="text-[10px] text-faint truncate">{contacts.length} contacts · you paste &amp; send</div>
          </div>
          <button onClick={onClose} className="text-faint hover:text-fg p-1 rounded" title="Close">
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
            <p className="text-[10px] text-faint mt-1.5 leading-relaxed">
              LinkedIn's rules forbid automated messaging and connecting — accounts that auto-DM get
              restricted or banned, which would wreck your reputation right when you're winning clients.
              So adris does everything around it (writes each message, opens the right profile, tracks who
              accepted) and you do the one safe step: paste &amp; send. It takes ~2 seconds each.
            </p>
          )}
        </div>

        {/* Progress strip */}
        <div className="px-4 py-2 flex items-center gap-1.5 text-[10px] border-b border-white/5 shrink-0 overflow-x-auto">
          <span className="text-faint">Progress:</span>
          <span className="text-sky-300">{progress.sent} sent</span>
          <span className="text-faint">·</span>
          <span className="text-emerald-300">{progress.accepted} accepted</span>
          <span className="text-faint">·</span>
          <span className="text-violet-300">{progress.replied} replied</span>
        </div>

        {/* Current contact */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <div className="flex items-baseline justify-between">
            <div className="text-[10px] text-faint font-mono">Contact {idx + 1} of {contacts.length}</div>
            <span className={`text-[9.5px] px-1.5 py-0.5 rounded border ${STATUS_META[cur.status || 'todo'].cls}`}>
              {STATUS_META[cur.status || 'todo'].label}
            </span>
          </div>
          <div>
            <div className="text-sm font-semibold">{cur.name || 'Unknown contact'}</div>
            {cur.company && <div className="text-xs text-faint">{cur.company}</div>}
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
                className="w-full text-[10.5px] px-3 py-1 rounded-lg border border-white/15 text-faint hover:bg-white/5 transition-fast"
              >
                {hasProfile ? 'Just open their profile' : 'Find them on LinkedIn'}
              </button>
              {openNote && <p className="text-[10px] text-emerald-300/90 leading-relaxed">{openNote}</p>}
            </div>
          )}

          {/* The message to paste */}
          {(channel === 'linkedin' || channel === 'both') && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] text-faint uppercase tracking-wide">LinkedIn message</div>
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
                className="w-full text-xs bg-black/20 border border-white/10 rounded-lg p-2.5 leading-relaxed resize-none focus:outline-none focus:border-accent/40 select-text"
                placeholder="No message drafted for this contact yet — type one, or ask Krew to draft it."
              />
              <p className="text-[9.5px] text-faint mt-1">
                Not connected yet? Send a connection request with a short note first (free accounts can only
                message 1st-degree connections). Mark <b>Connect requested</b> below, then come back once they accept.
              </p>
            </div>
          )}

          {/* Email secondary action */}
          {cur.email && (channel === 'email' || channel === 'both') && (
            <div className="pt-1 border-t border-white/5">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] text-faint uppercase tracking-wide">Email · {cur.email}</div>
                <button onClick={() => doCopy('email')} className={`text-[10px] px-2 py-1 rounded-md border transition-fast ${copied === 'email' ? 'border-emerald-400/50 text-emerald-300 bg-emerald-400/10' : 'border-white/20 text-faint hover:bg-white/5'}`}>
                  {copied === 'email' ? '✓ Copied' : 'Copy email'}
                </button>
              </div>
              <button onClick={() => openLink(gmailComposeUrl(cur))} className="w-full text-[11px] px-3 py-1.5 rounded-lg border border-white/15 text-faint hover:bg-white/5 transition-fast">
                Open in Gmail compose
              </button>
              {campaign.deckAttached && (
                <p className="text-[9.5px] text-faint mt-1">Tip: to auto-attach the deck PDF to every email, tell Krew "email these contacts with the deck attached" — it sends + attaches for you and reports who got it.</p>
              )}
            </div>
          )}

          {/* Status */}
          <div>
            <div className="text-[10px] text-faint uppercase tracking-wide mb-1.5">After you send, mark it</div>
            <div className="flex flex-wrap gap-1.5">
              {(['connect', 'sent', 'accepted', 'replied', 'skip'] as OutreachStatus[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(cur.status === s ? 'todo' : s)}
                  className={`text-[10px] px-2 py-1 rounded-md border transition-fast ${cur.status === s ? STATUS_META[s].cls : 'border-white/15 text-faint hover:bg-white/5'}`}
                >
                  {STATUS_META[s].label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Nav */}
        <div className="px-4 py-3 border-t border-white/10 flex items-center gap-2 shrink-0">
          <button onClick={() => go(-1)} disabled={idx === 0} className="text-xs px-3 py-1.5 rounded-lg border border-white/15 text-faint hover:bg-white/5 disabled:opacity-30 transition-fast">← Prev</button>
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
