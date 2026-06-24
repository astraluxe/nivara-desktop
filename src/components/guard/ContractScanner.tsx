import { useState, useRef } from 'react';
import { guardDb } from '../../lib/guardDb';
import { callAutomationAI } from '../../lib/automationRunner';

interface Finding {
  severity: 'high' | 'med' | 'low';
  title: string;
  detail: string;
  section?: string;
}

interface ScanResult {
  risk_score: number;
  summary: string;
  findings: Finding[];
}

const SEV: Record<string, { bar: string; text: string; bg: string; border: string; label: string }> = {
  high: { bar: 'bg-red-500',     text: 'text-nv-bad',  bg: 'bg-red-500/10',    border: 'border-red-500/30',   label: 'HIGH' },
  med:  { bar: 'bg-amber-400',   text: 'text-nv-warn', bg: 'bg-amber-400/10',  border: 'border-amber-400/30', label: 'MED'  },
  low:  { bar: 'bg-emerald-400', text: 'text-nv-ok',   bg: 'bg-emerald-500/10',border: 'border-emerald-500/25',label: 'LOW' },
};

const SYSTEM_PROMPT = `You are a contract risk analyst. Analyze the provided contract text.

Return ONLY a valid JSON object:
{
  "risk_score": <0-100 integer>,
  "summary": "<2-3 sentence plain English summary>",
  "findings": [
    {
      "severity": "<high|med|low>",
      "title": "<short clause name>",
      "detail": "<plain English explanation, max 60 words>",
      "section": "<section ref if visible, else null>"
    }
  ]
}

Check for: auto-renewal traps, uncapped liability, one-sided termination, unusual IP assignment, non-compete clauses, payment term risks, missing GDPR/DPDP data protection clauses, data residency gaps.
Respond ONLY with raw JSON. No markdown, no extra text.`;

function RiskMeter({ score }: { score: number }) {
  const col = score < 30 ? 'var(--nv-ok)' : score < 60 ? 'var(--nv-warn)' : 'var(--nv-bad)';
  const label = score < 30 ? 'Low Risk' : score < 60 ? 'Moderate Risk' : 'High Risk';
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <div>
          <span className="text-4xl font-bold font-mono leading-none" style={{ color: col }}>{score}</span>
          <span className="text-[11px] font-mono text-nv-faint ml-1.5">/ 100</span>
        </div>
        <span className="text-sm font-semibold font-mono" style={{ color: col }}>{label}</span>
      </div>
      <div className="h-1.5 rounded-full bg-nv-surface2 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${score}%`, background: col }} />
      </div>
    </div>
  );
}

