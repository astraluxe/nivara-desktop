import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ConnectionMode, Provider, PROVIDERS } from '../../lib/ai';
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
          className="fixed inset-0 z-50 flex items-start justify-center pt-16"
          onClick={() => setPopup(null)}
        >
          <div
            className="bg-nv-surface border border-nv-border rounded-xl p-5 w-80 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[11px] font-semibold text-nv-text uppercase tracking-wider mb-4">
              {popup === 'local'   && 'Local Model'}
              {popup === 'own_key' && 'Own API Key'}
              {popup === 'nivara'  && 'adris.tech Plan'}
            </p>

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
                {/* Provider dropdown */}
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

                {/* Model name */}
                <label className="text-nv-faint text-[11px] block mb-1.5">Model</label>
                <input
                  value={modelName}
                  onChange={(e) => onModelNameChange(e.target.value)}
                  placeholder={meta.defaultModel || 'model-name'}
                  className="w-full bg-nv-bg border border-nv-border rounded-lg px-3 py-2
                    text-[12px] text-nv-text outline-none focus:border-accent transition-fast mb-3"
                />

                {/* API key */}
                <label className="text-nv-faint text-[11px] block mb-1.5">API Key</label>
                <input
                  value={apiKey}
                  onChange={(e) => onApiKeyChange(e.target.value)}
                  type="password"
                  placeholder={meta.keyPlaceholder}
                  className="w-full bg-nv-bg border border-nv-border rounded-lg px-3 py-2
                    text-[12px] text-nv-text outline-none focus:border-accent transition-fast"
                />
                <p className="text-nv-faint text-[10px] mt-2">
                  <span className="text-nv-muted font-semibold">Tip:</span> Leave blank — if you've connected Gemini (or OpenAI / Claude) in ConnectApps, it's auto-used here. This field is only for a one-off key override.
                  Keys never leave your device.
                </p>
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

            <button
              onClick={() => setPopup(null)}
              className="mt-4 w-full text-[12px] py-2 rounded-lg bg-accent text-white
                hover:bg-accent-dim transition-fast"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
}
