import { useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { guardDb } from '../../lib/guardDb';
import { callAutomationAI } from '../../lib/automationRunner';

interface ComplianceRow {
  standard: string;
  requirement: string;
  status: 'pass' | 'warn' | 'fail';
  note: string;
}

interface ComplianceResult {
  overall: 'compliant' | 'partial' | 'non_compliant';
  score: number;
  rows: ComplianceRow[];
  action_items: string[];
}

const STATUS = {
  pass: { text: 'text-nv-ok',   bg: 'bg-emerald-500/10', border: 'border-emerald-500/25', icon: '✓', label: 'PASS' },
  warn: { text: 'text-nv-warn', bg: 'bg-amber-400/10',   border: 'border-amber-400/25',   icon: '!', label: 'WARN' },
  fail: { text: 'text-nv-bad',  bg: 'bg-red-500/10',     border: 'border-red-500/25',     icon: '✕', label: 'FAIL' },
};

const OVERALL = {
  compliant:     { text: 'text-nv-ok',   bg: 'bg-emerald-500/8', border: 'border-emerald-500/25', label: 'Compliant' },
  partial:       { text: 'text-nv-warn', bg: 'bg-amber-400/8',   border: 'border-amber-400/25',   label: 'Partially Compliant' },
  non_compliant: { text: 'text-nv-bad',  bg: 'bg-red-500/8',     border: 'border-red-500/25',     label: 'Non-Compliant' },
};

const STANDARD_COLOR: Record<string, string> = {
  'GDPR':      'text-blue-400   bg-blue-400/10   border-blue-400/25',
  'DPDP':      'text-violet-400 bg-violet-400/10 border-violet-400/25',
  'PCI-DSS':   'text-amber-400  bg-amber-400/10  border-amber-400/25',
  'ISO 27001': 'text-emerald-400 bg-emerald-400/10 border-emerald-400/25',
};

const BUSINESS_TYPES = ['SaaS · B2B', 'SaaS · B2C', 'E-commerce', 'Healthcare', 'Fintech', 'Consultancy / Services', 'Other'];
const DATA_TYPES     = ['No personal data', 'PII only', 'PII + payment data', 'Health records', 'Financial data', 'PII + all of the above'];
const GEO_OPTIONS    = ['India only', 'India + EU', 'India + US', 'Global'];

const TEXT_EXTS = ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs', '.java', '.rb', '.php',
                   '.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.html', '.css', '.env',
                   '.sh', '.sql', '.graphql', '.prisma', '.xml'];

const SYSTEM_PROMPT = `You are a compliance auditor. You will receive actual code, config, or policy files from a real product. Your job is to scan the provided content and find real compliance signals.

Business context tells you which regulations are in scope:
- GDPR: if India+EU or Global geography, or if EU users are mentioned
- DPDP: if India geography
- PCI-DSS: if payment data is handled
- ISO 27001: always check basic security controls

For each requirement you evaluate, look for ACTUAL evidence in the provided code/files:
- PASS: clear, specific evidence in the provided files that this control is implemented
- WARN: partial implementation found, or control exists but has gaps, or cannot be fully verified from these files alone
- FAIL: control is clearly absent, or code actively violates this requirement

Return ONLY valid JSON:
{
  "overall": "compliant|partial|non_compliant",
  "score": <0-100 based on actual findings>,
  "rows": [
    {
      "standard": "<GDPR|DPDP|PCI-DSS|ISO 27001>",
      "requirement": "<specific requirement name>",
      "status": "pass|warn|fail",
      "note": "<exactly what you found or did not find in the provided files, one specific sentence>"
    }
  ],
  "action_items": ["<specific, actionable task based on what was found>"]
}

Cover 6-10 requirements. Be specific — reference actual code patterns, function names, or file sections you found.
Respond ONLY with raw JSON. No markdown, no extra text.`;

function ScoreArc({ score, overall }: { score: number; overall: ComplianceResult['overall'] }) {
  const col = overall === 'compliant' ? 'var(--nv-ok)' : overall === 'partial' ? 'var(--nv-warn)' : 'var(--nv-bad)';
  const r = 52, cx = 64, cy = 64;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div className="relative flex items-center justify-center w-32 h-32">
      <svg width="128" height="128" className="-rotate-90">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--nv-surface2)" strokeWidth="8" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={col} strokeWidth="8"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 1s ease' }} />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-2xl font-bold font-mono leading-none" style={{ color: col }}>{score}</span>
        <span className="text-[8px] font-mono opacity-60 mt-0.5" style={{ color: col }}>/ 100</span>
      </div>
    </div>
  );
}

