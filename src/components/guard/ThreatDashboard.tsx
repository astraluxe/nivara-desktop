import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { guardDb, type GuardEvent, type GuardStats } from '../../lib/guardDb';
import { credentialStore } from '../../lib/krewDb';
import { callAutomationAI } from '../../lib/automationRunner';

const SEV: Record<string, { text: string; bg: string; border: string }> = {
  low:  { text: 'text-nv-ok',   bg: 'bg-emerald-500/10', border: 'border-emerald-500/25' },
  med:  { text: 'text-nv-warn', bg: 'bg-amber-400/10',   border: 'border-amber-400/25'   },
  high: { text: 'text-nv-bad',  bg: 'bg-red-500/10',     border: 'border-red-500/25'     },
  crit: { text: 'text-nv-bad',  bg: 'bg-red-600/20',     border: 'border-red-600/40'     },
};

const TYPE_ICON: Record<string, string> = {
  contract_scan:     '📄',
  phishing_detected: '🎣',
  suspicious_login:  '🔐',
  cve_found:         '🔎',
  compliance_check:  '✅',
  malicious_domain:  '🚫',
};

const TYPE_LABEL: Record<string, string> = {
  contract_scan:     'Contract scan',
  phishing_detected: 'Phishing detected',
  suspicious_login:  'Suspicious login',
  cve_found:         'CVE found',
  compliance_check:  'Compliance check',
  malicious_domain:  'Malicious domain',
};

function EventRow({ ev, onDelete }: { ev: GuardEvent; onDelete: (id: string) => void }) {
  const s    = SEV[ev.severity] ?? SEV.low;
  const ts   = new Date(ev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const date = new Date(ev.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' });
  const [copied, setCopied] = useState(false);

  function copyText() {
    const txt = `[${ev.severity.toUpperCase()}] ${TYPE_LABEL[ev.event_type] ?? ev.event_type}\n${ev.description}\n${date} ${ts}`;
    navigator.clipboard.writeText(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="group flex items-start gap-3 p-3 border-b border-nv-border/50 last:border-0 hover:bg-nv-surface2 transition-fast">
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-sm ${s.bg} border ${s.border}`}>
        {TYPE_ICON[ev.event_type] ?? '•'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[11px] font-medium text-nv-text truncate">{ev.description}</span>
        </div>
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
      <span className={`text-[9px] font-mono font-semibold px-2 py-0.5 rounded-full border shrink-0 ${s.text} ${s.bg} ${s.border}`}>
        {ev.severity.toUpperCase()}
      </span>
    </div>
  );
}

function ThreatOrb({ score }: { score: number }) {
  const isClean = score === 0;
  const isMed   = score > 0 && score < 50;
  const col     = isClean ? 'var(--nv-ok)' : isMed ? 'var(--nv-warn)' : 'var(--nv-bad)';
  const label   = isClean ? 'ALL CLEAR' : isMed ? 'MONITORING' : 'AT RISK';

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative flex items-center justify-center w-32 h-32">
        {/* Pulse rings — only when threats */}
        {!isClean && <>
          <div className="absolute inset-0 rounded-full" style={{ background: `${col}20`, animation: 'nv-pulse-ring 2.2s ease-out infinite' }} />
          <div className="absolute inset-0 rounded-full" style={{ background: `${col}15`, animation: 'nv-pulse-ring 2.2s ease-out 1.1s infinite' }} />
        </>}
        {/* Main orb */}
        <div className="relative w-24 h-24 rounded-full flex flex-col items-center justify-center"
          style={{
            background: `radial-gradient(circle at 35% 30%, ${col}18, ${col}06 70%)`,
            border: `1.5px solid ${col}50`,
            boxShadow: isClean ? `0 0 24px ${col}15` : `0 0 32px ${col}25`,
          }}>
          <span className="text-2xl font-bold font-mono leading-none" style={{ color: col }}>{score}</span>
          <span className="text-[8px] font-mono mt-0.5 tracking-widest" style={{ color: col, opacity: 0.65 }}>/ 100</span>
        </div>
        {/* Status dot */}
        <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-nv-surface"
          style={{ background: col, animation: isClean ? 'nv-breathe 3s ease-in-out infinite' : 'nv-ping-fade 1.5s ease-in-out infinite' }} />
      </div>
      <div className="text-center">
        <p className="text-[11px] font-bold font-mono tracking-[0.2em]" style={{ color: col }}>{label}</p>
        <p className="text-[9px] text-nv-faint font-mono mt-0.5">
          {isClean ? 'No threats detected' : score < 50 ? 'Low-level activity observed' : 'Review required'}
        </p>
      </div>
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
        setScanErr('Gmail not connected. Go to Connect Apps.');
        return;
      }
      setScanMsg('Fetching emails…');
      const emails = await invoke<{ subject: string; from: string; snippet: string }[]>(
        'gmail_fetch_emails',
        { email: creds.email, appPassword: creds.app_password, filter: '', maxCount: 20 }
      );
      if (!emails.length) { setScanMsg('No emails found.'); return; }

      setScanMsg(`Analyzing ${emails.length} emails…`);
      let found = 0;
      for (const em of emails) {
        try {
          const raw = await callAutomationAI(
            `Subject: ${em.subject}\nFrom: ${em.from}\nPreview: ${em.snippet}\n\nReturn ONLY JSON: {"is_phishing": true/false, "severity": "low"|"med"|"high", "reason": "<one sentence>"}`,
            'You are a cybersecurity analyst. Respond only with valid JSON.'
          );
          const cleanedThreat = raw.replace(/```json|```/g, '').trim();
          const jsonMatchThreat = cleanedThreat.match(/\{[\s\S]*\}/);
          if (!jsonMatchThreat) throw new Error('No JSON');
          const result = JSON.parse(jsonMatchThreat[0]);
          if (result.is_phishing) {
            await guardDb.log('phishing_detected', result.severity ?? 'med',
              `Phishing · ${em.from} · ${em.subject}`,
              { from: em.from, subject: em.subject, reason: result.reason });
            found++;
          }
        } catch { }
      }
      setScanMsg(found > 0 ? `⚠ Found ${found} suspicious email${found > 1 ? 's' : ''}` : '✓ Inbox clear — no phishing detected');
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

          <ThreatOrb score={riskScore} />

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
                  { icon: '🎣', label: 'Inbox Scan', desc: 'Phishing detection' },
                  { icon: '📄', label: 'Contract', desc: 'Risk analysis' },
                  { icon: '🔎', label: 'Vulns', desc: 'CVE scanner' },
                ].map(a => (
                  <div key={a.label} className="flex flex-col items-center gap-1 p-3 rounded-xl bg-nv-surface border border-nv-border text-center">
                    <span className="text-xl">{a.icon}</span>
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
