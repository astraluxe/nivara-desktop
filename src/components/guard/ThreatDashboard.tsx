import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { guardDb, type GuardEvent, type GuardStats } from '../../lib/guardDb';
import { credentialStore } from '../../lib/krewDb';
import { callAutomationAI } from '../../lib/automationRunner';
import { isWatchEnabled, setWatchEnabled, runWatchCycle, lastRunAt,
         parseEmailBlocks, triageEmail, AI_THRESHOLD, SEVERITY_MEANING } from '../../lib/guardWatch';

const SEV: Record<string, { text: string; bg: string; border: string }> = {
  low:  { text: 'text-nv-ok',   bg: 'bg-emerald-500/10', border: 'border-emerald-500/25' },
  med:  { text: 'text-nv-warn', bg: 'bg-amber-400/10',   border: 'border-amber-400/25'   },
  high: { text: 'text-nv-bad',  bg: 'bg-red-500/10',     border: 'border-red-500/25'     },
  crit: { text: 'text-nv-bad',  bg: 'bg-red-600/20',     border: 'border-red-600/40'     },
};

const TYPE_LABEL: Record<string, string> = {
  contract_scan:     'Contract scan',
  phishing_detected: 'Phishing detected',
  suspicious_login:  'Suspicious login',
  cve_found:         'CVE found',
  compliance_check:  'Compliance check',
  malicious_domain:  'Malicious domain',
};

// Crisp monochrome line icons (enterprise look — no emoji).
function TypeIcon({ type, className = '' }: { type: string; className?: string }) {
  const p = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, className };
  switch (type) {
    case 'contract_scan':
      return <svg {...p}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/></svg>;
    case 'phishing_detected':
      return <svg {...p}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>;
    case 'suspicious_login':
      return <svg {...p}><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 019.9-1"/></svg>;
    case 'cve_found':
      return <svg {...p}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v3M11 14h.01"/></svg>;
    case 'compliance_check':
      return <svg {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>;
    case 'malicious_domain':
      return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8M3 12h18"/></svg>;
    default:
      return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>;
  }
}

