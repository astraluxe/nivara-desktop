import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ConnectionMode, Provider, PROVIDERS, fetchRankedModels, type RankedModel } from '../../lib/ai';
import { contextWindowFor } from '../../lib/contextBudget';
import { rankScan } from '../../lib/modelHealth';
import { credentialStore } from '../../lib/krewDb';
import { PLAN_CONFIG, Plan } from '../../lib/planConfig';

interface Props {
  mode: ConnectionMode;
  onModeChange: (m: ConnectionMode) => void;
  apiKey: string;
  onApiKeyChange: (k: string) => void;
  provider: Provider;
  onProviderChange: (p: Provider) => void;
  modelName: string;
  onModelNameChange: (m: string) => void;
  baseUrl: string;
  onBaseUrlChange: (u: string) => void;
  localModel: string;
  onLocalModelChange: (m: string) => void;
  currentPlan: string;
}

interface InstalledModel {
  id: string;
  name: string;
  filename: string;
  size_gb: number;
}

const PLAN_ORDER: Plan[] = ['explore', 'solo', 'builder', 'business', 'custom'];
const PLAN_LABELS: Record<Plan, string> = {
  explore: 'Free', free: 'Free', solo: 'Solo', builder: 'Builder', business: 'Business', custom: 'Custom',
};

const MODES: { id: ConnectionMode; label: string; dotClass: string }[] = [
  { id: 'local',   label: 'Local',   dotClass: 'bg-nv-green' },
  { id: 'own_key', label: 'Own Key', dotClass: 'bg-nv-yellow' },
  { id: 'nivara',  label: 'adris.tech',  dotClass: 'bg-accent' },
];

const PROVIDER_ORDER: Provider[] = [
  'openai', 'groq', 'mistral', 'perplexity', 'together', 'deepseek', 'claude', 'gemini', 'custom',
];

