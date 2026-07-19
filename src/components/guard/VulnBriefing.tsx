import { useState } from 'react';
import Icon from '../Icon';
import { invoke } from '@tauri-apps/api/core';
import { guardDb } from '../../lib/guardDb';
import { credentialStore } from '../../lib/krewDb';
import { callAutomationAI } from '../../lib/automationRunner';

interface Repo { name: string; full_name: string; language: string | null; }
interface VulnFinding {
  package: string;
  version?: string;
  severity: 'high' | 'med' | 'low';
  title: string;
  description: string;
  affected: boolean;
}

async function saveVulnBriefingToBrain(repoName: string, summary: string, findings: VulnFinding[]) {
  const affected = findings.filter((f) => f.affected);
  if (affected.length === 0) return; // nothing worth keeping — a clean scan isn't a lasting record
  // Plain words, not coloured circles: this string goes into the copied/exported report,
  // where an emoji renders differently in every editor the user pastes it into.
  const sevIcon = (s: string) => s === 'high' ? '[HIGH]' : s === 'med' ? '[MED]' : '[LOW]';
  const body = [
    summary,
    '',
    '### Vulnerable dependencies',
    ...affected.map((f) => `- ${sevIcon(f.severity)} **${f.package}${f.version ? ` ${f.version}` : ''}** — ${f.title}: ${f.description}`),
  ].join('\n');
  const { brain } = await import('../../lib/knowledgeStore');
  const title = `Vulnerability scan — ${repoName} — ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  brain.addUniqueNode({ title, kind: 'source', body });
}

const SEV: Record<string, { text: string; bg: string; border: string; bar: string }> = {
  high: { text: 'text-nv-bad',  bg: 'bg-red-500/10',    border: 'border-red-500/30',    bar: 'bg-red-500'    },
  med:  { text: 'text-nv-warn', bg: 'bg-amber-400/10',  border: 'border-amber-400/30',  bar: 'bg-amber-400'  },
  low:  { text: 'text-nv-ok',   bg: 'bg-emerald-500/10',border: 'border-emerald-500/25',bar: 'bg-emerald-400'},
};

const LANG_COLOR: Record<string, string> = {
  TypeScript: 'text-blue-400 bg-blue-400/10 border-blue-400/25',
  JavaScript: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/25',
  Python:     'text-green-400 bg-green-400/10 border-green-400/25',
  Rust:       'text-orange-400 bg-orange-400/10 border-orange-400/25',
  Go:         'text-cyan-400 bg-cyan-400/10 border-cyan-400/25',
  Java:       'text-red-400 bg-red-400/10 border-red-400/25',
};

const SYSTEM_PROMPT = `You are a security researcher. Given a list of npm/cargo/pip dependencies, identify known vulnerabilities.

Return ONLY valid JSON:
{
  "findings": [
    {
      "package": "<name>",
      "version": "<version or null>",
      "severity": "high|med|low",
      "title": "<short vuln name or CVE>",
      "description": "<plain English, max 50 words>",
      "affected": true
    }
  ],
  "summary": "<1-2 sentence overall assessment>"
}

Only include packages with actual known vulnerabilities. Return empty findings array if all look safe.
Respond ONLY with raw JSON.`;

type Step = 'idle' | 'repos' | 'scanning' | 'done';

export default function VulnBriefing() {
  const [repos, setRepos]       = useState<Repo[]>([]);
  const [selected, setSelected] = useState<Repo | null>(null);
  const [findings, setFindings] = useState<VulnFinding[]>([]);
  const [summary, setSummary]   = useState('');
  const [loading, setLoading]   = useState(false);
  const [step, setStep]         = useState<Step>('idle');
  const [error, setError]       = useState('');

  async function loadRepos() {
    setError('');
    setLoading(true);
    setStep('repos');
    try {
      const creds = await credentialStore.get('github').catch(() => null);
      if (!creds?.api_key) {
        setError('GitHub not connected. Go to Connect Apps to link GitHub.');
        setStep('idle');
        return;
      }
      const res = await invoke<string>('krew_http_call', {
        url: 'https://api.github.com/user/repos?per_page=30&sort=updated',
        method: 'GET',
        // krew_http_call takes headers as a MAP, not a JSON string — passing a string made Tauri
            // reject the call with "invalid args", so this tab never worked.
            headers: { Authorization: `token ${creds.api_key}`, Accept: 'application/vnd.github+json', 'User-Agent': 'adris.tech-guard' },
        body: null,
      });
      const data = JSON.parse(res) as Repo[];
      setRepos(data.filter(r => r.language));
    } catch (e) {
      setError(`Could not load repos: ${e}`);
      setStep('idle');
    } finally {
      setLoading(false);
    }
  }

  async function scanRepo(repo: Repo) {
    setSelected(repo);
    setFindings([]);
    setSummary('');
    setError('');
    setLoading(true);
    setStep('scanning');
    try {
      const creds = await credentialStore.get('github').catch(() => null);
      if (!creds?.api_key) { setError('GitHub not connected.'); return; }

      const candidates = ['package.json', 'Cargo.toml', 'requirements.txt', 'go.mod'];
      let depsText = '';
      let foundFile = '';

      for (const fname of candidates) {
        try {
          const res = await invoke<string>('krew_http_call', {
            url: `https://api.github.com/repos/${repo.full_name}/contents/${fname}`,
            method: 'GET',
            // krew_http_call takes headers as a MAP, not a JSON string — passing a string made Tauri
            // reject the call with "invalid args", so this tab never worked.
            headers: { Authorization: `token ${creds.api_key}`, Accept: 'application/vnd.github+json', 'User-Agent': 'adris.tech-guard' },
            body: null,
          });
          const file = JSON.parse(res);
          if (file.content) { depsText = atob(file.content.replace(/\n/g, '')); foundFile = fname; break; }
        } catch { }
      }

      if (!depsText) {
        setError('No dependency file found (package.json, Cargo.toml, requirements.txt, go.mod).');
        setStep('repos');
        return;
      }

      const raw = await callAutomationAI(`Dependency file: ${foundFile}\n\nContents:\n${depsText.slice(0, 4000)}`, SYSTEM_PROMPT);
      const cleanedRaw = raw.replace(/```json|```/g, '').trim();
      const jsonMatchRaw = cleanedRaw.match(/\{[\s\S]*\}/);
      if (!jsonMatchRaw) throw new Error('No JSON in response');
      const parsed = JSON.parse(jsonMatchRaw[0]) as { findings: VulnFinding[]; summary: string };

      setFindings(parsed.findings ?? []);
      setSummary(parsed.summary ?? '');

      for (const f of (parsed.findings ?? []).filter(f => f.severity === 'high')) {
        await guardDb.log('cve_found', 'high',
          `CVE in ${f.package} · ${f.title} · ${repo.name}`,
          { package: f.package, version: f.version, repo: repo.full_name });
      }
      saveVulnBriefingToBrain(repo.name, parsed.summary ?? '', parsed.findings ?? []).catch(() => {});
      setStep('done');
    } catch (e) {
      setError(`Scan failed: ${e}`);
      setStep('repos');
    } finally {
      setLoading(false);
    }
  }

  const highCount = findings.filter(f => f.severity === 'high').length;
  const medCount  = findings.filter(f => f.severity === 'med').length;

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Step header */}
      <div className="flex items-center gap-0 px-5 py-3 border-b border-nv-border bg-nv-surface shrink-0">
        {([
          { n: 1, label: 'Connect GitHub', done: step !== 'idle' },
          { n: 2, label: 'Select a repo',  done: step === 'scanning' || step === 'done' },
          { n: 3, label: 'Review findings',done: step === 'done' },
        ] as const).map((s, i) => (
          <div key={s.n} className="flex items-center gap-0">
            {i > 0 && <div className={`w-10 h-px mx-1 ${s.done ? 'bg-accent/40' : 'bg-nv-border'}`} />}
            <div className={`flex items-center gap-2 px-3 py-1 rounded-lg transition-fast ${
              s.done ? 'text-accent' : 'text-nv-faint'
            }`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold font-mono border transition-fast ${
                s.done ? 'bg-accent text-white border-accent' : 'border-nv-border text-nv-faint'
              }`}>
                {s.done ? '✓' : s.n}
              </div>
              <span className="text-[11px] font-mono">{s.label}</span>
            </div>
          </div>
        ))}
        <div className="ml-auto">
          {step === 'idle' || step === 'repos' ? (
            <button
              onClick={loadRepos}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-mono bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 disabled:opacity-50 transition-fast"
            >
              {loading && step === 'repos' ? (
                <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Loading…</>
              ) : (
                <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22"/></svg>Load GitHub repos</>
              )}
            </button>
          ) : step === 'done' && (
            <button onClick={() => { setStep('repos'); setFindings([]); setSummary(''); }}
              className="text-[11px] font-mono text-nv-faint hover:text-accent transition-fast px-3 py-1.5">
              ← Back to repos
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-5 mt-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/8 border border-red-500/20 text-nv-bad text-[11px] font-mono">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {error}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">

        {step === 'idle' && (
          <div className="flex flex-col items-center justify-center h-full gap-5 text-nv-faint">
            <div className="w-20 h-20 rounded-2xl border border-nv-border bg-nv-surface flex items-center justify-center">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22"/>
              </svg>
            </div>
            <div className="text-center max-w-xs">
              <p className="text-sm font-medium text-nv-text mb-2">Dependency Vulnerability Scanner</p>
              <p className="text-xs text-nv-faint leading-relaxed">
                Connect GitHub and select a repo. adris.tech AI reads your dependency file and checks for known CVEs — no API key or NVD account needed.
              </p>
            </div>
            <div className="flex gap-2 flex-wrap justify-center">
              {['package.json', 'Cargo.toml', 'requirements.txt', 'go.mod'].map(f => (
                <span key={f} className="text-[10px] font-mono px-2.5 py-1 rounded-lg bg-nv-surface border border-nv-border text-nv-faint">{f}</span>
              ))}
            </div>
          </div>
        )}

        {step === 'repos' && repos.length > 0 && (
          <div className="flex flex-col gap-2 max-w-2xl">
            <p className="text-[9px] font-mono text-nv-faint tracking-widest uppercase mb-1">Your repos — click to scan</p>
            <div className="grid grid-cols-2 gap-2">
              {repos.map(r => {
                const langStyle = LANG_COLOR[r.language ?? ''] ?? 'text-nv-faint bg-nv-surface2 border-nv-border';
                return (
                  <button
                    key={r.full_name}
                    onClick={() => scanRepo(r)}
                    disabled={loading}
                    className="flex items-center justify-between px-4 py-3 rounded-xl bg-nv-surface border border-nv-border hover:border-accent/40 hover:bg-accent/5 disabled:opacity-50 transition-fast group text-left"
                  >
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium text-nv-text group-hover:text-accent transition-fast truncate">{r.name}</p>
                      <p className="text-[9px] font-mono text-nv-faint truncate">{r.full_name.split('/')[0]}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {r.language && (
                        <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full border ${langStyle}`}>
                          {r.language}
                        </span>
                      )}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-nv-faint group-hover:text-accent transition-fast"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {loading && step === 'scanning' && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-nv-faint">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 rounded-full border-2 border-accent/20 animate-ping" />
              <div className="absolute inset-0 rounded-full border-2 border-accent/40" style={{ animation: 'spin 1.5s linear infinite' }} />
              <div className="absolute inset-0 flex items-center justify-center"><Icon name="search" size={18} className="text-accent" /></div>
            </div>
            <p className="text-sm font-medium text-nv-text">Scanning {selected?.name}…</p>
            <p className="text-xs text-nv-faint">Reading dependency file and cross-checking against known CVEs</p>
          </div>
        )}

        {step === 'done' && (
          <div className="flex flex-col gap-4 max-w-2xl">

            {/* Repo header */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-nv-surface border border-nv-border">
              <div>
                <p className="text-sm font-semibold text-nv-text">{selected?.name}</p>
                <p className="text-[10px] font-mono text-nv-faint">{selected?.full_name}</p>
              </div>
              <div className="flex gap-2 items-center">
                {highCount > 0 && <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-red-500/12 text-nv-bad border border-red-500/25">{highCount} critical</span>}
                {medCount  > 0 && <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-400/12 text-nv-warn border border-amber-400/25">{medCount} warning</span>}
                {findings.length === 0 && <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/12 text-nv-ok border border-emerald-500/25">✓ Clean</span>}
              </div>
            </div>

            {summary && (
              <p className="text-[12px] text-nv-muted leading-relaxed px-1">{summary}</p>
            )}

            {findings.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--nv-ok)" strokeWidth="2" strokeLinecap="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                </div>
                <p className="text-sm font-medium text-nv-ok">No known vulnerabilities found</p>
                <p className="text-xs text-nv-faint">All dependencies in this repo appear safe</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-[9px] font-mono text-nv-faint tracking-widest uppercase px-1">Findings ({findings.length})</p>
                {findings.map((f, i) => {
                  const s = SEV[f.severity] ?? SEV.low;
                  return (
                    <div key={i} className={`relative rounded-xl bg-nv-surface border ${s.border} overflow-hidden`}>
                      <div className={`absolute left-0 top-0 bottom-0 w-1 ${s.bar}`} />
                      <div className="pl-4 pr-4 py-3">
                        <div className="flex items-start gap-2 mb-1.5">
                          <span className={`text-[9px] font-bold font-mono px-1.5 py-0.5 rounded border shrink-0 mt-0.5 ${s.text} ${s.bg} ${s.border}`}>
                            {f.severity.toUpperCase()}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-semibold text-nv-text">{f.title}</p>
                            <p className="text-[10px] font-mono text-nv-faint">
                              {f.package}{f.version ? ` @ ${f.version}` : ''}
                            </p>
                          </div>
                          <span className={`text-[9px] font-mono shrink-0 ${f.affected ? 'text-nv-bad' : 'text-nv-ok'}`}>
                            {f.affected ? '⚠ Affected' : '✓ Not affected'}
                          </span>
                        </div>
                        <p className="text-[11px] text-nv-muted leading-relaxed">{f.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