export default function ComplianceChecker() {
  const [bizType,  setBizType]  = useState(BUSINESS_TYPES[0]);
  const [dataType, setDataType] = useState(DATA_TYPES[1]);
  const [geo,      setGeo]      = useState(GEO_OPTIONS[0]);

  const [fileContent,   setFileContent]   = useState('');
  const [fileName,      setFileName]      = useState('');
  const [folderStats,   setFolderStats]   = useState('');
  const [pickingFolder, setPickingFolder] = useState(false);
  const [dragOver,      setDragOver]      = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [checking, setChecking] = useState(false);
  const [result,   setResult]   = useState<ComplianceResult | null>(null);
  const [error,    setError]    = useState('');

  async function readFile(file: File) {
    setFileName(file.name);
    setError('');
    if (file.name.endsWith('.pdf')) {
      try {
        const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
        GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const pdf = await getDocument({ data: await file.arrayBuffer() }).promise;
        let out = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          out += content.items.map((it: unknown) => (it as { str: string }).str).join(' ') + '\n';
        }
        setFileContent(out.trim());
      } catch {
        setError('Could not extract PDF text. Paste content directly.');
      }
      return;
    }
    if (TEXT_EXTS.some(ext => file.name.toLowerCase().endsWith(ext)) || file.type.startsWith('text/')) {
      setFileContent(await file.text());
      return;
    }
    setError('Unsupported file type. Drop a code file, .md, .txt, .json, .yaml, or .pdf.');
  }

  async function pickFolder() {
    setPickingFolder(true);
    setError('');
    try {
      const path = await invoke<string | null>('open_folder_dialog');
      if (!path) return;
      const content = await invoke<string>('scan_folder_for_compliance', { folderPath: path });
      const folderName = path.replace(/\\/g, '/').split('/').pop() ?? path;
      const statsLine = content.split('\n')[1] ?? '';
      setFileName(folderName + '/');
      setFolderStats(statsLine);
      setFileContent(content);
    } catch (e) {
      setError(String(e));
    } finally {
      setPickingFolder(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) readFile(file);
  }

  async function check() {
    if (!fileContent.trim()) {
      setError('Add a file or paste content to scan first.');
      return;
    }
    setChecking(true);
    setError('');
    setResult(null);
    try {
      const userMessage =
        `Business context:\n- Type: ${bizType}\n- Data handled: ${dataType}\n- Geography: ${geo}\n\n` +
        `File: ${fileName || 'pasted content'}\n\nContent to scan:\n\`\`\`\n${fileContent.slice(0, 14000)}\n\`\`\``;
      const raw = await callAutomationAI(userMessage, SYSTEM_PROMPT);
      const cleaned = raw.replace(/```json|```/g, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response — try again');
      const parsed: ComplianceResult = JSON.parse(jsonMatch[0]);
      const sev = parsed.overall === 'non_compliant' ? 'high' : parsed.overall === 'partial' ? 'med' : 'low';
      await guardDb.log('compliance_check', sev,
        `Compliance · ${bizType} · score ${parsed.score}/100 · ${fileName || 'pasted'}`,
        { overall: parsed.overall, score: parsed.score, file: fileName });
      setResult(parsed);
    } catch (e) {
      const msg = String(e);
      if (msg.includes('no model') || msg.includes('local') || msg.includes('llama') || msg.includes('connection refused') || msg.includes('Connection refused')) {
        setError('No AI provider connected. Go to Connect Apps and add a Gemini or OpenAI key.');
      } else if (msg.includes('Gemini error')) {
        setError(`Gemini API error — ${msg.replace('Error: ', '')}`);
      } else {
        setError(`Could not generate report — ${msg.replace('Error: ', '')}`);
      }
    } finally {
      setChecking(false);
    }
  }

  const passCount = result?.rows.filter(r => r.status === 'pass').length ?? 0;
  const warnCount = result?.rows.filter(r => r.status === 'warn').length ?? 0;
  const failCount = result?.rows.filter(r => r.status === 'fail').length ?? 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Top bar */}
      <div className="flex flex-col gap-0 border-b border-nv-border bg-nv-surface shrink-0">
        <div className="flex items-end gap-3 px-5 py-4 flex-wrap">
          <div className="flex gap-3 flex-1 min-w-0 flex-wrap">
            {[
              { label: 'Business type', value: bizType,  set: setBizType,  opts: BUSINESS_TYPES },
              { label: 'Data handled',  value: dataType, set: setDataType, opts: DATA_TYPES },
              { label: 'Geography',     value: geo,      set: setGeo,      opts: GEO_OPTIONS },
            ].map(({ label, value, set, opts }) => (
              <div key={label} className="flex flex-col gap-1 min-w-[150px]">
                <label className="text-[9px] font-mono text-nv-faint uppercase tracking-widest">{label}</label>
                <select
                  value={value}
                  onChange={e => set(e.target.value)}
                  className="px-2.5 py-2 bg-nv-bg border border-nv-border rounded-lg text-xs font-mono text-nv-text focus:outline-none focus:border-accent/50 cursor-pointer"
                >
                  {opts.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            ))}
          </div>
          <button
            onClick={check}
            disabled={checking || !fileContent.trim()}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-mono bg-accent text-white hover:bg-accent/85 disabled:opacity-40 transition-fast shrink-0 mb-0.5"
          >
            {checking ? (
              <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Scanning…</>
            ) : (
              <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M4 12l5 5L20 7"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>Run Compliance Scan</>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-5 mt-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/8 border border-red-500/20 text-nv-bad text-[11px] font-mono shrink-0">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">

        {/* Scanning state */}
        {checking && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 rounded-full border-2 border-accent/20 animate-ping" />
              <div className="absolute inset-0 rounded-full border-2 border-accent/40" style={{ animation: 'spin 1.5s linear infinite' }} />
              <div className="absolute inset-0 flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-accent"><path d="M4 12l5 5L20 7"/></svg>
              </div>
            </div>
            <p className="text-sm font-medium text-nv-text">Scanning for compliance…</p>
            <p className="text-xs text-nv-faint">Analyzing <span className="text-nv-muted">{fileName || 'content'}</span> for <span className="text-nv-muted">{bizType}</span></p>
            {folderStats && <p className="text-[10px] font-mono text-nv-faint/70">{folderStats}</p>}
            <p className="text-[10px] font-mono text-nv-faint/60">Checking GDPR · DPDP · PCI-DSS · ISO 27001</p>
          </div>
        )}

        {/* Result */}
        {!checking && result && (
          <div className="p-5 flex gap-5 min-h-full">
            <div className="flex flex-col gap-4 w-52 shrink-0">
              <div className={`flex flex-col items-center gap-3 p-5 rounded-2xl border ${OVERALL[result.overall].bg} ${OVERALL[result.overall].border}`}>
                <ScoreArc score={result.score} overall={result.overall} />
                <div className="text-center">
                  <p className={`text-sm font-semibold ${OVERALL[result.overall].text}`}>{OVERALL[result.overall].label}</p>
                  <p className="text-[10px] font-mono text-nv-faint mt-1">{fileName || 'pasted content'}</p>
                  <p className="text-[9px] font-mono text-nv-faint">{bizType}</p>
                </div>
              </div>

              <div className="flex flex-col gap-1.5 p-4 rounded-xl bg-nv-surface border border-nv-border">
                <p className="text-[9px] font-mono text-nv-faint tracking-widest uppercase mb-1">Summary</p>
                {[
                  { label: 'Passing',  count: passCount, style: 'text-nv-ok' },
                  { label: 'Warnings', count: warnCount, style: 'text-nv-warn' },
                  { label: 'Failing',  count: failCount, style: 'text-nv-bad' },
                ].map(({ label, count, style }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-[11px] text-nv-muted">{label}</span>
                    <span className={`text-[13px] font-bold font-mono ${style}`}>{count}</span>
                  </div>
                ))}
              </div>

              {result.action_items.length > 0 && (
                <div className="flex flex-col gap-2 p-4 rounded-xl bg-nv-surface border border-nv-border flex-1">
                  <p className="text-[9px] font-mono text-nv-faint tracking-widest uppercase">Action Items</p>
                  <ol className="flex flex-col gap-2">
                    {result.action_items.map((a, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-[9px] font-mono text-accent/70 mt-0.5 shrink-0 w-3">{i + 1}.</span>
                        <p className="text-[10px] text-nv-muted leading-relaxed">{a}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              <button
                onClick={() => { setResult(null); setFileContent(''); setFileName(''); setFolderStats(''); }}
                className="text-[10px] font-mono text-nv-faint hover:text-accent transition-fast self-start"
              >
                ← Scan another file
              </button>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[9px] font-mono text-nv-faint tracking-widest uppercase">Requirements ({result.rows.length})</p>
                <p className="text-[9px] font-mono text-nv-faint/50">Based on actual file scan</p>
              </div>
              <div className="flex flex-col gap-2">
                {result.rows.map((row, i) => {
                  const s = STATUS[row.status];
                  return (
                    <div key={i} className={`flex items-start gap-3 p-3 rounded-xl border ${s.bg} ${s.border}`}>
                      <div className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${s.bg} border ${s.border}`}>
                        <span className={`text-[10px] font-bold ${s.text}`}>{s.icon}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[9px] font-bold font-mono px-1.5 py-0.5 rounded border ${STANDARD_COLOR[row.standard] ?? 'text-nv-faint bg-nv-surface border-nv-border'}`}>
                            {row.standard}
                          </span>
                          <span className="text-[11px] font-semibold text-nv-text">{row.requirement}</span>
                          <span className={`text-[9px] font-bold font-mono ml-auto ${s.text}`}>{s.label}</span>
                        </div>
                        <p className="text-[10px] text-nv-muted leading-relaxed mt-1">{row.note}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Empty / file drop state */}
        {!checking && !result && (
          <div className="flex flex-col items-center justify-center h-full gap-5 p-8">

            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              className={`w-full max-w-lg flex flex-col items-center gap-3 px-8 py-10 rounded-2xl border-2 border-dashed cursor-pointer transition-all ${
                dragOver ? 'border-accent/60 bg-accent/5' : fileContent ? 'border-nv-ok/50 bg-emerald-500/5' : 'border-nv-border hover:border-accent/40 hover:bg-accent/3'
              }`}
            >
              <input ref={fileRef} type="file" className="hidden"
                accept=".js,.ts,.jsx,.tsx,.py,.go,.rs,.java,.md,.txt,.json,.yaml,.yml,.toml,.html,.css,.env,.sh,.sql,.pdf"
                onChange={e => { const f = e.target.files?.[0]; if (f) readFile(f); }} />

              {fileContent ? (
                <>
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center">
                    {fileName.endsWith('/') ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="text-nv-ok"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="text-nv-ok"><path d="M4 12l5 5L20 7"/></svg>
                    )}
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-nv-text">{fileName || 'Content loaded'}</p>
                    {folderStats ? (
                      <p className="text-[11px] text-nv-faint mt-1">{folderStats}</p>
                    ) : (
                      <p className="text-[11px] text-nv-faint mt-1">{fileContent.length.toLocaleString()} characters · ready to scan</p>
                    )}
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); setFileContent(''); setFileName(''); setFolderStats(''); setError(''); }}
                    className="text-[10px] font-mono text-nv-faint hover:text-nv-bad transition-fast"
                  >
                    × Remove
                  </button>
                </>
              ) : (
                <>
                  <div className="w-10 h-10 rounded-xl bg-nv-surface border border-nv-border flex items-center justify-center">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-nv-faint">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                    </svg>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-nv-text">Drop a file to scan</p>
                    <p className="text-[11px] text-nv-faint mt-1">or click to browse a single file</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 justify-center">
                    {['.js/.ts', '.py/.go', '.json/.yaml', '.md/.txt', '.env', '.pdf'].map(ext => (
                      <span key={ext} className="text-[9px] font-mono text-nv-faint px-2 py-0.5 rounded bg-nv-surface border border-nv-border">{ext}</span>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Folder picker button */}
            {!fileContent && (
              <button
                onClick={pickFolder}
                disabled={pickingFolder}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-nv-border bg-nv-surface hover:border-accent/40 hover:bg-accent/5 text-xs font-mono text-nv-muted hover:text-accent transition-all disabled:opacity-50"
              >
                {pickingFolder ? (
                  <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Reading folder…</>
                ) : (
                  <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>Pick a whole folder to scan</>
                )}
              </button>
            )}

            {/* What to drop guide */}
            {!fileContent && (
              <div className="w-full max-w-lg">
                <p className="text-[9px] font-mono text-nv-faint tracking-widest uppercase text-center mb-3">What to scan</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { icon: '{ }', label: 'Backend code', desc: 'server.js, app.py, main.go — checks for auth, logging, encryption patterns' },
                    { icon: '⚙', label: 'Config files', desc: '.env.example, docker-compose.yml — checks for exposed secrets, secure settings' },
                    { icon: '📄', label: 'Policy docs', desc: 'PRIVACY.md, TERMS.md, SECURITY.md — checks if required docs exist and are complete' },
                    { icon: '{}', label: 'API / schema', desc: 'routes.ts, schema.prisma, api.yaml — checks for data validation, PII handling' },
                  ].map(({ icon, label, desc }) => (
                    <div key={label} className="flex items-start gap-2.5 p-3 rounded-xl bg-nv-surface border border-nv-border">
                      <span className="text-base shrink-0 mt-0.5 w-5 text-center">{icon}</span>
                      <div>
                        <p className="text-[11px] font-semibold text-nv-text">{label}</p>
                        <p className="text-[9px] text-nv-faint leading-relaxed mt-0.5">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Paste option */}
            {!fileContent && (
              <div className="w-full max-w-lg">
                <p className="text-[9px] font-mono text-nv-faint tracking-widest uppercase text-center mb-2">or paste content directly</p>
                <textarea
                  rows={5}
                  placeholder={`Paste your code, config, or policy text here…\n\nExample: paste your server.js, your .env.example, your privacy policy, or any file you want checked for compliance.`}
                  className="w-full px-3 py-2.5 bg-nv-bg border border-nv-border rounded-xl text-[11px] font-mono text-nv-text placeholder:text-nv-faint/50 focus:outline-none focus:border-accent/50 resize-none leading-relaxed"
                  onChange={e => { setFileContent(e.target.value); setFileName(''); }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
