import { useState, useRef, useEffect } from 'react';
import { guardDb } from '../../lib/guardDb';
import { scanLargeDocument, estimateScan, chunkCharsFor, maxChunksFor, type GuardScanResult } from '../../lib/guardScan';
import { resolveAiSource } from '../../lib/aiSource';
import { extractDocument, GuardExtractError, type ExtractProgress } from '../../lib/guardOcr';

type ScanResult = GuardScanResult;

// Every Guard scan already produces a clean, structured result — no fragile LLM-output
// parsing needed (unlike Krew's freeform tables), so this can save deterministically every
// time, no user action required.
async function saveContractScanToBrain(fileLabel: string, r: GuardScanResult) {
  // Plain words, not coloured circles: this string goes into the copied/exported report,
  // where an emoji renders differently in every editor the user pastes it into.
  const sevIcon = (s: string) => s === 'high' ? '[HIGH]' : s === 'med' ? '[MED]' : '[LOW]';
  const body = [
    `**Risk score:** ${r.risk_score}/100`,
    `**Sections scanned:** ${r.chunksScanned}${r.truncated ? ' (truncated — document was very long)' : ''}`,
    '',
    r.summary,
    '',
    '### Findings',
    ...r.findings.map((f) => `- ${sevIcon(f.severity)} **${f.title}**${f.section ? ` (${f.section})` : ''} — ${f.detail}`),
  ].join('\n');
  const { brain } = await import('../../lib/knowledgeStore');
  const title = `Contract scan — ${fileLabel} — ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  brain.addUniqueNode({ title, kind: 'source', body });
}

const PHASE_LABEL: Record<ExtractProgress['phase'], string> = {
  reading:   'Reading file…',
  detecting: 'Checking document text…',
  rendering: 'Rendering scanned pages…',
  ocr:       'Reading scanned text (OCR)…',
  done:      'Done',
};

const SEV: Record<string, { bar: string; text: string; bg: string; border: string; label: string }> = {
  high: { bar: 'bg-red-500',     text: 'text-nv-bad',  bg: 'bg-red-500/10',    border: 'border-red-500/30',   label: 'HIGH' },
  med:  { bar: 'bg-amber-400',   text: 'text-nv-warn', bg: 'bg-amber-400/10',  border: 'border-amber-400/30', label: 'MED'  },
  low:  { bar: 'bg-emerald-400', text: 'text-nv-ok',   bg: 'bg-emerald-500/10',border: 'border-emerald-500/25',label: 'LOW' },
};

const SYSTEM_PROMPT = `You are a contract risk analyst. Analyze the provided contract text.

The text may be machine-extracted or OCR'd, and may contain Hindi, English, and/or regional Indian languages — sometimes mixed, sometimes with [bracketed] English translations inline. Read whichever language you understand, rely on the English translation where provided, and analyze the contract's actual meaning regardless of language. Always write your findings and summary in English.

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

FIRST work out WHAT KIND of document this is, and say so in the first sentence of the summary. It is not always a signed contract — people scan tenders and RFPs, MoUs, purchase orders, quotations, NDAs, terms of service, employment offers and government notices. Judging a tender by contract criteria produces a useless report: it has no indemnity clause to find, and the things that actually decide whether to bid go unmentioned.

Then check what matters FOR THAT KIND:
- Contract / agreement / NDA: auto-renewal traps, uncapped liability, one-sided termination, unusual IP assignment, non-compete clauses, payment term risks, missing GDPR/DPDP data protection clauses, data residency gaps.
- Tender / RFP / bid document: eligibility and qualification criteria (and whether a small firm can realistically meet them), EMD / security deposit / bank guarantee amounts, submission deadline and format, evaluation method, penalty and liquidated-damages clauses, payment schedule and retention, disqualification triggers, and any clause that quietly favours a large incumbent.
- Purchase order / quotation / invoice: price, taxes, delivery obligations, acceptance terms, penalties for delay, what happens if the buyer cancels.
- Employment offer: notice period, non-compete, IP ownership, variable pay conditions, clawbacks.

Judge it on its own terms and use the document's own vocabulary. A "finding" is anything that costs the reader money, time, rights or the ability to walk away — not only a legal clause. If the document is genuinely low-risk, say so with a low score rather than inventing problems.
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
  const [progress, setProgress] = useState<{ cur: number; total: number } | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractProg, setExtractProg] = useState<ExtractProgress | null>(null);
  const [ocrNote, setOcrNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  /** Seconds since the scan began — the difference between "working" and "stuck". */
  const [elapsed, setElapsed] = useState(0);
  /** Set while we are waiting out a provider rate limit, so the user sees WHY it is slow. */
  const [rateWait, setRateWait] = useState<{ attempt: number; max: number; waitMs: number } | null>(null);
  useEffect(() => {
    if (!scanning) { setElapsed(0); return; }
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [scanning]);

  const est = text.trim().length >= 100 ? estimateScan(text) : null;

  async function readFile(file: File) {
    setFileName(file.name);
    setError('');
    setOcrNote('');
    setExtracting(true);
    setExtractProg(null);
    try {
      const res = await extractDocument(file, p => setExtractProg(p));
      setText(res.text);
      if (res.ocrUsed) {
        setOcrNote(
          res.ocrTruncated
            ? `Scanned PDF — read the first ${res.ocrPagesScanned} of ${res.pages} pages with OCR. Split the file to read the rest.`
            : `Scanned PDF — read all ${res.ocrPagesScanned} page${res.ocrPagesScanned !== 1 ? 's' : ''} with OCR (any Hindi/regional text was translated).`,
        );
      }
      if (!res.text.trim()) {
        setError('No readable text found in that file. Try pasting the text directly.');
      }
    } catch (e) {
      if (e instanceof GuardExtractError) {
        setError(e.message);
      } else {
        setError('Could not read that file. Paste the contract text directly.');
      }
      setText('');
    } finally {
      setExtracting(false);
      setExtractProg(null);
    }
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
    setProgress(null);
    setRateWait(null);
    try {
      // Scan the ENTIRE document in bounded chunks (handles 200+ page agreements),
      // then merge + dedupe findings. The chunk cap bounds token spend per scan.
      const scanSource = (await resolveAiSource()).mode;
      const parsed = await scanLargeDocument(
        contractText,
        SYSTEM_PROMPT,
        // "Contract" was doing real damage here: a tender, an RFP, an MoU or a purchase order got
        // analysed as though it were a signed agreement, so the model hunted for indemnity clauses
        // in a document that has none and found nothing worth saying. Let it identify the document
        // first and judge it on the terms that matter for that kind of document.
        (chunk, i, count) =>
          count > 1
            ? `Analyze section ${i + 1} of ${count} of this document. It may be a contract, a tender/RFP, an MoU, a purchase order, a quotation or terms of service — work out which from the text itself and judge it by what matters for THAT kind of document. Report only issues found in THIS section:\n\n${chunk}`
            : `Analyze this document. It may be a contract, a tender/RFP, an MoU, a purchase order, a quotation or terms of service — say which it is, then assess it on the terms that matter for that kind (for a tender: eligibility, EMD/security deposit, deadlines, penalties, payment terms and disqualification triggers):\n\n${chunk}`,
        (cur, total) => setProgress({ cur, total }),
        // Rate-limit waits are the single biggest reason a small document appears to hang.
        (info) => setRateWait(info),
        // Slice size matched to the AI source. On a free key an 11k-token request is throttled
        // rather than answered, which is what left this on "Analyzing…" with nothing to show.
        chunkCharsFor(scanSource),
        // On the user's own key the tokens are theirs — scan the WHOLE document rather than
        // stopping partway and calling it done.
        maxChunksFor(scanSource),
      );

      const topSev = parsed.findings.find(f => f.severity === 'high') ? 'high'
        : parsed.findings.find(f => f.severity === 'med') ? 'med' : 'low';
      await guardDb.log('contract_scan', topSev,
        `Contract scanned · ${parsed.chunksScanned} section${parsed.chunksScanned !== 1 ? 's' : ''} · score ${parsed.risk_score}/100 · ${parsed.findings.length} finding${parsed.findings.length !== 1 ? 's' : ''}`,
        { risk_score: parsed.risk_score, findings_count: parsed.findings.length, file: fileName || 'pasted text', sections: parsed.chunksScanned, truncated: parsed.truncated }
      );
      saveContractScanToBrain(fileName || 'pasted text', parsed).catch(() => {});
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
      setProgress(null);
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
          <p className="text-[11px] text-nv-muted mt-0.5">Paste text or upload a PDF / TXT — scanned & multi-language docs supported</p>
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

        {/* Extraction status — shown while reading / OCR'ing a file */}
        {extracting && (
          <div className="mx-4 mt-3 shrink-0 rounded-xl border border-accent/30 bg-accent/8 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin text-accent"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              <span className="text-[11px] font-mono text-accent">{extractProg ? PHASE_LABEL[extractProg.phase] : 'Reading file…'}</span>
              {extractProg && extractProg.total > 1 && (
                <span className="text-[10px] font-mono text-nv-faint ml-auto">{extractProg.current}/{extractProg.total}</span>
              )}
            </div>
            {extractProg?.ocr && (
              <p className="text-[10px] text-nv-muted leading-relaxed mt-1.5">
                This is a scanned document — Guard is reading it page-by-page with OCR and translating any Hindi/regional text. Large scans can take a minute or two; please keep this window open.
              </p>
            )}
            {extractProg && extractProg.total > 1 && (
              <div className="mt-2 h-1 rounded-full bg-nv-surface2 overflow-hidden">
                <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${Math.round((extractProg.current / extractProg.total) * 100)}%` }} />
              </div>
            )}
          </div>
        )}

        {/* OCR result note — shown after a scanned doc is read */}
        {ocrNote && !extracting && (
          <p className="mx-4 mt-3 shrink-0 text-[10px] font-mono text-nv-ok px-2.5 py-1.5 rounded-lg bg-emerald-500/8 border border-emerald-500/20 leading-relaxed">
            ✓ {ocrNote}
          </p>
        )}

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
          {est && (
            <p className="text-[10px] font-mono text-nv-faint leading-relaxed">
              ~{est.pages} page{est.pages !== 1 ? 's' : ''} · scans {est.truncated ? `first ${est.chunks} of ${est.totalChunks} sections` : 'the whole document'} · ≈{est.approxTokens.toLocaleString()} tokens
              {est.truncated && <span className="text-nv-warn"> · very large file — only the first ~{est.chunks * 18} pages will be scanned</span>}
            </p>
          )}
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono text-nv-faint">
              {text.length > 0 ? `${text.length.toLocaleString()} chars` : 'No text yet'}
            </span>
            <button
              onClick={scan}
              disabled={scanning || extracting || text.trim().length < 100}
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
            <p className="text-sm font-medium text-nv-text">
              {progress && progress.total > 1 ? `Reading section ${progress.cur} of ${progress.total}…` : 'Reading the document…'}
            </p>
            {/* A SILENT SPINNER IS INDISTINGUISHABLE FROM A HANG. On a free key each section is a
                separate request that can take a while, so say how long it has been going and what
                is actually happening -- otherwise the only way to find out is to give up. */}
            <p className="text-xs text-nv-faint">
              Working out what kind of document this is, then checking the terms that matter for it
              {elapsed >= 5 ? ` · ${elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`} elapsed` : ''}
            </p>
            {/* THE REAL REASON IT IS SLOW, MOST OF THE TIME. A free NVIDIA/Groq key rate-limits
                hard, and the retry backoff (3s, 6s, 12s, 24s, 30s) means over a minute of waiting
                on ONE small chunk. Unsaid, that is indistinguishable from a crash. */}
            {rateWait && (
              <p className="text-[11px] text-amber-600 max-w-sm text-center leading-relaxed">
                Your AI provider is rate-limiting (free keys cap how much you can send per minute).
                Waiting {Math.round(rateWait.waitMs / 1000)}s, then retrying — attempt {rateWait.attempt} of {rateWait.max}.
                Nothing is stuck.
              </p>
            )}
            {elapsed >= 45 && (
              <p className="text-[11px] text-nv-muted max-w-sm text-center leading-relaxed">
                Still going. Long documents on a free key are read in small pieces to stay inside its
                per-minute limit, so this can take a few minutes — each section is a separate request.
              </p>
            )}
            {progress && progress.total > 1 && (
              <div className="w-44 h-1 rounded-full bg-nv-surface2 overflow-hidden mt-1">
                <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${Math.round((progress.cur / progress.total) * 100)}%` }} />
              </div>
            )}
          </div>
        ) : result && (
          <div className="flex flex-col h-full overflow-y-auto p-5 gap-4">

            {/* Score + summary */}
            <div className="p-5 rounded-2xl bg-nv-surface border border-nv-border">
              <p className="text-[9px] font-mono text-nv-faint tracking-widest uppercase mb-3">Risk Assessment</p>
              <RiskMeter score={result.risk_score} />
              <p className="text-[12px] text-nv-muted leading-relaxed mt-3">{result.summary}</p>
              <p className="text-[10px] font-mono text-nv-faint mt-2">
                {result.truncated
                  ? `⚠ Large document — scanned the first ${result.chunksScanned} of ${result.chunksTotal} sections (~${result.chunksScanned * 18} pages). Split the file to scan the rest.`
                  : `✓ Scanned the entire document (${result.chunksScanned} section${result.chunksScanned !== 1 ? 's' : ''}) · ≈${result.approxTokens.toLocaleString()} tokens used`}
              </p>
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
