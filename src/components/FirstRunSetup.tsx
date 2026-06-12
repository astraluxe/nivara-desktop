import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const setupKey = (uid?: string) => uid ? `nv-first-run-done-v1-${uid}` : 'nv-first-run-done-v1';

interface Props { onDone: () => void; userId?: string; }

interface ProgressEvent { step: string; pct: number; }

export function needsFirstRun(userId?: string): boolean {
  return !localStorage.getItem(setupKey(userId));
}

export default function FirstRunSetup({ onDone, userId }: Props) {
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'downloading' | 'done' | 'skip'>('idle');
  const [voicePct,    setVoicePct]    = useState(0);
  const [voiceStep,   setVoiceStep]   = useState('');

  useEffect(() => {
    const unsub = listen<ProgressEvent>('voice_setup_progress', e => {
      setVoiceStep(e.payload.step);
      setVoicePct(e.payload.pct);
      if (e.payload.pct >= 100) setVoiceStatus('done');
    });
    return () => { unsub.then(f => f()); };
  }, []);

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
    localStorage.setItem(setupKey(userId), '1');
    onDone();
  }

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
            Welcome to adris.tech
          </h1>
          <p className="text-sm text-nv-faint">
            You're all set. One optional download below.
          </p>
        </div>

        {/* Steps */}
        <div className="space-y-3 mb-6">

          {/* Core app — always ready */}
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 flex items-center justify-center shrink-0">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <circle cx="10" cy="10" r="10" fill="#22c55e"/>
                  <path d="M5.5 10.5l3 3 6-6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-[13px] font-medium text-nv-text">Core app</p>
                <p className="text-[11px] text-nv-faint">All modules, Krew agents, Cloud AI — ready</p>
              </div>
            </div>
          </div>

          {/* Voice — optional */}
          <div className={`rounded-xl border px-4 py-3 transition-colors ${
            voiceStatus === 'downloading' || voiceStatus === 'done'
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
                  <div className="mt-2">
                    <div className="h-1 bg-nv-border rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent rounded-full transition-all duration-300"
                        style={{ width: `${voicePct}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-nv-faint mt-1 font-mono">{voiceStep}</p>
                  </div>
                )}
                {voiceStatus === 'done' && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <circle cx="7" cy="7" r="7" fill="#22c55e"/>
                      <path d="M3.5 7.5l2.5 2.5 4.5-4.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span className="text-[11px] text-emerald-400">Whisper ready</span>
                  </div>
                )}
              </div>
              {voiceStatus === 'idle' && (
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => downloadVoice()}
                    className="text-[11px] px-3 py-1.5 rounded-lg border border-nv-border text-nv-faint hover:border-accent hover:text-accent transition-colors font-mono"
                  >
                    Download
                  </button>
                  <button
                    onClick={() => setVoiceStatus('skip')}
                    className="text-[11px] text-nv-faint hover:text-nv-text transition-colors font-mono"
                  >
                    Skip
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Continue button — always enabled */}
        <button
          onClick={finish}
          className="w-full py-3 rounded-xl text-[14px] font-semibold transition-colors bg-accent text-white hover:bg-accent/80"
        >
          Open adris.tech →
        </button>

        {voiceStatus === 'idle' && (
          <p className="text-center text-[11px] text-nv-faint mt-3">
            You can download Voice later in Settings
          </p>
        )}
      </div>
    </div>
  );
}
