import { useState, useEffect } from 'react';
import {
  getAiSource, setAiSource, getAiAvailability,
  type AiSourceMode, type ByokProvider, type AiAvailability,
} from '../lib/aiSource';

// One control, used anywhere a module runs AI in the background (Guard, Automations, Studio…).
// Krew keeps its own connection bar for the chat itself; this governs everything else.

const OPTIONS: { id: AiSourceMode; label: string; blurb: string }[] = [
  { id: 'auto',    label: 'Automatic',    blurb: 'Use your own key if one is connected, otherwise adris.tech, otherwise a local model.' },
  { id: 'nivara',  label: 'adris.tech',   blurb: 'The hosted AI. Counts against your monthly allowance.' },
  { id: 'own_key', label: 'Your own key', blurb: 'Runs on your OpenAI, Gemini or Anthropic key. Billed by them, never against your allowance.' },
  { id: 'local',   label: 'Local model',  blurb: 'Runs on this machine. Free, works offline, nothing leaves the computer.' },
];

export default function AiSourcePicker({ compact = false }: { compact?: boolean }) {
  const [pref, setPref]   = useState(getAiSource);
  const [avail, setAvail] = useState<AiAvailability | null>(null);

  useEffect(() => { getAiAvailability().then(setAvail).catch(() => {}); }, []);

  function choose(mode: AiSourceMode) {
    const next = { ...pref, mode };
    // Default to the first thing that is actually available so the choice works immediately.
    if (mode === 'own_key' && !next.provider) next.provider = avail?.byokProviders[0];
    if (mode === 'local'   && !next.localModel) next.localModel = avail?.localModels[0]?.filename;
    setPref(next);
    setAiSource(next);
  }

  const canUse = (id: AiSourceMode) =>
    id === 'auto' ? true
    : id === 'own_key' ? (avail?.byokProviders.length ?? 0) > 0
    : id === 'local' ? (avail?.localModels.length ?? 0) > 0
    : (avail?.signedIn ?? true);

  const why = (id: AiSourceMode) =>
    id === 'own_key' ? 'Connect an OpenAI, Gemini or Anthropic key in Connect Apps first.'
    : id === 'local' ? 'Download a model in the Models tab first.'
    : 'Sign in to use the hosted AI.';

  const active = OPTIONS.find((o) => o.id === pref.mode) ?? OPTIONS[0];

  return (
    <div className={compact ? '' : 'rounded-xl border border-nv-border bg-nv-surface p-3'}>
      {!compact && (
        <>
          <p className="text-[12px] font-medium text-nv-text mb-0.5">Where AI runs</p>
          <p className="text-[11.5px] leading-[1.6] text-nv-muted mb-2.5">
            Applies to background work like Guard scans and automations. The Krew chat has its own
            switch in the connection bar.
          </p>
        </>
      )}

      <div className="flex flex-wrap gap-1.5">
        {OPTIONS.map((o) => {
          const ok = canUse(o.id);
          const on = pref.mode === o.id;
          return (
            <button
              key={o.id}
              onClick={() => ok && choose(o.id)}
              disabled={!ok}
              title={ok ? o.blurb : why(o.id)}
              className={`text-[11.5px] px-2.5 py-1.5 rounded-lg border transition-fast ${
                on ? 'border-accent bg-accent/10 text-accent font-medium'
                   : ok ? 'border-nv-border text-nv-muted hover:border-nv-faint hover:text-nv-text'
                        : 'border-nv-border/60 text-nv-faint cursor-not-allowed opacity-60'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>

      <p className="text-[11px] text-nv-muted leading-relaxed mt-2">{active.blurb}</p>

      {/* "Your own key" is the cheapest option for most people, but only if they have a key — and
          the usual reaction is that getting one means a paid account. NVIDIA hand out free API
          credits, so point straight at it rather than leaving the option greyed out with nothing
          to do about it. */}
      {pref.mode === 'own_key' && (avail?.byokProviders.length ?? 0) === 0 && (
        <div className="mt-2 rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-2">
          <p className="text-[10.5px] text-nv-text font-medium">No key connected yet — get one free</p>
          <ol className="text-[10px] text-nv-muted leading-relaxed mt-1 ml-3.5 list-decimal space-y-0.5">
            <li>Open build.nvidia.com/models and sign in (free account).</li>
            <li>Pick any model, then press <span className="text-nv-text">Get API Key</span>.</li>
            <li>Copy the key and paste it into Connect Apps → NVIDIA.</li>
          </ol>
          <p className="text-[9.5px] text-nv-faint mt-1">Both are free and OpenAI-fast — Groq (console.groq.com) is the quickest. Neither uses adris.tech tokens.</p>
          <div className="flex gap-1.5 mt-1.5">
            <button
              onClick={() => {
                import('@tauri-apps/plugin-shell')
                  .then(({ open }) => open('https://build.nvidia.com/models'))
                  .catch(() => window.open('https://build.nvidia.com/models', '_blank'));
              }}
              className="text-[10px] px-2 py-0.5 rounded-md border border-accent/50 text-accent hover:bg-accent/10 transition-fast"
            >Get NVIDIA key</button>
            <button
              onClick={() => {
                import('@tauri-apps/plugin-shell')
                  .then(({ open }) => open('https://console.groq.com/keys'))
                  .catch(() => window.open('https://console.groq.com/keys', '_blank'));
              }}
              className="text-[10px] px-2 py-0.5 rounded-md border border-nv-border text-nv-muted hover:text-nv-text transition-fast"
            >Get Groq key</button>
          </div>
        </div>
      )}

      {/* Which key / which model — only when that mode is selected and there is a real choice. */}
      {pref.mode === 'own_key' && (avail?.byokProviders.length ?? 0) > 1 && (
        <div className="flex items-center gap-1.5 mt-2">
          <span className="text-[10px] text-nv-faint">Key:</span>
          {avail!.byokProviders.map((p: ByokProvider) => (
            <button
              key={p}
              onClick={() => { const n = { ...pref, provider: p }; setPref(n); setAiSource(n); }}
              className={`text-[10px] px-2 py-0.5 rounded-md border transition-fast ${
                pref.provider === p ? 'border-accent text-accent bg-accent/10' : 'border-nv-border text-nv-muted hover:text-nv-text'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {pref.mode === 'local' && (avail?.localModels.length ?? 0) > 0 && (
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          <span className="text-[10px] text-nv-faint">Model:</span>
          <select
            value={pref.localModel ?? avail!.localModels[0].filename}
            onChange={(e) => { const n = { ...pref, localModel: e.target.value }; setPref(n); setAiSource(n); }}
            className="text-[10.5px] bg-nv-surface2 border border-nv-border rounded-md px-1.5 py-0.5 text-nv-text outline-none focus:border-accent max-w-[200px]"
          >
            {avail!.localModels.map((m) => <option key={m.filename} value={m.filename}>{m.name}</option>)}
          </select>
        </div>
      )}

      {pref.mode !== 'nivara' && pref.mode !== 'auto' && (
        <p className="text-[10.5px] text-nv-faint mt-2">This choice uses none of your monthly allowance.</p>
      )}
    </div>
  );
}
