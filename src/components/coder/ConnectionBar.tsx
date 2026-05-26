import { useState } from 'react';
import { ConnectionMode, Provider, PROVIDERS } from '../../lib/ai';

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
}

const MODES: { id: ConnectionMode; label: string; dotClass: string }[] = [
  { id: 'local',   label: 'Local',   dotClass: 'bg-nv-green' },
  { id: 'own_key', label: 'Own Key', dotClass: 'bg-nv-yellow' },
  { id: 'nivara',  label: 'Nivara',  dotClass: 'bg-accent' },
];

const PROVIDER_ORDER: Provider[] = [
  'openai', 'groq', 'mistral', 'perplexity', 'together', 'deepseek', 'claude', 'gemini', 'custom',
];

export default function ConnectionBar(props: Props) {
  const { mode, onModeChange, apiKey, onApiKeyChange, provider, onProviderChange,
          modelName, onModelNameChange, baseUrl, onBaseUrlChange,
          localModel, onLocalModelChange } = props;
  const [popup, setPopup] = useState<ConnectionMode | null>(null);

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
              {popup === 'local'   && 'Local Model (Ollama)'}
              {popup === 'own_key' && 'Own API Key'}
              {popup === 'nivara'  && 'Nivara Plan'}
            </p>

            {popup === 'local' && (
              <>
                <label className="text-nv-faint text-[11px] block mb-1.5">Ollama model name</label>
                <input
                  value={localModel}
                  onChange={(e) => onLocalModelChange(e.target.value)}
                  placeholder="llama3, mistral, codellama…"
                  className="w-full bg-nv-bg border border-nv-border rounded-lg px-3 py-2
                    text-[12px] text-nv-text outline-none focus:border-accent transition-fast"
                />
                <p className="text-nv-faint text-[10px] mt-2">
                  Ollama must be running on <span className="font-mono">localhost:11434</span>
                </p>
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
                  Uses <span className="text-nv-text font-semibold">Gemini 2.0 Flash</span> via Nivara's secure servers.
                  Your API key is never stored in this app.
                </p>
                <div className="rounded-lg border border-nv-border bg-nv-bg px-3 py-2 space-y-1">
                  <p className="text-[10px] text-nv-faint font-mono uppercase tracking-wide">Token limits</p>
                  <p className="text-[11px] text-nv-muted">Explore · 50K / month</p>
                  <p className="text-[11px] text-nv-muted">Solo · 500K / month</p>
                  <p className="text-[11px] text-nv-muted">Growth · 2M / month</p>
                  <p className="text-[11px] text-nv-muted">Builder · 10M / month</p>
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
