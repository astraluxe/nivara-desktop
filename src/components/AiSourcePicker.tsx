import { useState, useEffect } from 'react';
import {
  getAiSource, setAiSource, getAiAvailability,
  type AiSourceMode, type AiAvailability,
} from '../lib/aiSource';

// ─── DEPRECATED as a control; kept as a read-only indicator ──────────────────
//
// The same decision — where the AI runs — used to be made here, in Guard, in Settings and in Krew's
// own connection bar. Four controls, one setting. Someone who chose "my own key" in one of them
// could still be spending adris.tech credit somewhere else, and there was nowhere to look to find
// out which was true.
//
// There is now ONE control, in the title bar (AiSourceMenu), because a setting that governs every
// module belongs in the chrome every module shares. This component still renders — it says what is
// currently in force and points at where to change it — so the modules that showed a picker still
// show the answer, they just no longer offer a second, competing way to set it.

const OPTIONS: { id: AiSourceMode; label: string; blurb: string }[] = [
  { id: 'auto',    label: 'Automatic',    blurb: 'Use your own key if one is connected, otherwise adris.tech, otherwise a local model.' },
  { id: 'nivara',  label: 'adris.tech',   blurb: 'The hosted AI. Counts against your monthly allowance.' },
  { id: 'own_key', label: 'Your own key', blurb: 'Runs on your OpenAI, Gemini or Anthropic key. Billed by them, never against your allowance.' },
  { id: 'local',   label: 'Local model',  blurb: 'Runs on this machine. Free, works offline, nothing leaves the computer.' },
];

export default function AiSourcePicker({ compact = false }: { compact?: boolean }) {
  const [pref, setPref] = useState(getAiSource);
  const [avail, setAvail] = useState<AiAvailability | null>(null);

  useEffect(() => { getAiAvailability().then(setAvail).catch(() => {}); }, []);

  // choose/canUse/why lived here when this was a control. They are gone with it: keeping dead
  // setters around a component documented as read-only is how a second switch grows back.

  const active = OPTIONS.find((o) => o.id === pref.mode) ?? OPTIONS[0];

  return (
    <div className={compact ? '' : 'rounded-xl border border-nv-border bg-nv-surface p-3'}>
      {!compact && (
        <>
          <p className="text-[12px] font-medium text-nv-text mb-0.5">Where AI runs</p>
          <p className="text-[11.5px] leading-[1.6] text-nv-muted mb-2.5">
            One choice, used by everything — this module, the Krew chat, automations and Guard.
            Change it from the menu at the top of the window.
          </p>
        </>
      )}

      {/* A STATEMENT, NOT A SECOND SWITCH. This used to be a row of buttons that wrote the same
          setting the title-bar menu writes — two controls for one value, which is how someone ends
          up believing they are on their own key while another screen quietly spends adris.tech
          credit. It now reports what is in force and says where to change it. */}
      <div className="flex items-center gap-2 rounded-nv border border-nv-border bg-nv-bg/60 px-2.5 py-2">
        <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
        <span className="text-[11.5px] text-nv-text font-medium flex-1 truncate">{active.label}</span>
        <span className="text-[10px] text-nv-faint shrink-0">set at the top of the window</span>
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

      {/* WHICH key is not offered here: the title-bar menu lists every connected key as its own
          entry, so a second chooser would be the same competing-control problem in miniature.
          WHICH LOCAL MODEL is offered, because nothing else offers it — it refines a choice already
          made rather than making it again. */}
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

      {/* Gentle, positive heads-up: the free NVIDIA/Groq keys are great for everyday speed, but the
          hosted adris.tech AI is tuned for the heavy lifting. Framed as guidance, not a warning. */}
      {pref.mode === 'own_key' && (pref.provider === 'nvidia' || pref.provider === 'groq') && (
        <p className="text-[10.5px] text-nv-faint mt-2 leading-relaxed">
          <span className="text-accent">Tip:</span> {pref.provider === 'nvidia' ? 'NVIDIA' : 'Groq'} is free and
          fast — perfect for everyday drafting and quick tasks. For heavier work (long outreach, research,
          detailed documents), switching to <b className="text-nv-text">adris.tech AI</b> gives noticeably
          stronger results. Both stay one click away.
        </p>
      )}
    </div>
  );
}
