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

function UpgradeWall({ title, body, points }: { title: string; body: string; points?: string[] }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[520px] mx-auto px-7 py-14">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-accent/10 mb-5">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
            <path d="M12 2 3 6v7c0 5 3.9 9.3 9 10 5.1-.7 9-5 9-10V6z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        </div>
        <h1 className="nv-title mb-2.5">{title}</h1>
        <p className="nv-prose mb-5">{body}</p>
        {points && (
          <ul className="list-disc pl-5 mb-6">
            {points.map((p) => <li key={p} className="nv-prose mb-1.5">{p}</li>)}
          </ul>
        )}
        <a
          href="https://adris.tech/pricing"
          target="_blank"
          rel="noreferrer"
          className="inline-block px-5 py-2.5 rounded-xl text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: 'var(--accent)' }}
        >
          See plans
        </a>
      </div>
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
        title="Guard keeps an eye on the risky parts"
        body="Guard reads the documents and systems most likely to cost you money or trust, and tells you in plain language what to fix. It's available on Builder and above."
        points={[
          'Contract scanning — what a contract actually commits you to, and the clauses worth pushing back on.',
          'Threat monitoring — suspicious email and account activity, flagged before it becomes a problem.',
          'Dependency briefing — known vulnerabilities in the packages your project depends on.',
          'Compliance checks — whether your policy docs and config files say what they need to.',
        ]}
      />
    );
  }

  if (isSoloLimited && usesThisMonth > limit!) {
    return (
      <UpgradeWall
        title="You've used this month's Guard scans"
        body={`Your plan includes ${limit} scans a month and they're all used. The allowance resets at the start of next month, or Builder removes the cap entirely.`}
      />
    );
  }

  const usesLeft = isSoloLimited ? Math.max(0, limit! - usesThisMonth + 1) : null;

  return (
    <div className="flex flex-col h-full bg-nv-bg">
      {/* Page header — says what this module is for before showing four unexplained tabs */}
      <div className="px-5 pt-4 pb-3 border-b border-nv-border shrink-0">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="nv-eyebrow text-accent mb-1">Security</p>
            <h1 className="text-[18px] font-semibold text-nv-text leading-tight">Guard</h1>
            <p className="nv-prose-sm mt-1 max-w-[560px]">
              Reads your contracts, dependencies, inbox and config for the things that quietly cost you
              money or trust — and explains each finding in plain language.
            </p>
          </div>
          {usesLeft !== null && (
            <span className={`text-[10px] font-mono px-2 py-1 rounded-lg border shrink-0 ${
              usesLeft <= 2 ? 'text-nv-bad border-nv-bad/40 bg-nv-bad/10' : 'text-nv-muted border-nv-border'
            }`}>
              {usesLeft} of {limit} scans left
            </span>
          )}
        </div>
      </div>

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
              <span className="text-[12px] font-medium leading-tight">{t.label}</span>
              <span className="text-[10px] leading-tight opacity-70">{t.sub}</span>
            </div>
          </button>
        ))}
        {usesLeft !== null && usesLeft <= 2 && (
          <div className="ml-auto flex items-center pr-3">
            <a href="https://adris.tech/pricing" target="_blank" rel="noreferrer" className="text-[10px] text-accent hover:underline">
              Remove the cap
            </a>
          </div>
        )}
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