function EventRow({ ev, onDelete }: { ev: GuardEvent; onDelete: (id: string) => void }) {
  const s    = SEV[ev.severity] ?? SEV.low;
  const ts   = new Date(ev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const date = new Date(ev.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' });
  const [copied, setCopied] = useState(false);

  // metadata carries the analyst's reason and the local signals that escalated the message.
  const meta = (() => {
    try { return JSON.parse(ev.metadata ?? '{}') as { reason?: string; signals?: string[] }; }
    catch { return {}; }
  })();
  const reason  = (meta.reason ?? '').trim();
  const signals = Array.isArray(meta.signals) ? meta.signals.slice(0, 4) : [];

  function copyText() {
    const txt = `[${ev.severity.toUpperCase()}] ${TYPE_LABEL[ev.event_type] ?? ev.event_type}\n${ev.description}`
      + (reason ? `\nWhy: ${reason}` : '')
      + (signals.length ? `\nSignals: ${signals.join(', ')}` : '')
      + `\n${date} ${ts}`;
    navigator.clipboard.writeText(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="group flex items-start gap-3 p-3 border-b border-nv-border/50 last:border-0 hover:bg-nv-surface2 transition-fast">
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${s.bg} border ${s.border} ${s.text}`}>
        <TypeIcon type={ev.event_type} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[11px] font-medium text-nv-text truncate">{ev.description}</span>
        </div>
        {/* Why this was flagged. A severity badge with no explanation reads as arbitrary — the
            reason is already stored on the event, it just was not being shown. */}
        {reason && <p className="text-[10.5px] text-nv-muted leading-relaxed mb-1 break-words">{reason}</p>}
        {signals.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1">
            {signals.map((sg) => (
              <span key={sg} className="text-[9px] px-1.5 py-0.5 rounded-md border border-nv-border text-nv-faint">{sg}</span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-nv-faint">{TYPE_LABEL[ev.event_type] ?? ev.event_type}</span>
          <span className="text-[9px] text-nv-faint opacity-40">·</span>
          <span className="text-[9px] font-mono text-nv-faint">{date} {ts}</span>
        </div>
      </div>
      {/* Row actions — visible on hover */}
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-fast">
        <button
          onClick={copyText}
          title="Copy"
          className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-nv-border text-nv-faint hover:text-accent hover:border-accent/30 transition-fast"
        >
          {copied ? '✓' : 'Copy'}
        </button>
        <button
          onClick={() => onDelete(ev.id)}
          title="Delete"
          className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-nv-border text-nv-faint hover:text-nv-bad hover:border-red-500/30 transition-fast"
        >
          ✕
        </button>
      </div>
      <span
        title={SEVERITY_MEANING[ev.severity] ?? ''}
        className={`text-[9px] font-mono font-semibold px-2 py-0.5 rounded-full border shrink-0 cursor-help ${s.text} ${s.bg} ${s.border}`}
      >
        {ev.severity.toUpperCase()}
      </span>
    </div>
  );
}

function PostureGauge({ score }: { score: number }) {
  const isClean = score === 0;
  const isMed   = score > 0 && score < 50;
  const col     = isClean ? 'var(--nv-ok)' : isMed ? 'var(--nv-warn)' : 'var(--nv-bad)';
  const label   = isClean ? 'SECURE' : isMed ? 'MONITORING' : 'AT RISK';
  const sub     = isClean ? 'No active threats' : isMed ? 'Low-level activity observed' : 'Review required';
  const r = 46, circ = 2 * Math.PI * r;
  const dash = (Math.min(score, 100) / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative flex items-center justify-center w-32 h-32">
        <svg width="128" height="128" className="-rotate-90">
          <circle cx="64" cy="64" r={r} fill="none" stroke="var(--nv-surface2)" strokeWidth="6" />
          <circle cx="64" cy="64" r={r} fill="none" stroke={col} strokeWidth="6" strokeLinecap="round"
            strokeDasharray={`${dash} ${circ}`} style={{ transition: 'stroke-dasharray 0.9s ease' }} />
        </svg>
        <div className="absolute flex flex-col items-center">
          <span className="text-[34px] font-bold font-mono leading-none" style={{ color: col }}>{score}</span>
          <span className="text-[8px] font-mono tracking-[0.2em] mt-1 text-nv-faint">RISK INDEX</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full" style={{ background: col,
          animation: isClean ? 'nv-breathe 3s ease-in-out infinite' : 'nv-ping-fade 1.5s ease-in-out infinite' }} />
        <span className="text-[11px] font-bold font-mono tracking-[0.18em]" style={{ color: col }}>{label}</span>
      </div>
      <p className="text-[9px] text-nv-faint font-mono">{sub}</p>
    </div>
  );
}

function StatCard({ value, label, color, icon }: { value: number; label: string; color: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-nv-bg border border-nv-border">
      <span className={`${color} shrink-0`}>{icon}</span>
      <div className="min-w-0">
        <p className={`text-xl font-bold font-mono leading-none ${color}`}>{value}</p>
        <p className="text-[9px] font-mono text-nv-faint mt-0.5 truncate">{label}</p>
      </div>
    </div>
  );
}

export default function ThreatDashboard({ onScanRun }: { onScanRun?: () => void }) {
  const [stats,      setStats]      = useState<GuardStats | null>(null);
  const [events,     setEvents]     = useState<GuardEvent[]>([]);
  const [scanning,   setScanning]   = useState(false);
  const [scanMsg,    setScanMsg]    = useState('');
  const [scanErr,    setScanErr]    = useState('');
  const [watchOn,    setWatchOn]    = useState(isWatchEnabled);
  const [clearing,   setClearing]   = useState(false);

  const reload = useCallback(async () => {
    const [s, e] = await Promise.all([guardDb.stats(), guardDb.events(60)]);
    setStats(s);
    setEvents(e);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function deleteEvent(id: string) {
    await guardDb.deleteEvent(id).catch(() => {});
    setEvents(prev => prev.filter(e => e.id !== id));
    const s = await guardDb.stats().catch(() => null);
    if (s) setStats(s);
  }

  async function clearAll() {
    if (!window.confirm('Delete all Guard audit log entries? This cannot be undone.')) return;
    setClearing(true);
    await guardDb.clearAll().catch(() => {});
    setClearing(false);
    await reload();
  }

  const riskScore = stats
    ? Math.min(100, (stats.threats * 12) + (stats.phishing_detected * 8) + (stats.cve_found * 6))
    : 0;

  async function scanInbox() {
    onScanRun?.();
    setScanning(true);
    setScanMsg('');
    setScanErr('');
    try {
      const creds = await credentialStore.get('gmail').catch(() => null);
      if (!creds?.email || !creds?.app_password) {
        setScanErr('Gmail is not connected yet. Open Connect Apps, add your Gmail address and an app password, then run the scan again.');
        return;
      }
      setScanMsg('Fetching emails…');
      // gmail_fetch_emails takes `query`/`limit` (this passed `filter`/`maxCount`, so every scan
      // failed with "missing required key query") and returns FORMATTED TEXT, not an array — the
      // old code called .length on a string and then iterated it one character at a time.
      const raw = await invoke<string>('gmail_fetch_emails', {
        email:       creds.email,
        appPassword: creds.app_password,
        query:       'ALL',
        limit:       20,
      });
      const emails = parseEmailBlocks(raw);
      if (!emails.length) { setScanMsg('No emails found in your inbox to scan.'); return; }

      // Same local triage the background watch uses. This button had its OWN copy of the pipeline
      // with no MIME decoding and no triage, so it sent every message to the model and judged
      // base64 subjects — which is how routine transactional mail (payment receipts, UPI alerts,
      // a job-application reply) came back as HIGH-severity phishing.
      const worthChecking = emails.filter((em) => triageEmail(em).score >= AI_THRESHOLD);
      if (!worthChecking.length) {
        setScanMsg(`✓ Inbox clear — ${emails.length} messages checked, none suspicious`);
        await reload();
        return;
      }

      setScanMsg(`Analyzing ${worthChecking.length} of ${emails.length} emails…`);
      let found = 0;
      for (const em of worthChecking) {
        try {
          const raw = await callAutomationAI(
            `Subject: ${em.subject}\nFrom: ${em.from}\nPreview: ${em.snippet}\n\nReturn ONLY JSON: {"is_phishing": true/false, "severity": "low"|"med"|"high", "reason": "<one sentence>"}`,
            'You are a cautious security analyst. Flag ONLY genuine phishing: credential harvesting, spoofed or lookalike senders, and payment redirection. Transactional and promotional mail from a real company — receipts, payment or UPI alerts, statements, job replies, newsletters, offers — is NOT phishing even when urgent. When unsure, answer false. Respond only with valid JSON.'
          );
          const cleanedThreat = raw.replace(/```json|```/g, '').trim();
          const jsonMatchThreat = cleanedThreat.match(/\{[\s\S]*\}/);
          if (!jsonMatchThreat) throw new Error('No JSON');
          const result = JSON.parse(jsonMatchThreat[0]);
          if (result.is_phishing) {
            await guardDb.log('phishing_detected', result.severity ?? 'med',
              `Phishing · ${em.from} · ${em.subject}`,
              { from: em.from, subject: em.subject, reason: result.reason,
                signals: triageEmail(em).signals });
            found++;
          }
        } catch { }
      }
      setScanMsg(found > 0 ? `⚠ Found ${found} suspicious email${found > 1 ? 's' : ''}` : `✓ Inbox clear — ${emails.length} messages checked`);
      await reload();
    } catch (e) {
      setScanErr(`Scan failed: ${e}`);
    } finally {
      setScanning(false);
    }
  }

  const high = events.filter(e => e.severity === 'high' || e.severity === 'crit').length;
  const med  = events.filter(e => e.severity === 'med').length;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-nv-bg relative">

      {/* Radar grid background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden style={{ opacity: 0.028 }}>
        <svg viewBox="0 0 900 600" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
          <g stroke="var(--nv-bad)" fill="none" strokeWidth="1">
            <circle cx="150" cy="300" r="60"/>
            <circle cx="150" cy="300" r="120"/>
            <circle cx="150" cy="300" r="180"/>
            <circle cx="150" cy="300" r="240"/>
            <line x1="150" y1="60"  x2="150" y2="540"/>
            <line x1="-90" y1="300" x2="390" y2="300"/>
          </g>
          <path d="M150 300 L150 120 A180 180 0 0 1 305 435 Z"
            fill="var(--nv-bad)" opacity="0.35"
            style={{ transformOrigin: '150px 300px', animation: 'nv-radar-sweep 5s linear infinite' }} />
        </svg>
      </div>

      <div className="relative z-10 flex gap-0 h-full">

        {/* Left panel — threat status */}
        <div className="flex flex-col gap-4 w-[260px] shrink-0 border-r border-nv-border p-5 overflow-y-auto">

          <PostureGauge score={riskScore} />

          {/* Source note */}
          <p className="text-[9px] font-mono text-nv-faint text-center leading-relaxed px-1">
            Score reflects your Guard activity log — compliance scans, phishing checks, CVE searches.
            <br/>Not a live system scan.
          </p>

          {/* Severity bar */}
          {events.length > 0 && (
            <div className="flex gap-1.5 items-center justify-center flex-wrap">
              {high > 0 && <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-red-500/15 text-nv-bad border border-red-500/25">{high} high severity</span>}
              {med > 0  && <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-400/15 text-nv-warn border border-amber-400/25">{med} warning</span>}
            </div>
          )}

          <div className="border-t border-nv-border" />

          {/* Stat grid */}
          <div className="grid grid-cols-2 gap-2">
            <StatCard value={stats?.threats ?? 0} label="High threats" color="text-nv-bad"
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>} />
            <StatCard value={stats?.phishing_detected ?? 0} label="Phishing" color="text-nv-warn"
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4l4 4m0 0l4-4m-4 4v8m0 0H4m4 0h8m4-8v8m0-8l-4 4m0 0l-4-4"/></svg>} />
            <StatCard value={stats?.cve_found ?? 0} label="CVEs found" color="text-nv-info"
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>} />
            <StatCard value={stats?.contract_scans ?? 0} label="Contracts" color="text-violet-400"
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>} />
          </div>

          <div className="border-t border-nv-border" />

          {/* Inbox scan */}
          <div className="flex flex-col gap-2">
            <p className="text-[9px] font-mono text-nv-faint tracking-widest uppercase">Quick Actions</p>
            <button
              onClick={scanInbox}
              disabled={scanning}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-mono bg-nv-surface border border-nv-border hover:border-accent/40 hover:bg-accent/5 disabled:opacity-50 transition-fast text-nv-text"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={scanning ? 'text-accent' : 'text-nv-faint'}>
                {scanning
                  ? <path d="M21 12a9 9 0 1 1-6.219-8.56" className="origin-center" style={{ animation: 'spin 1s linear infinite' }}/>
                  : <><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M2 7l10 7 10-7"/></>
                }
              </svg>
              {scanning ? 'Scanning inbox…' : 'Scan inbox for phishing'}
            </button>
            {scanMsg && <p className={`text-[10px] font-mono px-2 py-1 rounded-lg ${scanMsg.startsWith('⚠') ? 'text-nv-warn bg-amber-400/8 border border-amber-400/20' : 'text-nv-ok bg-emerald-500/8 border border-emerald-500/20'}`}>{scanMsg}</p>}
            {scanErr && <p className="text-[10px] font-mono text-nv-bad px-2 py-1 rounded-lg bg-red-500/8 border border-red-500/20">{scanErr}</p>}

            {/* Continuous watch — the thing the website actually promises ("Guard checks what
                arrives"). Manual scanning alone never delivered that. */}
            <div className="mt-1 rounded-xl border border-nv-border bg-nv-surface p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[11.5px] font-medium text-nv-text">Watch my inbox</p>
                  <p className="text-[10.5px] text-nv-muted leading-relaxed mt-0.5">
                    Checks new mail every 10 minutes while adris.tech is open and warns you the moment
                    something looks like phishing. Each message is judged once.
                  </p>
                </div>
                <button
                  onClick={() => { setWatchEnabled(!watchOn); setWatchOn(!watchOn); }}
                  role="switch"
                  aria-checked={watchOn}
                  className={`relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200 ${watchOn ? 'bg-accent' : 'bg-nv-surface2'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${watchOn ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>
              {watchOn && (
                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-nv-border/60">
                  <span className="text-[10px] text-nv-faint font-mono">
                    {lastRunAt() ? `last checked ${new Date(lastRunAt()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'first check shortly after launch'}
                  </span>
                  <button
                    onClick={async () => { setScanMsg('Checking new mail…'); const n = await runWatchCycle(); setScanMsg(n > 0 ? `⚠ ${n} new suspicious email${n > 1 ? 's' : ''}` : '✓ Nothing suspicious in new mail'); reload(); }}
                    className="ml-auto text-[10px] text-accent hover:underline shrink-0"
                  >
                    Check now
                  </button>
                </div>
              )}
              {watchOn && (
                <div className="mt-2 pt-2 border-t border-nv-border/60">
                  <p className="text-[10.5px] text-nv-muted leading-relaxed">
                    Routine checks cost you nothing: every message is first judged by rules running on this
                    machine, and only genuinely suspicious mail is sent to the AI. Ordinary newsletters,
                    offers and statements never reach a model.
                  </p>
                  <button
                    onClick={async () => {
                      setScanMsg('Deep scan — reading every new message with AI…');
                      const n = await runWatchCycle(true);
                      setScanMsg(n > 0 ? `⚠ ${n} suspicious email${n > 1 ? 's' : ''} found` : '✓ Deep scan clear');
                      reload();
                    }}
                    className="mt-1.5 text-[10px] text-nv-muted hover:text-accent transition-fast underline underline-offset-2"
                  >
                    Run a deep scan instead — sends every new message to the AI (uses tokens)
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex-1" />
          <p className="text-[8px] font-mono text-nv-faint text-center opacity-50">
            Tamper-evident audit log · SQLite
          </p>
        </div>

        {/* Right panel — live feed */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-nv-border shrink-0 bg-nv-surface">
            <div className="flex items-center gap-2.5">
              <span className="w-1.5 h-1.5 rounded-full bg-nv-ok" style={{ animation: 'nv-breathe 2.5s ease-in-out infinite' }} />
              <span className="text-[10px] font-mono text-nv-faint tracking-widest">GUARD ACTIVITY LOG</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-nv-faint">{events.length} records</span>
              <button
                onClick={reload}
                className="flex items-center gap-1 text-[10px] font-mono text-nv-faint hover:text-accent transition-fast"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.41"/></svg>
                Refresh
              </button>
              {events.length > 0 && (
                <button
                  onClick={clearAll}
                  disabled={clearing}
                  className="text-[10px] font-mono text-nv-faint hover:text-nv-bad transition-fast disabled:opacity-40"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>

          {events.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-4 text-nv-faint p-8">
              <div className="w-16 h-16 rounded-2xl border border-nv-border bg-nv-surface flex items-center justify-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                  <path d="M12 2 3 6v7c0 5 3.9 9.3 9 10 5.1-.7 9-5 9-10V6z"/>
                  <path d="M9 12l2 2 4-4"/>
                </svg>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-nv-text mb-1">No events recorded yet</p>
                <p className="text-xs text-nv-faint max-w-[280px] leading-relaxed">
                  Scan your inbox for phishing, upload a contract, or run a vulnerability check — all events appear here with a tamper-evident audit trail.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3 w-full max-w-sm mt-2">
                {[
                  { type: 'phishing_detected', label: 'Inbox Scan', desc: 'Phishing detection' },
                  { type: 'contract_scan',     label: 'Contract',   desc: 'Risk analysis' },
                  { type: 'cve_found',         label: 'Vulns',      desc: 'CVE scanner' },
                ].map(a => (
                  <div key={a.label} className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-nv-surface border border-nv-border text-center">
                    <span className="w-8 h-8 rounded-lg bg-nv-bg border border-nv-border flex items-center justify-center text-nv-muted">
                      <TypeIcon type={a.type} />
                    </span>
                    <p className="text-[10px] font-medium text-nv-text">{a.label}</p>
                    <p className="text-[9px] text-nv-faint">{a.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {events.map(ev => <EventRow key={ev.id} ev={ev} onDelete={deleteEvent} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