export default function ContractScanner({ onScanRun }: { onScanRun?: () => void }) {
  const [text, setText]         = useState('');
  const [scanning, setScanning] = useState(false);
  const [result, setResult]     = useState<ScanResult | null>(null);
  const [error, setError]       = useState('');
  const [fileName, setFileName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function readFile(file: File) {
    setFileName(file.name);
    setError('');

    if (file.type === 'text/plain' || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
      setText(await file.text());
      return;
    }

    if (file.name.endsWith('.pdf')) {
      try {
        const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
        GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const pdf = await getDocument({ data: await file.arrayBuffer() }).promise;
        let extracted = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const content = await (await pdf.getPage(i)).getTextContent();
          extracted += content.items.map((it: unknown) => (it as { str: string }).str).join(' ') + '\n';
        }
        setText(extracted.trim());
      } catch {
        setError('Could not extract PDF text. Paste the contract text directly.');
        setText('');
      }
      return;
    }

    setError('Unsupported format. Upload a .pdf or .txt file, or paste text directly.');
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) readFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) readFile(file);
  }

  async function scan() {
    const contractText = text.trim();
    if (contractText.length < 100) { setError('Paste at least a paragraph of contract text to scan.'); return; }
    onScanRun?.();
    setError('');
    setResult(null);
    setScanning(true);
    try {
      const raw = await callAutomationAI(`Analyze this contract:\n\n${contractText.slice(0, 12000)}`, SYSTEM_PROMPT);
      const cleaned = raw
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response — try again');
      let parsed: ScanResult;
      try {
        parsed = JSON.parse(jsonMatch[0]) as ScanResult;
      } catch {
        throw new Error('Could not parse AI response as JSON — the model may have returned malformed output. Try again.');
      }

      const topSev = parsed.findings.find(f => f.severity === 'high') ? 'high'
        : parsed.findings.find(f => f.severity === 'med') ? 'med' : 'low';
      await guardDb.log('contract_scan', topSev,
        `Contract scanned · score ${parsed.risk_score}/100 · ${parsed.findings.length} finding${parsed.findings.length !== 1 ? 's' : ''}`,
        { risk_score: parsed.risk_score, findings_count: parsed.findings.length, file: fileName || 'pasted text' }
      );
      setResult(parsed);
    } catch (e) {
      const msg = String(e);
      if (msg.includes('no model') || msg.includes('local') || msg.includes('llama') || msg.includes('connection refused') || msg.includes('Connection refused')) {
        setError('No AI provider connected. Go to Connect Apps and add a Gemini or OpenAI key.');
      } else if (msg.includes('Gemini error')) {
        setError(`Gemini API error — ${msg.replace('Error: ', '')}`);
      } else {
        setError(`Could not analyze contract — ${msg.replace('Error: ', '')}`);
      }
    } finally {
      setScanning(false);
    }
  }

  const highCount = result?.findings.filter(f => f.severity === 'high').length ?? 0;
  const medCount  = result?.findings.filter(f => f.severity === 'med').length ?? 0;
  const lowCount  = result?.findings.filter(f => f.severity === 'low').length ?? 0;

  return (
    <div className="flex h-full overflow-hidden">

      {/* Left panel — input */}
      <div className="flex flex-col w-[380px] shrink-0 border-r border-nv-border overflow-hidden">
        <div className="px-4 py-3 border-b border-nv-border bg-nv-surface shrink-0">
          <p className="text-[10px] font-mono text-nv-faint tracking-widest uppercase">Contract Input</p>
          <p className="text-[11px] text-nv-muted mt-0.5">Paste text or upload a PDF / TXT file</p>
        </div>

        {/* Drop zone */}
        <div
          className={`mx-4 mt-4 shrink-0 rounded-xl border-2 border-dashed transition-fast flex items-center justify-between px-4 py-3 cursor-pointer ${
            dragOver ? 'border-accent bg-accent/8 text-accent' : 'border-nv-border text-nv-faint hover:border-nv-muted'
          }`}
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span className="text-[11px] font-mono">{fileName || 'Drop PDF or TXT here, or click to browse'}</span>
          </div>
          {fileName && (
            <button onClick={e => { e.stopPropagation(); setFileName(''); setText(''); }}
              className="text-nv-faint hover:text-nv-text transition-fast">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          )}
          <input ref={fileRef} type="file" accept=".pdf,.txt,.md" className="hidden" onChange={handleFile} />
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 px-4 py-2 shrink-0">
          <div className="flex-1 border-t border-nv-border" />
          <span className="text-[9px] font-mono text-nv-faint">OR PASTE BELOW</span>
          <div className="flex-1 border-t border-nv-border" />
        </div>

        {/* Textarea */}
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Paste contract text here…"
          className="flex-1 mx-4 px-3 py-2.5 bg-nv-bg border border-nv-border rounded-xl text-xs font-mono text-nv-text placeholder:text-nv-faint focus:outline-none focus:border-accent/50 resize-none min-h-0"
        />

        {/* Bottom bar */}
        <div className="p-4 border-t border-nv-border shrink-0 flex flex-col gap-2">
          {error && (
            <p className="text-[10px] font-mono text-nv-bad px-2.5 py-1.5 rounded-lg bg-red-500/8 border border-red-500/20">{error}</p>
          )}
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono text-nv-faint">
              {text.length > 0 ? `${text.length.toLocaleString()} chars` : 'No text yet'}
            </span>
            <button
              onClick={scan}
              disabled={scanning || text.trim().length < 100}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono bg-accent text-white hover:bg-accent/85 disabled:opacity-40 transition-fast"
            >
              {scanning ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                  Analyzing…
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                  Scan Contract
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Right panel — results */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {!result && !scanning ? (
          <div className="flex flex-col items-center justify-center h-full gap-5 text-nv-faint p-8">
            <div className="w-20 h-20 rounded-2xl border border-nv-border bg-nv-surface flex items-center justify-center">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <path d="M14 2v6h6M10 13h4M10 17h4M10 9h1"/>
              </svg>
            </div>
            <div className="text-center max-w-xs">
              <p className="text-sm font-medium text-nv-text mb-2">AI Contract Risk Analysis</p>
              <p className="text-xs text-nv-faint leading-relaxed">
                Upload or paste a contract on the left. The AI will scan for risky clauses, liability traps, unfair termination terms, and missing compliance provisions.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 w-full max-w-xs text-left">
              {['Auto-renewal traps', 'Uncapped liability', 'IP assignment risk', 'GDPR/DPDP gaps', 'Non-compete terms', 'Payment red flags'].map(item => (
                <div key={item} className="flex items-center gap-2 text-[10px] text-nv-faint">
                  <span className="text-accent">→</span> {item}
                </div>
              ))}
            </div>
          </div>
        ) : scanning ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-nv-faint">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 rounded-full border-2 border-accent/20 animate-ping" />
              <div className="absolute inset-0 rounded-full border-2 border-accent/40" style={{ animation: 'spin 1.5s linear infinite' }} />
              <div className="absolute inset-0 flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              </div>
            </div>
            <p className="text-sm font-medium text-nv-text">Analyzing contract…</p>
            <p className="text-xs text-nv-faint">Checking for risks, liability clauses, and compliance gaps</p>
          </div>
        ) : result && (
          <div className="flex flex-col h-full overflow-y-auto p-5 gap-4">

            {/* Score + summary */}
            <div className="p-5 rounded-2xl bg-nv-surface border border-nv-border">
              <p className="text-[9px] font-mono text-nv-faint tracking-widest uppercase mb-3">Risk Assessment</p>
              <RiskMeter score={result.risk_score} />
              <p className="text-[12px] text-nv-muted leading-relaxed mt-3">{result.summary}</p>
              {/* Severity breakdown */}
              <div className="flex gap-2 mt-3 flex-wrap">
                {highCount > 0 && <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-red-500/12 text-nv-bad border border-red-500/25">{highCount} high</span>}
                {medCount  > 0 && <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-400/12 text-nv-warn border border-amber-400/25">{medCount} medium</span>}
                {lowCount  > 0 && <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/12 text-nv-ok border border-emerald-500/25">{lowCount} low</span>}
                {result.findings.length === 0 && <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/12 text-nv-ok border border-emerald-500/25">✓ No issues found</span>}
              </div>
            </div>

            {/* Findings */}
            {result.findings.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-[9px] font-mono text-nv-faint tracking-widest uppercase px-1">Findings ({result.findings.length})</p>
                {result.findings.map((f, i) => {
                  const s = SEV[f.severity] ?? SEV.low;
                  return (
                    <div key={i} className={`relative rounded-xl bg-nv-surface border ${s.border} overflow-hidden`}>
                      <div className={`absolute left-0 top-0 bottom-0 w-1 ${s.bar}`} />
                      <div className="pl-4 pr-4 py-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[9px] font-bold font-mono px-1.5 py-0.5 rounded border ${s.text} ${s.bg} ${s.border}`}>
                            {s.label}
                          </span>
                          <span className="text-[12px] font-semibold text-nv-text">{f.title}</span>
                          {f.section && <span className="text-[9px] font-mono text-nv-faint ml-auto">{f.section}</span>}
                        </div>
                        <p className="text-[11px] text-nv-muted leading-relaxed">{f.detail}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <button
              onClick={() => { setResult(null); setText(''); setFileName(''); }}
              className="self-start text-[10px] font-mono text-nv-faint hover:text-nv-text transition-fast"
            >
              ← Scan another contract
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
