import { useState } from 'react';
import ThreatDashboard  from '../components/guard/ThreatDashboard';
import ContractScanner  from '../components/guard/ContractScanner';
import VulnBriefing     from '../components/guard/VulnBriefing';
import ComplianceChecker from '../components/guard/ComplianceChecker';

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

export default function GuardModule() {
  const [tab, setTab] = useState<Tab>('dashboard');

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
        <div className="ml-auto flex items-center pr-3">
          <span className="text-[9px] font-mono text-nv-faint tracking-widest uppercase">Guard · Security Suite</span>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden relative">
        {tab === 'dashboard'  && <ThreatDashboard />}
        {tab === 'contract'   && <ContractScanner />}
        {tab === 'vulns'      && <VulnBriefing />}
        {tab === 'compliance' && <ComplianceChecker />}
      </div>
    </div>
  );
}
