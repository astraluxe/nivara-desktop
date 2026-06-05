import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const SETUP_KEY = 'nv-first-run-done-v1';

interface Props { onDone: () => void; }

interface ProgressEvent { step: string; pct: number; }

export function needsFirstRun(): boolean {
  return !localStorage.getItem(SETUP_KEY);
}

export default function FirstRunSetup({ onDone }: Props) {
  const [engineStatus, setEngineStatus] = useState<'pending' | 'downloading' | 'done' | 'error'>('pending');
  const [enginePct,    setEnginePct]    = useState(0);
  const [engineStep,   setEngineStep]   = useState('Checking…');
  const [voiceOpt,     setVoiceOpt]     = useState(false);
  const [voiceStatus,  setVoiceStatus]  = useState<'idle' | 'downloading' | 'done' | 'skip'>('idle');
  const [voicePct,     setVoicePct]     = useState(0);
  const [voiceStep,    setVoiceStep]    = useState('');

  useEffect(() => {
    // Listen for engine download progress
    const unsub1 = listen<ProgressEvent>('engine_download_progress', e => {
      setEngineStep(e.payload.step);
      setEnginePct(e.payload.pct);
      if (e.payload.pct >= 100) setEngineStatus('done');
    });

    const unsub2 = listen<ProgressEvent>('voice_setup_progress', e => {
      setVoiceStep(e.payload.step);
      setVoicePct(e.payload.pct);
      if (e.payload.pct >= 100) setVoiceStatus('done');
    });

    // Start engine check/download immediately
    startEngineSetup();

    return () => { unsub1.then(f => f()); unsub2.then(f => f()); };
  }, []);

  async function startEngineSetup() {
    // Check if already installed
    const installed = await invoke<boolean>('models_check_engine_installed').catch(() => false);
    if (installed) {
      setEngineStatus('done');
      setEnginePct(100);
      setEngineStep('AI engine ready ✓');
      return;
    }
    setEngineStatus('downloading');
    setEngineStep('Downloading AI engine…');
    try {
      await invoke('models_download_engine');
      setEngineStatus('done');
    } catch (e) {
      setEngineStatus('error');
      setEngineStep(`Failed: ${e}`);
    }
  }

  async function downloadVoice() {
    setVoiceStatus('downloading');
    setVoiceStep('Preparing…');
    try {
      await invoke('voice_download_setup');
      setVoiceStatus('done');
    } catch (e) {
      setVoiceStatus('idle');
      setVoiceStep(`Failed: ${e}`);
    }
  }

  function finish() {
    localStorage.setItem(SETUP_KEY, '1');
    onDone();
  }

  const engineDone  = engineStatus === 'done' || engineStatus === 'error';
  const canContinue = engineDone;

  return (
    <div className="fixed inset-0 z-50 bg-nv-bg flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="w-12 h-12 bg-accent/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg viewBox="0 0 26 24" fill="none" className="w-6 h-6 text-accent">
              <path d="M2 4 L9 4 L15 12 L9 20 L2 20 L8 12 Z" fill="currentColor"/>
              <path d="M12 4 L19 4 L25 12 L19 20 L12 20 L18 12 Z" fill="currentColor"/>
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-nv-text tracking-tight mb-1">
            Setting up adris.tech
          </h1>
          <p className="text-sm text-nv-faint">
            Takes about 30 seconds. Happens once.
          </p>
        </div>

        {/* Steps */}
        <div className="space-y-3 mb-6">

          {/* Step 1 — Core app */}
          <SetupRow
            label="Core app"
            sub="All modules, Krew agents, Cloud AI"
            status="done"
            pct={100}
            step="Ready ✓"
          />

          {/* Step 2 — AI engine */}
          <SetupRow
            label="Local AI engine"
            sub="Run models on your machine — no GPU needed"
            status={engineStatus}
            pct={enginePct}
            step={engineStep}
          />

          {/* Step 3 — Voice (optional) */}
          <div className={`rounded-xl border px-4 py-3 transition-colors ${
            voiceOpt
              ? 'border-accent/40 bg-accent/5'
              : 'border-nv-border bg-nv-surface'
          }`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[13px] font-medium text-nv-text">Voice (Whisper)</p>
                  <span className="text-[9px] font-mono bg-nv-surface2 border border-nv-border px-1.5 py-0.5 rounded text-nv-faint">
                    OPTIONAL · 1.5 GB
                  </span>
                </div>
                <p className="text-[11px] text-nv-faint mt-0.5">
                  Speak to adris.tech instead of typing
                </p>
                {voiceStatus === 'downloading' && (
                  <ProgressBar pct={voicePct} step={voiceStep} />
                )}
                {voiceStatus === 'done' && (
                  <p className="text-[11px] text-emerald-400 mt-1">Whisper ready ✓</p>
                )}
              </div>
              {voiceStatus === 'idle' && (
                <button
                  onClick={() => { setVoiceOpt(true); downloadVoice(); }}
                  className="shrink-0 text-[11px] px-3 py-1.5 rounded-lg border border-nv-border text-nv-faint hover:border-accent hover:text-accent transition-colors font-mono"
                >
                  Download
                </button>
              )}
              {voiceStatus === 'idle' && !voiceOpt && (
                <button
                  onClick={() => { setVoiceStatus('skip'); }}
                  className="shrink-0 text-[11px] text-nv-faint hover:text-nv-text transition-colors font-mono"
                >
                  Skip
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Continue button */}
        <button
          onClick={finish}
          disabled={!canContinue}
          className={`w-full py-3 rounded-xl text-[14px] font-semibold transition-colors ${
            canContinue
              ? 'bg-accent text-white hover:bg-accent/80'
              : 'bg-nv-surface text-nv-faint cursor-not-allowed'
          }`}
        >
          {canContinue ? 'Open adris.tech →' : 'Setting up…'}
        </button>

        {canContinue && voiceStatus === 'idle' && (
          <p className="text-center text-[11px] text-nv-faint mt-3">
            You can download Voice later in Settings
          </p>
        )}
      </div>
    </div>
  );
}

function SetupRow({ label, sub, status, pct, step }: {
  label: string; sub: string;
  status: 'pending' | 'downloading' | 'done' | 'error';
  pct: number; step: string;
}) {
  const icon = status === 'done'
    ? <span className="text-emerald-400 text-sm">✓</span>
    : status === 'error'
    ? <span className="text-red-400 text-sm">✗</span>
    : status === 'downloading'
    ? <span className="w-3 h-3 rounded-full border-2 border-accent border-t-transparent animate-spin block" />
    : <span className="w-3 h-3 rounded-full border border-nv-border block" />;

  return (
    <div className={`rounded-xl border px-4 py-3 transition-colors ${
      status === 'done' ? 'border-emerald-500/30 bg-emerald-500/5'
      : status === 'downloading' ? 'border-accent/40 bg-accent/5'
      : status === 'error' ? 'border-red-500/30 bg-red-500/5'
      : 'border-nv-border bg-nv-surface'
    }`}>
      <div className="flex items-center gap-3">
        <div className="w-5 h-5 flex items-center justify-center shrink-0">{icon}</div>
        <div className="flex-1">
          <p className="text-[13px] font-medium text-nv-text">{label}</p>
          <p className="text-[11px] text-nv-faint">{sub}</p>
          {status === 'downloading' && <ProgressBar pct={pct} step={step} />}
          {status === 'done' && pct < 100 && (
            <p className="text-[11px] text-emerald-400 mt-1">{step}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ProgressBar({ pct, step }: { pct: number; step: string }) {
  return (
    <div className="mt-2">
      <div className="h-1 bg-nv-border rounded-full overflow-hidden">
        <div
          className="h-full bg-accent rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[10px] text-nv-faint mt-1 font-mono">{step}</p>
    </div>
  );
}