export default function ConnectionBar(props: Props) {
  const { mode, onModeChange, apiKey, onApiKeyChange, provider, onProviderChange,
          modelName, onModelNameChange, baseUrl, onBaseUrlChange,
          localModel, onLocalModelChange, currentPlan } = props;
  const [popup, setPopup] = useState<ConnectionMode | null>(null);
  const [installedModels, setInstalledModels] = useState<InstalledModel[] | null>(null);
  const [engineStatus, setEngineStatus] = useState<'idle' | 'starting' | 'running' | 'error'>('idle');
  const [rankedModels, setRankedModels] = useState<RankedModel[] | null>(null);
  const [checking, setChecking] = useState<string | null>(null);   // model id being verified
  // Bumped when a model is repaired mid-task, so this panel re-reads the credential instead of
  // displaying the model that just failed.
  const [credsNonce, setCredsNonce] = useState(0);
  useEffect(() => {
    const bump = () => setCredsNonce((n) => n + 1);
    window.addEventListener('nv-creds-changed', bump);
    return () => window.removeEventListener('nv-creds-changed', bump);
  }, []);
  const [checkNote, setCheckNote] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  // Measured results for THIS key: which models answer, how fast, and whether they can return JSON.
  // Without this the picker could only show ids — the user picked a name, got something slow or
  // prose-only, and had no way to see why. `scanning` drives the live progress line.
  const [scan, setScan] = useState<import('../../lib/modelHealth').ModelScan | null>(null);
  const [scanning, setScanning] = useState<{ done: number; total: number } | null>(null);
  const [byokList, setByokList] = useState<{ api_key: string; model?: string }[]>([]);
  const [byokActive, setByokActive] = useState('');
  const [connectedAi, setConnectedAi] = useState<Provider[]>([]);

  // Which AI providers the user has actually connected — so the own-key popup can offer a clear
  // "use this one" choice (e.g. Gemini vs NVIDIA) instead of leaving them guessing.
  useEffect(() => {
    if (popup !== 'own_key') return;
    let cancelled = false;
    (async () => {
      const found: Provider[] = [];
      for (const p of ['gemini', 'openai', 'claude', 'nvidia', 'groq'] as Provider[]) {
        try { const c = await credentialStore.get(p); if (c?.api_key) found.push(p); } catch { /* none */ }
      }
      if (!cancelled) setConnectedAi(found);
    })();
    return () => { cancelled = true; };
  }, [popup, byokList]);

  // Load the saved keys for the selected provider (NVIDIA/Groq can have several to toggle between).
  async function refreshByokKeys(prov: Provider) {
    if (prov !== 'nvidia' && prov !== 'groq') { setByokList([]); setByokActive(''); return; }
    try {
      const { getByokKeys } = await import('../../lib/byokKeys');
      const { keys, activeKey } = await getByokKeys(prov);
      setByokList(keys); setByokActive(activeKey);
    } catch { setByokList([]); setByokActive(''); }
  }
  useEffect(() => { if (popup === 'own_key') void refreshByokKeys(provider); }, [popup, provider]);

  // When the own-key popup is open for NVIDIA/Groq, fetch the models THIS key can actually call and
  // rank them into plain tiers. Uses the popup's key field, else the key saved in Connect Apps.
  useEffect(() => {
    let cancelled = false;
    if (popup !== 'own_key' || (provider !== 'nvidia' && provider !== 'groq')) { setRankedModels(null); return; }
    (async () => {
      setModelsLoading(true);
      let key = apiKey;
      if (!key) { try { const c = await credentialStore.get(provider); key = (c?.api_key as string) || ''; } catch { /* none */ } }
      if (!key) { if (!cancelled) { setRankedModels(null); setModelsLoading(false); } return; }
      const list = await fetchRankedModels(provider, key);
      // Hide models this key has already been caught not answering. The catalogue lists everything
      // the provider hosts, not what the account can actually call — offering one of those back is
      // how a user ends up picking a model that accepts the request and then says nothing.
      const { isBlocked } = await import('../../lib/modelHealth');
      const usable = list.filter((m) => !isBlocked(provider, m.id));
      if (!cancelled) { setRankedModels(usable); setModelsLoading(false); }

      // Show whatever was measured before, then — if this key has never been swept — sweep it in
      // the background. Nothing waits on it: the popup stays usable and the numbers fill in.
      const { loadScan } = await import('../../lib/modelHealth');
      const saved = loadScan(provider, key);
      if (!cancelled) setScan(saved);
      if (!saved && !cancelled) void runScan(key);
    })();
    return () => { cancelled = true; };
  }, [popup, provider, apiKey, credsNonce]);

  /** Measure every model this key can call. Fired on first open and by the Rescan button. */
  async function runScan(explicitKey?: string) {
    let key = explicitKey || apiKey;
    if (!key) { try { const c = await credentialStore.get(provider); key = (c?.api_key as string) || ''; } catch { /* none */ } }
    if (!key) return;
    setScanning({ done: 0, total: 0 });
    try {
      const { scanModels } = await import('../../lib/modelHealth');
      const result = await scanModels(provider, key, (done, total) => setScanning({ done, total }));
      setScan(result);
      // A model already proven dead must not stay in the picker.
      const { isBlocked } = await import('../../lib/modelHealth');
      setRankedModels((prev) => (prev ? prev.filter((m) => !isBlocked(provider, m.id)) : prev));
    } catch { /* offline or the probe endpoint is blocked — keep whatever we had */ }
    setScanning(null);
  }

  /** The measured row for a model id, if this key has been scanned. */
  const rowFor = (id: string) => scan?.rows.find((r) => r.id === id);
  /** Ranked exactly as pickBestModel ranks — the list and the automatic choice cannot disagree. */
  const rankedScan = scan ? rankScan(scan) : [];
  /** "65k" / "1M" — a context window a non-technical user can compare at a glance. */
  const win = (t: number) => (t >= 1_000_000 ? `${Math.round(t / 1_000_000)}M` : `${Math.round(t / 1000)}k`);

  // Open the guided setup for a free provider and preselect it as the own-key provider. Does NOT
  // fling the user out to the website — the wizard has a link they click when THEY are ready
  // (jumping straight to the browser on click was jarring). Reuses the open-Connect-Apps path.
  async function openFreeKeySetup(id: 'nvidia' | 'groq') {
    onProviderChange(id as Provider);
    try {
      const { requestServiceSetup } = await import('../../lib/connectAppsRequest');
      requestServiceSetup(id);
      const { emit } = await import('@tauri-apps/api/event');
      await emit('nv-open-connect-apps', {});
    } catch { /* the wizard couldn't be opened — nothing else to do */ }
  }
  const [engineError, setEngineError] = useState('');

  useEffect(() => {
    if (popup !== 'local') return;
    invoke<InstalledModel[]>('models_list_installed').then(setInstalledModels).catch(() => setInstalledModels([]));
    invoke<boolean>('models_check_engine').then(running => setEngineStatus(running ? 'running' : 'idle')).catch(() => {});
  }, [popup]);

  async function loadLocalModel(filename: string) {
    onLocalModelChange(filename);
    setEngineStatus('starting');
    setEngineError('');
    try {
      await invoke('models_run', { modelFilename: filename });
      setEngineStatus('running');
    } catch (e) {
      setEngineStatus('error');
      setEngineError(String(e));
    }
  }

  function handleProviderChange(p: Provider) {
    onProviderChange(p);
    const meta = PROVIDERS[p];
    if (meta.defaultModel && !modelName) {
      onModelNameChange(meta.defaultModel);
    } else if (meta.defaultModel) {
      onModelNameChange(meta.defaultModel);
    }
  }

  const meta = PROVIDERS[provider];

  return (
    <>
      <div className="flex items-center gap-1.5">
        {MODES.map((m) => {
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => { onModeChange(m.id); setPopup(m.id); }}
              className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded border transition-fast
                ${active
                  ? 'border-accent/50 text-accent bg-accent/10'
                  : 'border-nv-border text-nv-faint hover:text-nv-muted hover:border-nv-muted'}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${active ? m.dotClass : 'bg-nv-faint'}`} />
              {m.label}
            </button>
          );
        })}
      </div>

      {popup && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-14 px-3 pb-4"
          onClick={() => setPopup(null)}
        >
          <div
            className="bg-nv-surface border border-nv-border rounded-xl w-[min(92vw,22rem)] max-h-[calc(100dvh-5rem)] shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sticky header so the title stays put while the (sometimes tall) body scrolls. */}
            <div className="flex items-center justify-between px-5 pt-4 pb-2.5 border-b border-nv-border shrink-0 bg-nv-surface">
              <p className="text-[11px] font-semibold text-nv-text uppercase tracking-wider">
                {popup === 'local'   && 'Local Model'}
                {popup === 'own_key' && 'Own API Key'}
                {popup === 'nivara'  && 'adris.tech Plan'}
              </p>
              <button onClick={() => setPopup(null)} className="text-nv-faint hover:text-nv-text -mr-1 p-1" aria-label="Close">
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="px-5 py-4 overflow-y-auto">

            {popup === 'local' && (
              <>
                {installedModels === null ? (
                  <p className="text-nv-faint text-[11px]">Checking downloaded models…</p>
                ) : installedModels.length === 0 ? (
                  <p className="text-nv-muted text-[11px] leading-relaxed">
                    No models downloaded yet. Open the <span className="text-nv-text font-semibold">Models</span> tab,
                    pull one that fits your machine, then pick it here.
                  </p>
                ) : (
                  <>
                    <label className="text-nv-faint text-[11px] block mb-1.5">Downloaded models</label>
                    <select
                      value={localModel}
                      onChange={(e) => loadLocalModel(e.target.value)}
                      className="w-full bg-nv-bg border border-nv-border rounded-lg px-3 py-2
                        text-[12px] text-nv-text outline-none focus:border-accent transition-fast mb-2
                        appearance-none cursor-pointer"
                    >
                      <option value="" disabled>Select a model…</option>
                      {installedModels.map((m) => (
                        <option key={m.id} value={m.filename}>{m.name} · {m.size_gb} GB</option>
                      ))}
                    </select>
                    <p className="text-[10px] font-mono">
                      {engineStatus === 'starting' && <span className="text-nv-faint">Starting engine…</span>}
                      {engineStatus === 'running'  && <span className="text-emerald-400">● running — ready to chat</span>}
                      {engineStatus === 'error'    && <span className="text-red-400">Could not start: {engineError}</span>}
                      {engineStatus === 'idle'     && <span className="text-nv-faint">Pick a model to load it</span>}
                    </p>
                  </>
                )}
              </>
            )}

            {popup === 'own_key' && (
              <>
                {/* Your connected providers — the clear "which one do I use?" choice when more than
                    one key is connected (e.g. Gemini AND NVIDIA). Tapping one selects it. */}
                {connectedAi.length > 0 && (
                  <div className="mb-3">
                    <label className="text-nv-faint text-[11px] block mb-1.5">Use your connected key</label>
                    <div className="flex flex-wrap gap-1.5">
                      {connectedAi.map((p) => (
                        <button key={p} onClick={() => handleProviderChange(p)}
                          className={`text-[11px] px-2.5 py-1 rounded-lg border transition-fast ${provider === p ? 'border-accent bg-accent/10 text-accent font-medium' : 'border-nv-border text-nv-muted hover:text-nv-text'}`}>
                          {PROVIDERS[p].label}{provider === p ? ' ✓' : ''}
                        </button>
                      ))}
                    </div>
                    <p className="text-[9.5px] text-nv-faint mt-1">This is what the agents run on. The list below is only if you want a provider you haven’t connected yet.</p>
                  </div>
                )}

                {/* Provider dropdown (all providers — for connecting a new one) */}
                <label className="text-nv-faint text-[11px] block mb-1.5">Provider</label>
                <select
                  value={provider}
                  onChange={(e) => handleProviderChange(e.target.value as Provider)}
                  className="w-full bg-nv-bg border border-nv-border rounded-lg px-3 py-2
                    text-[12px] text-nv-text outline-none focus:border-accent transition-fast mb-3
                    appearance-none cursor-pointer"
                >
                  {PROVIDER_ORDER.map((p) => (
                    <option key={p} value={p}>{PROVIDERS[p].label}</option>
                  ))}
                </select>

                {/* Your connected keys (NVIDIA/Groq) — shows you ARE on your own key, and lets you
                    toggle between several or add another. */}
                {(provider === 'nvidia' || provider === 'groq') && byokList.length > 0 && (
                  <div className="mb-3 rounded-lg border border-nv-green/30 bg-nv-green/5 px-2.5 py-2">
                    <p className="text-[10.5px] text-nv-green font-medium mb-1.5">✓ Using your own {provider === 'nvidia' ? 'NVIDIA' : 'Groq'} key{byokList.length > 1 ? ` — ${byokList.length} connected` : ''}</p>
                    <div className="flex flex-col gap-1">
                      {byokList.map((k) => {
                        const active = k.api_key === byokActive;
                        const mask = k.api_key.length > 12 ? `${k.api_key.slice(0, 7)}…${k.api_key.slice(-4)}` : k.api_key;
                        return (
                          <div key={k.api_key} className={`flex items-center gap-2 px-2 py-1 rounded-md border ${active ? 'border-accent/50 bg-accent/10' : 'border-nv-border'}`}>
                            <button
                              onClick={async () => { const { setActiveByokKey } = await import('../../lib/byokKeys'); await setActiveByokKey(provider, k.api_key); setByokActive(k.api_key); }}
                              className="flex items-center gap-1.5 flex-1 min-w-0 text-left">
                              <span className={`w-2.5 h-2.5 rounded-full border ${active ? 'border-accent bg-accent' : 'border-nv-faint'}`} />
                              <span className={`text-[10px] font-mono truncate ${active ? 'text-accent' : 'text-nv-muted'}`}>{mask}</span>
                              {k.model && <span className="text-[9px] text-nv-faint truncate">· {k.model.split('/').pop()}</span>}
                            </button>
                            {byokList.length > 1 && (
                              <button
                                onClick={async () => { const { removeByokKey } = await import('../../lib/byokKeys'); await removeByokKey(provider, k.api_key); await refreshByokKeys(provider); }}
                                title="Remove this key" className="text-nv-faint hover:text-nv-red text-[12px] leading-none shrink-0">×</button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <button
                      onClick={() => openFreeKeySetup(provider as 'nvidia' | 'groq')}
                      className="mt-1.5 text-[10px] text-accent hover:underline">+ Add another {provider === 'nvidia' ? 'NVIDIA' : 'Groq'} key</button>
                  </div>
                )}

                {/* Groq's free tier caps tokens-per-minute at 12,000. That is fine for chat and
                    drafting, and genuinely too small for the batch jobs — a lead search sends the
                    brief plus a growing exclusion list on every batch and eventually gets a hard
                    "413 Payload Too Large", and the per-minute waits stretch a 25-lead run into
                    tens of minutes. NVIDIA's free tier is far more generous, so it is named as the
                    fix rather than leaving the user to discover this mid-run. */}
                {provider === 'groq' && (
                  <div className="mb-3 px-2.5 py-2 rounded-lg border border-red-500/40 bg-red-500/10">
                    <p className="text-[10px] text-red-500 leading-relaxed">
                      <b>Heads-up — Groq's free limit is 12,000 tokens per minute.</b>
                      <span className="text-nv-text"> That's plenty for chat, but tight for the big
                      jobs: <b>finding leads</b>, <b>verifying LinkedIn profiles</b>, <b>filling in contacts</b>,
                      <b> bulk outreach drafting</b> and <b>deep research</b>. Expect long pauses while it waits
                      out the limit, and some batches may fail outright.</span>
                    </p>
                    <p className="text-[10px] text-nv-text mt-1 leading-relaxed">
                      For those, use a free <b>NVIDIA</b> key instead — same zero cost, far higher limits, and it
                      finishes these tasks much faster.
                    </p>
                  </div>
                )}

                {/* Positive heads-up for the free fast keys: great for everyday work, but adris.tech AI
                    pulls ahead on the heavy lifting. Guidance, not a warning. */}
                {(provider === 'nvidia' || provider === 'groq') && (
                  <p className="mb-3 text-[10px] text-nv-faint leading-relaxed">
                    <span className="text-accent font-medium">Good to know:</span> {provider === 'nvidia' ? 'NVIDIA' : 'Groq'} is
                    free and lightning-fast — ideal for everyday drafting and quick replies. For the heavy lifting
                    (long outreach, deep research, detailed documents), <b className="text-nv-text">adris.tech AI</b> gives
                    noticeably sharper results. You can switch anytime — it's one tap away.
                  </p>
                )}

                {/* Custom base URL (only for custom provider) */}
                {provider === 'custom' && (
                  <>
                    <label className="text-nv-faint text-[11px] block mb-1.5">Base URL</label>
                    <input
                      value={baseUrl}
                      onChange={(e) => onBaseUrlChange(e.target.value)}
                      placeholder="https://your-api.com/v1/chat/completions"
                      className="w-full bg-nv-bg border border-nv-border rounded-lg px-3 py-2
                        text-[12px] text-nv-text outline-none focus:border-accent transition-fast mb-3"
                    />
                  </>
                )}

                {/* Plain-language model picker — for NVIDIA/Groq we fetch the models THIS key can
                    actually call and group them, so a non-tech user picks "Recommended" vs "Fast"
                    instead of reading 130 cryptic ids. */}
                {(provider === 'nvidia' || provider === 'groq') && (
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-nv-faint text-[11px]">Model</label>
                      <button
                        onClick={() => runScan()}
                        disabled={!!scanning}
                        className="text-[9.5px] px-1.5 py-0.5 rounded-md border border-nv-border text-nv-faint hover:text-nv-text disabled:opacity-50 transition-fast"
                      >{scanning ? `Testing ${scanning.done}/${scanning.total || '…'}` : 'Rescan models'}</button>
                    </div>

                    {/* WHAT IS ACTUALLY CONNECTED, with its measured numbers. The popup used to show
                        only an id, so "connected to a 49b model" and "answers like an 8b model"
                        could both be true with no way to tell which was doing the work. */}
                    {modelName && (
                      <div className="mb-2 px-2 py-1.5 rounded-lg border border-accent/30 bg-accent/5">
                        <p className="text-[10px] text-accent font-medium truncate" title={modelName}>Connected: {modelName.split('/').pop()}</p>
                        <p className="text-[9.5px] text-nv-faint mt-0.5">
                          {win(contextWindowFor(modelName))} context
                          {rowFor(modelName)
                            ? ` · ${rowFor(modelName)!.ok ? `${rowFor(modelName)!.ms}ms · JSON ${rowFor(modelName)!.jsonOk ? '✓' : '✗ (answers in prose — weak for agent work)'}` : 'did not answer when last tested'}`
                            : ' · not measured yet — press Rescan models'}
                        </p>
                      </div>
                    )}
                    {scanning && (
                      <p className="text-[9.5px] text-nv-faint mb-1.5">
                        Testing every model your key can call — this runs in the background, keep using the app.
                      </p>
                    )}
                    {rankedModels === null
                      ? <p className="text-[10.5px] text-nv-faint">{modelsLoading ? 'Finding the models your key can use…' : 'Connect the key first (Connect Apps → ' + (provider === 'nvidia' ? 'NVIDIA' : 'Groq') + '), then reopen this to choose a model.'}</p>
                      : rankedModels.length === 0
                        ? <p className="text-[10.5px] text-amber-400">Couldn’t list models for this key — it may be new. The default works; you can type a model id below.</p>
                        : (
                          <>
                            {/* MEASURED first when we have measurements. A model that answered in
                                813ms with clean JSON is objectively the better pick than one that
                                merely sounds bigger, and the numbers are shown so the user can see
                                why — no hidden hardcoded favourite. */}
                            {(scan ? ['measured'] as const : ['smart', 'fast'] as const).map((tier) => {
                              const list = tier === 'measured'
                                ? (() => {
                                    // Same ordering the app itself uses to pick — so what the user
                                    // sees at the top IS what gets chosen for them.
                                    const byId = new Map(rankedModels.map((m) => [m.id, m] as const));
                                    return rankedScan.map((r) => byId.get(r.id) ?? { id: r.id, tier: 'other' as const }).slice(0, 10);
                                  })()
                                : rankedModels.filter((m) => m.tier === tier);
                              if (!list.length) return null;
                              return (
                                <div key={tier} className="mb-1.5">
                                  <p className="text-[9.5px] text-nv-faint mb-1">{
                                    tier === 'measured' ? `★ Tested on your key ${new Date(scan!.scannedAt).toLocaleDateString()} — best first (JSON-capable, then fastest)`
                                    : tier === 'smart' ? '★ Recommended — handles agents, tools, research (closest to the default)'
                                    : 'Fast — quick replies & writing'}</p>
                                  <div className="flex flex-wrap gap-1">
                                    {list.slice(0, tier === 'fast' ? 4 : tier === 'smart' ? 6 : 10).map((m) => {
                                      const short = m.id.split('/').pop() || m.id;
                                      const on = modelName === m.id;
                                      const r = rowFor(m.id);
                                      return (
                                        <button key={m.id}
                                          title={`${m.id}\n${win(contextWindowFor(m.id))} context${r ? `\n${r.ms}ms · JSON ${r.jsonOk ? 'ok' : 'not returned'}` : '\nnot measured yet'}`}
                                          disabled={checking === m.id}
                                          /* CHECK IT BEFORE COMMITTING TO IT. A key cannot tell us which
                                             models it may use — the catalogue lists everything the provider
                                             hosts, and some of those accept a request and then never answer.
                                             One tiny call settles it in a second, so nobody picks a model
                                             that will silently hang every task they run. */
                                          onClick={async () => {
                                            setCheckNote(''); setChecking(m.id);
                                            const { probeModelDetailed, blockModel } = await import('../../lib/modelHealth');
                                            let key = apiKey;
                                            if (!key) { try { const c = await credentialStore.get(provider); key = (c?.api_key as string) || ''; } catch { /* none */ } }
                                            // MEASURE, don't just ping. The old probe asked "did it
                                            // answer" and nothing else, so a model that takes 27
                                            // seconds and cannot return JSON passed exactly like a
                                            // fast reliable one — and the user found out over the
                                            // following days, task by task.
                                            const res = await probeModelDetailed(provider, key, m.id, 30_000);
                                            setChecking(null);
                                            if (res.ok) {
                                              onModelNameChange(m.id);
                                              // PERSIST THE CHOICE. Lifting it into React state was
                                              // all this used to do, and the call path reads the
                                              // credential — so picking a big model changed the
                                              // label and nothing else, and the model auto-picked at
                                              // connect time went on answering every message.
                                              if (provider === 'nvidia' || provider === 'groq') {
                                                const { setByokModel } = await import('../../lib/byokKeys');
                                                await setByokModel(provider, m.id).catch(() => {});
                                              }
                                              // Record what we just learned so the ranking and the
                                              // chips reflect it without waiting for a full rescan.
                                              setScan((prev) => (prev
                                                ? { ...prev, rows: [...prev.rows.filter((x) => x.id !== m.id), { id: m.id, ms: res.ms, jsonOk: res.jsonOk, ok: true, window: contextWindowFor(m.id), tier: m.tier }] }
                                                : prev));
                                              const speed = res.ms < 1000 ? `${res.ms}ms` : `${(res.ms / 1000).toFixed(1)}s`;
                                              // Say plainly what they have just chosen. A big slow
                                              // model that answers in prose is a downgrade for this
                                              // app however impressive its parameter count, and the
                                              // user deserves to know before they live with it.
                                              const warn = !res.jsonOk
                                                ? ` ⚠ It answered in prose instead of the JSON it was asked for, so research plans, decks and reply-checking will be unreliable on it.`
                                                : res.ms > 8000 ? ` ⚠ That is slow — expect a long wait on every message.` : '';
                                              setCheckNote(`✓ ${short} answered in ${speed}${res.jsonOk ? ' with clean JSON' : ''} — now using it for every chat and agent.${warn}`);
                                              return;
                                            }
                                            blockModel(provider, m.id);
                                            setRankedModels((prev) => (prev ? prev.filter((x) => x.id !== m.id) : prev));
                                            setCheckNote(`${short} didn't respond on your key — your account may not have access to it. Removed from the list; pick another.`);
                                          }}
                                          className={`text-[10px] px-2 py-1 rounded-md border transition-fast flex items-center gap-1 ${on ? 'border-accent bg-accent/10 text-accent font-medium' : 'border-nv-border text-nv-muted hover:text-nv-text'} ${checking === m.id ? 'opacity-60' : ''}`}>
                                          {checking === m.id ? `checking ${short}…` : short}
                                          {/* The numbers that decide whether this model is any good,
                                              on the chip itself — speed, JSON, and how much it can read. */}
                                          {checking !== m.id && r && (
                                            <span className="text-[8.5px] text-nv-faint font-mono">
                                              {r.ms < 1000 ? `${r.ms}ms` : `${(r.ms / 1000).toFixed(1)}s`}·{r.jsonOk ? 'JSON' : 'prose'}·{win(contextWindowFor(m.id))}
                                            </span>
                                          )}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                            {/* A "✓ it works, BUT it can't do JSON" is not good news — colour it
                                by the warning, not by the tick that happens to start the line. */}
                            {checkNote && <p className={`text-[9.5px] mt-1 ${checkNote.startsWith('✓') && !checkNote.includes('⚠') ? 'text-emerald-400' : 'text-amber-400'}`}>{checkNote}</p>}
                            <p className="text-[9.5px] text-nv-faint mt-1">
                              {scan
                                ? `${scan.rows.filter((r) => r.ok).length} of ${scan.rows.length} models answered on your key; ${scan.rows.filter((r) => r.ok && r.jsonOk).length} can return JSON (needed for research, decks and reply checking). The list is measured, not a fixed favourite — press Rescan when NVIDIA adds models.`
                                : 'Each one is tested against your key when you pick it — an NVIDIA key doesn’t say which models your account may use, and a few accept requests without ever answering.'}
                            </p>
                          </>
                        )}
                  </div>
                )}

                {/* Model name — free-text (advanced / custom providers) */}
                <label className="text-nv-faint text-[11px] block mb-1.5">{(provider === 'nvidia' || provider === 'groq') ? 'Or type a model id' : 'Model'}</label>
                <input
                  value={modelName}
                  onChange={(e) => onModelNameChange(e.target.value)}
                  // Save when they finish typing, not on every keystroke — a half-typed model id
                  // written to the credential would be used by the next call.
                  onBlur={async () => {
                    if ((provider === 'nvidia' || provider === 'groq') && modelName.trim()) {
                      const { setByokModel } = await import('../../lib/byokKeys');
                      await setByokModel(provider, modelName.trim()).catch(() => {});
                    }
                  }}
                  placeholder={meta.defaultModel || 'model-name'}
                  className="w-full bg-nv-bg border border-nv-border rounded-lg px-3 py-2
                    text-[12px] text-nv-text outline-none focus:border-accent transition-fast mb-3"
                />

                {/* API key */}
                <label className="text-nv-faint text-[11px] block mb-1.5">API Key</label>
                <input
                  value={apiKey}
                  onChange={async (e) => {
                    const v = e.target.value;
                    // Tolerate a pasted code block / "Bearer …" here too — pull out the key. A
                    // normal typed key has no spaces and passes straight through.
                    if (/\s|bearer|api[_-]?key/i.test(v)) {
                      try { const { extractApiKey } = await import('../krew/ServiceSetupModal'); onApiKeyChange(extractApiKey(v, provider)); return; } catch { /* fall through */ }
                    }
                    onApiKeyChange(v);
                  }}
                  type="password"
                  placeholder={meta.keyPlaceholder}
                  className="w-full bg-nv-bg border border-nv-border rounded-lg px-3 py-2
                    text-[12px] text-nv-text outline-none focus:border-accent transition-fast"
                />
                <p className="text-nv-faint text-[10px] mt-2">
                  <span className="text-nv-muted font-semibold">Tip:</span> Leave blank — if you've connected a provider in ConnectApps, it's auto-used here. This field is only for a one-off key override.
                  Keys never leave your device.
                </p>

                {/* Free-key shortcut — the fast, free answer when a local model is too slow. NVIDIA
                    and Groq both give free API keys and cost no adris.tech tokens. */}
                <div className="mt-3 rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-2">
                  <p className="text-[10.5px] text-nv-text font-medium">No key? Get one free — fast cloud, no adris.tech tokens</p>
                  <p className="text-[10px] text-nv-faint leading-relaxed mt-0.5">
                    Pick <span className="text-nv-text">NVIDIA (free)</span> or <span className="text-nv-text">Groq</span> in Provider above, grab a free key, and paste it — or open the guided setup:
                  </p>
                  <div className="flex gap-1.5 mt-1.5">
                    <button
                      onClick={() => openFreeKeySetup('nvidia')}
                      className="text-[10px] px-2 py-0.5 rounded-md border border-accent/50 text-accent hover:bg-accent/10 transition-fast">Get NVIDIA key</button>
                    <button
                      onClick={() => openFreeKeySetup('groq')}
                      className="text-[10px] px-2 py-0.5 rounded-md border border-nv-border text-nv-muted hover:text-nv-text transition-fast">Get Groq key</button>
                  </div>
                </div>
              </>
            )}

            {popup === 'nivara' && (
              <div className="space-y-3">
                <p className="text-nv-muted text-[12px] leading-relaxed">
                  Powered by <span className="text-nv-text font-semibold">adris.tech AI</span> — runs securely on adris.tech servers. No API key needed.
                </p>
                <div className="rounded-lg border border-nv-border bg-nv-bg px-3 py-2 space-y-1">
                  <p className="text-[10px] text-nv-faint font-mono uppercase tracking-wide">Task limits</p>
                  {PLAN_ORDER.map((p) => {
                    const isCurrent = currentPlan === p || (currentPlan === 'free' && p === 'explore');
                    return (
                      <p key={p} className={`text-[11px] ${isCurrent ? 'text-accent font-semibold' : 'text-nv-muted'}`}>
                        {PLAN_LABELS[p]} · {PLAN_CONFIG[p].label}{isCurrent ? ' — your plan' : ''}
                      </p>
                    );
                  })}
                </div>
                <p className="text-[10px] text-nv-faint">
                  Hit the limit? Switch to Own Key mode — connect Gemini free in ConnectApps.
                </p>
              </div>
            )}

            </div>
            {/* Sticky footer so Done is always reachable no matter how tall the body scrolls. */}
            <div className="px-5 py-3 border-t border-nv-border shrink-0 bg-nv-surface">
              <button
                onClick={() => setPopup(null)}
                className="w-full text-[12px] py-2 rounded-lg bg-accent text-white hover:bg-accent-dim transition-fast"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
