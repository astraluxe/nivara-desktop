// ─── One choice, in the title bar, that governs the whole app ────────────────
//
// WHAT THIS REPLACES. The same decision — where the AI runs — was being made in three different
// places with three different controls: a picker in Guard, another in Settings, and Krew's own
// connection bar. A user who set "my own key" in one of them could still be spending adris.tech
// credit somewhere else, and there was nowhere to look to find out which was true.
//
// It is one setting (`nv-ai-source`, read by resolveAiSource) and it always was. So it gets ONE
// control, in the one piece of chrome every screen shares.
//
// WHY THE TITLE BAR. It changes what every module does, and a setting with that reach should be
// visible and changeable from everywhere rather than buried in whichever panel you happen to be
// looking at. It also means the answer to "what am I spending right now?" is always on screen.

import { useEffect, useRef, useState } from 'react';
import {
  getAiSource, setAiSource, getAiAvailability, AI_SOURCE_EVENT,
  type AiSourceMode, type AiSourcePref, type ByokProvider, type AiAvailability,
} from '../lib/aiSource';
import { CLI_LABEL, type AgentCli } from '../lib/agentCli';

interface Choice {
  id: string;
  mode: AiSourceMode;
  cli?: AgentCli;
  provider?: ByokProvider;
  label: string;
  blurb: string;
  /** What it costs the user, in their terms. This is the thing they actually want to know. */
  cost: string;
}

const PROVIDER_LABEL: Record<ByokProvider, string> = {
  gemini: 'Gemini', openai: 'OpenAI', claude: 'Claude',
  nvidia: 'NVIDIA', groq: 'Groq', omniroute: 'OmniRoute',
};

/**
 * Everything this machine can actually offer, in the order a person would consider it.
 *
 * A subscription they already pay for comes first, because it is the cheapest thing they can
 * choose — the whole point of the bridge is that their existing budget is larger than anything
 * adris could sell them.
 */
export function buildChoices(avail: AiAvailability | null): Choice[] {
  const out: Choice[] = [];

  for (const cli of avail?.clis ?? []) {
    out.push({
      id: `cli:${cli}`, mode: 'agent_cli', cli,
      label: `Your ${CLI_LABEL[cli]}`,
      blurb: 'Thinks with the subscription you already pay for.',
      cost: 'included in your subscription',
    });
  }

  for (const p of avail?.byokProviders ?? []) {
    out.push({
      id: `key:${p}`, mode: 'own_key', provider: p,
      label: `Your ${PROVIDER_LABEL[p]} key`,
      blurb: `Runs on your own ${PROVIDER_LABEL[p]} key.`,
      cost: `billed by ${PROVIDER_LABEL[p]}`,
    });
  }

  out.push({
    id: 'nivara', mode: 'nivara',
    label: 'adris.tech',
    blurb: 'The hosted AI. Nothing to set up.',
    cost: 'pay per use',
  });

  if ((avail?.localModels.length ?? 0) > 0) {
    out.push({
      id: 'local', mode: 'local',
      label: 'Local model',
      blurb: 'Runs on this computer. Works with no internet.',
      cost: 'free',
    });
  }

  out.push({
    id: 'auto', mode: 'auto',
    label: 'Automatic',
    blurb: 'Your own key if you have one, then adris.tech, then a local model.',
    cost: 'whichever is available',
  });

  return out;
}

/** Which entry the saved preference corresponds to. */
export function currentChoiceId(pref: AiSourcePref, choices: Choice[]): string {
  const exact = choices.find((c) =>
    c.mode === pref.mode
    && (c.cli ?? null) === (pref.cli ?? null)
    && (c.provider ?? null) === (pref.provider ?? null));
  if (exact) return exact.id;
  // The saved choice is no longer available — an uninstalled CLI, a removed key. Fall back to the
  // first entry of the same kind, and then to Automatic, rather than showing nothing selected.
  return choices.find((c) => c.mode === pref.mode)?.id ?? 'auto';
}

export default function AiSourceMenu() {
  const [pref, setPref] = useState<AiSourcePref>(getAiSource);
  const [avail, setAvail] = useState<AiAvailability | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    getAiAvailability().then(setAvail).catch(() => {});
    // Kept in step with anything else that writes the same setting.
    const sync = () => setPref(getAiSource());
    window.addEventListener(AI_SOURCE_EVENT, sync);
    return () => window.removeEventListener(AI_SOURCE_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const choices = buildChoices(avail);
  const currentId = currentChoiceId(pref, choices);
  const current = choices.find((c) => c.id === currentId) ?? choices[choices.length - 1];

  function pick(c: Choice) {
    const next: AiSourcePref = { mode: c.mode };
    if (c.cli) next.cli = c.cli;
    if (c.provider) next.provider = c.provider;
    if (c.mode === 'local') next.localModel = avail?.localModels[0]?.filename;
    setPref(next);
    setAiSource(next);      // one write; every module reads this
    setOpen(false);
  }

  // A subscription or a local model costs nothing extra, so it is worth showing in the accent
  // colour — it is the state the user should be pleased to see.
  const isFree = current?.mode === 'agent_cli' || current?.mode === 'local';

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={`AI runs on: ${current?.label} (${current?.cost}). This applies everywhere in the app.`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1.5 h-[22px] pl-2 pr-1.5 rounded-full border text-[10px] font-medium
                    transition-colors duration-fast ease-nv ${isFree
          ? 'bg-accent/15 border-accent/45 text-accent'
          : 'bg-nv-surface2/60 border-nv-border text-nv-muted hover:text-nv-text hover:border-accent/35'}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isFree
          ? 'bg-accent shadow-[0_0_6px_rgb(124_92_255_/_0.9)]'
          : 'bg-nv-faint'}`} />
        <span className="max-w-[130px] truncate">{current?.label ?? 'Automatic'}</span>
        <svg viewBox="0 0 24 24" className={`w-3 h-3 shrink-0 transition-transform duration-fast ease-nv ${open ? 'rotate-180' : ''}`}
             fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div role="menu"
             className="absolute right-0 top-[26px] w-[280px] nv-sheet p-1.5 z-50 nv-rise">
          <p className="px-2.5 pt-1 pb-2 text-[9.5px] uppercase tracking-[0.12em] text-nv-faint">
            AI runs on — everywhere in the app
          </p>
          {choices.map((c) => {
            const active = c.id === currentId;
            return (
              <button
                key={c.id}
                role="menuitemradio"
                aria-checked={active}
                onClick={() => pick(c)}
                className={`w-full text-left px-2.5 py-2 rounded-nv transition-colors duration-fast ease-nv
                            ${active ? 'bg-accent/[0.13] ring-1 ring-inset ring-accent/25' : 'hover:bg-nv-surface2/70'}`}
              >
                <span className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? 'bg-accent' : 'bg-nv-border'}`} />
                  <span className={`text-[12px] font-semibold flex-1 truncate ${active ? 'text-accent' : 'text-nv-text'}`}>
                    {c.label}
                  </span>
                  <span className="text-[9px] text-nv-faint shrink-0">{c.cost}</span>
                </span>
                <span className="block pl-3.5 text-[10.5px] text-nv-muted leading-snug mt-0.5">{c.blurb}</span>
              </button>
            );
          })}
          <p className="px-2.5 pt-2 pb-1 text-[9.5px] text-nv-faint leading-snug">
            Krew, Guard, automations and every other module use this one choice.
          </p>
        </div>
      )}
    </div>
  );
}
