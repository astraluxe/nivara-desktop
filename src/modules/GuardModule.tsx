import { useState, useEffect, useCallback } from 'react';
import ThreatDashboard  from '../components/guard/ThreatDashboard';
import ContractScanner  from '../components/guard/ContractScanner';
import VulnBriefing     from '../components/guard/VulnBriefing';
import ComplianceChecker from '../components/guard/ComplianceChecker';
import { useAuth } from '../contexts/AuthContext';
import { getPlanConfig } from '../lib/planConfig';

// ── Guard usage tracking (solo plan monthly limit) ────────────────────────────
const GUARD_USE_KEY = () => `nv-guard-uses-${new Date().toISOString().slice(0, 7)}`;

export function getGuardUsesThisMonth(): number {
  try { return parseInt(localStorage.getItem(GUARD_USE_KEY()) ?? '0'); } catch { return 0; }
}

export function incrementGuardUse(): void {
  try { localStorage.setItem(GUARD_USE_KEY(), String(getGuardUsesThisMonth() + 1)); } catch {}
}

type Tab = 'dashboard' | 'contract' | 'vulns' | 'compliance';

const TABS: { id: Tab; label: string; sub: string; icon: React.ReactNode }[] = [
  {
    id: 'dashboard', label: 'Threat Monitor', sub: 'Live · Inbox',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2 3 6v7c0 5 3.9 9.3 9 10 5.1-.7 9-5 9-10V6z"/>
        <path d="M9 12l2 2 4-4"/>
      </svg>
    ),
  },
  {
    id: 'contract', label: 'Contract Scanner', sub: 'AI Risk Analysis',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
        <path d="M14 2v6h6M10 13h4M10 17h4M10 9h1"/>
      </svg>
    ),
  },
  {
    id: 'vulns', label: 'Vulnerabilities', sub: 'GitHub · CVE',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
      </svg>
    ),
  },
  {
    id: 'compliance', label: 'Compliance', sub: 'GDPR · DPDP · PCI',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
      </svg>
    ),
  },
];

function UpgradeWall({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 p-8 text-center">
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-accent/10">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
          <path d="M12 2 3 6v7c0 5 3.9 9.3 9 10 5.1-.7 9-5 9-10V6z"/>
          <path d="M9 12l2 2 4-4"/>
        </svg>
      </div>
      <div>
        <p className="text-[16px] font-semibold text-nv-text tracking-tight">{title}</p>
        <p className="text-[12px] text-nv-muted mt-1.5 max-w-xs leading-relaxed">{body}</p>
      </div>
      <a
        href="https://adris.tech/pricing"
        target="_blank"
        rel="noreferrer"
        className="px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
        style={{ background: 'var(--accent)' }}
      >
        Upgrade to Builder →
      </a>
    </div>
  );
}

export default function GuardModule() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [usesThisMonth, setUsesThisMonth] = useState(getGuardUsesThisMonth);
  const { profile } = useAuth();
  const planCfg = getPlanConfig(profile?.plan ?? 'free');
  const limit = planCfg.guardLimit;
  const isSoloLimited = planCfg.guardAccess && limit !== null;

  // Count one use when Guard is first opened each session
  useEffect(() => {
    if (!planCfg.guardAccess || limit === null) return;
    const sessionKey = 'nv-guard-session-counted';
    if (!sessionStorage.getItem(sessionKey)) {
      sessionStorage.setItem(sessionKey, '1');
      incrementGuardUse();
      setUsesThisMonth(getGuardUsesThisMonth());
    }
  }, [planCfg.guardAccess, limit]);

  const onScanRun = useCallback(() => {
    if (limit === null) return;
    incrementGuardUse();
    setUsesThisMonth(getGuardUsesThisMonth());
  }, [limit]);

  if (!planCfg.guardAccess) {
    return (
      <UpgradeWall
        title="Guard is on Builder+"
        body="Contract scanning, threat monitoring, and compliance checks are available on the Builder plan and above."
      />
    );
  }

  if (isSoloLimited && usesThisMonth > limit!) {
    return (
      <UpgradeWall
        title="You've used all 10 Guard scans this month"
        body="Upgrade to Builder to get unlimited Guard access — contract scanning, compliance checks, and threat monitoring with no monthly cap."
      />
    );
  }

  const usesLeft = isSoloLimited ? Math.max(0, limit! - usesThisMonth + 1) : null;

  return (
    <div className="flex flex-col h-full bg-nv-bg">
      {/* Tab bar */}
      <div className="flex items-stretch border-b border-nv-border px-3 shrink-0 bg-nv-surface">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 border-b-2 transition-fast group ${
              tab === t.id
                ? 'text-accent border-accent bg-accent/5'
                : 'text-nv-muted border-transparent hover:text-nv-text hover:border-nv-border'
            }`}
          >
            <span className={tab === t.id ? 'text-accent' : 'text-nv-faint group-hover:text-nv-muted'}>
              {t.icon}
            </span>
            <div className="flex flex-col items-start">
              <span className="text-[11px] font-medium leading-tight">{t.label}</span>
              <span className="text-[9px] font-mono opacity-60 leading-tight">{t.sub}</span>
            </div>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3 pr-3">
          {usesLeft !== null && (
            <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full border ${
              usesLeft <= 2 ? 'text-nv-bad border-nv-bad/40 bg-nv-bad/10' : 'text-nv-faint border-nv-border'
            }`}>
              {usesLeft}/{limit} left · <a href="https://adris.tech/pricing" target="_blank" rel="noreferrer" className="underline hover:text-accent">upgrade</a>
            </span>
          )}
          <span className="text-[9px] font-mono text-nv-faint tracking-widest uppercase">Guard · Security Suite</span>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden relative">
        {tab === 'dashboard'  && <ThreatDashboard onScanRun={onScanRun} />}
        {tab === 'contract'   && <ContractScanner onScanRun={onScanRun} />}
        {tab === 'vulns'      && <VulnBriefing />}
        {tab === 'compliance' && <ComplianceChecker onScanRun={onScanRun} />}
      </div>
    </div>
  );
}
