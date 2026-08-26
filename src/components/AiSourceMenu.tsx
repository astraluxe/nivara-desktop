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
  getAiSource, setAiSource, getAiAvailability, AI_SOURCE_EVENT, AI_SETUP_EVENT,
  type AiSourceMode, type AiSourcePref, type ByokProvider, type AiAvailability,
} from '../lib/aiSource';
import { CLI_LABEL, type AgentCli } from '../lib/agentCli';
import BrandLogo from './ui/BrandLogo';

interface Choice {
  id: string;
  mode: AiSourceMode;
  cli?: AgentCli;
  provider?: ByokProvider;
  label: string;
  blurb: string;
  /** What it costs the user, in their terms. This is the thing they actually want to know. */
  cost: string;
  /** Which real brand mark to draw. People recognise a logo far faster than they read a name. */
  logo: string;
  /**
   * Not usable yet, and why.
   *
   * Shown rather than hidden. A menu that silently omits Codex leaves someone who pays for Codex
   * with no way to know the app supports it — "it is not here" and "it is not installed" look
   * identical when the row is missing.
   */
  unavailable?: string;
  /** A setup panel to open instead of selecting. See AI_SETUP_EVENT. */
  setup?: 'own_key' | 'local' | 'omniroute';
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

  // BOTH are always listed, installed or not. Someone who pays for Codex needs to see that the app
  // supports it; a missing row says nothing, and "not installed" says exactly what to do.
  for (const cli of ['claude_code', 'codex'] as AgentCli[]) {
    const have = (avail?.clis ?? []).includes(cli);
    out.push({
      id: `cli:${cli}`, mode: 'agent_cli', cli,
      label: `Your ${CLI_LABEL[cli]}`,
      blurb: have
        ? 'Thinks with the subscription you already pay for.'
        : `Install ${CLI_LABEL[cli]} and it appears here — then adris runs on your subscription, not on credit.`,
      cost: have ? 'included in your subscription' : 'not installed',
      logo: cli === 'claude_code' ? 'claude' : 'openai',
      unavailable: have ? undefined : `${CLI_LABEL[cli]} is not on this computer.`,
    });
  }

  for (const p of avail?.byokProviders ?? []) {
    out.push({
      id: `key:${p}`, mode: 'own_key', provider: p,
      label: `Your ${PROVIDER_LABEL[p]} key`,
      blurb: `Runs on your own ${PROVIDER_LABEL[p]} key.`,
      cost: `billed by ${PROVIDER_LABEL[p]}`,
      logo: p,
    });
  }

  // No key connected: an entry that OPENS THE SETUP rather than one that cannot be chosen. The row
  // of mode buttons that used to do this is gone, so without it there is no route to the panel at
  // all. NVIDIA and Groq hand out free keys, which is the part people do not expect.
  if (!(avail?.byokProviders ?? []).length) {
    out.push({
      id: 'connect-key', mode: 'own_key',
      label: 'Connect your own key',
      blurb: 'NVIDIA and Groq give them away free. Nothing here is charged to you afterwards.',
      cost: 'free to set up',
      logo: 'openai',
      setup: 'own_key',
    });
  }

  out.push({
    id: 'nivara', mode: 'nivara',
    label: 'adris.tech',
    blurb: 'The hosted AI. Nothing to set up.',
    cost: 'pay per use',
    logo: 'adris',
  });

  const haveLocal = (avail?.localModels.length ?? 0) > 0;
  out.push({
    id: 'local', mode: 'local',
    label: 'Local model',
    blurb: haveLocal
      ? 'Runs on this computer. Works with no internet.'
      : 'Download one and it runs here, offline, with nothing leaving the machine.',
    cost: 'free',
    logo: 'local',
    setup: haveLocal ? undefined : 'local',
  });

  out.push({
    id: 'auto', mode: 'auto',
    label: 'Choose for me',
    // "Automatic" told the user nothing -- the owner's own reaction was "idk what that is". This
    // says what it will actually do, in the order it will do it.
    blurb: 'Picks whichever of the above you have, cheapest first: your subscription, then your own key, then adris.tech.',
    cost: 'varies',
    logo: 'auto',
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
    // Needs setting up first. Open the panel instead of selecting something that cannot run — a
    // choice that silently does nothing is worse than one that takes you where you have to go.
    if (c.setup) {
      window.dispatchEvent(new CustomEvent(AI_SETUP_EVENT, { detail: { which: c.setup } }));
      setOpen(false);
      return;
    }
    if (c.unavailable) return;      // listed so it is known to exist, not selectable

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
        <MenuMark id={current?.logo ?? 'auto'} className="w-3 h-3 shrink-0" />
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
                title={c.unavailable ?? c.blurb}
                className={`w-full text-left px-2.5 py-2 rounded-nv transition-colors duration-fast ease-nv
                            ${active ? 'bg-accent/[0.13] ring-1 ring-inset ring-accent/25'
                              : c.unavailable ? 'opacity-45 hover:bg-nv-surface2/40'
                                : 'hover:bg-nv-surface2/70'}`}
              >
                <span className="flex items-center gap-2">
                  {/* Colour ON here: the user is choosing between COMPANIES, and the hue is half of
                      what makes a logo recognisable. Elsewhere the marks stay monochrome so a list
                      does not turn into a paint chart. */}
                  <MenuMark id={c.logo} className="w-4 h-4 shrink-0" colour />
                  <span className={`text-[12px] font-semibold flex-1 truncate ${active ? 'text-accent' : 'text-nv-text'}`}>
                    {c.label}
                  </span>
                  <span className="text-[9px] text-nv-faint shrink-0">{c.cost}</span>
                </span>
                <span className="block pl-6 text-[10.5px] text-nv-muted leading-snug mt-0.5">{c.blurb}</span>
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

/**
 * A brand mark, or a drawn one for the two entries that are not a company.
 *
 * "Automatic" and "Local model" have no logo to borrow, and inventing one would be worse than
 * drawing what they actually mean — a choice being made for you, and a machine on your desk.
 */
function MenuMark({ id, className, colour = false }: { id: string; className?: string; colour?: boolean }) {
  if (id === 'auto') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"
           strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
        <circle cx="12" cy="12" r="3.2" />
      </svg>
    );
  }
  if (id === 'local') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"
           strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2.5" y="4" width="19" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </svg>
    );
  }
  return <BrandLogo id={id} className={className} colour={colour} />;
}
