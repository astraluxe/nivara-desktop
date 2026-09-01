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
  getAiSource, setAiSource, getAiAvailability, modelForProvider, AI_SOURCE_EVENT,
  type AiSourceMode, type AiSourcePref, type ByokProvider, type AiAvailability,
} from '../lib/aiSource';
import { CLI_LABEL, type AgentCli } from '../lib/agentCli';
import AiSourceDetail, { detailTitle, type Detail } from './AiSourceDetail';
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
  /**
   * A second screen behind this row: which local model, which model on this key, what the bridge
   * is. Opened in the same sheet rather than sent somewhere else — the panels that used to hold
   * this only existed at the top of Krew and Coder, so from any other screen the menu could offer
   * "Local model" with no way to see what was behind it.
   */
  detail?: Detail;
  /** True when the row cannot answer anything yet, so opening the detail IS the whole action. */
  needsSetup?: boolean;
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
export function buildChoices(
  avail: AiAvailability | null,
  // Needed so a key row can name the model it would actually think with, and only for the provider
  // the choice was made for.
  pref?: { provider?: string | null; model?: string | null } | null,
): Choice[] {
  const out: Choice[] = [];

  // BOTH are always listed, installed or not. Someone who pays for Codex needs to see that the app
  // supports it; a missing row says nothing, and "not installed" says exactly what to do.
  for (const cli of ['claude_code', 'codex'] as AgentCli[]) {
    const have = (avail?.clis ?? []).includes(cli);
    out.push({
      id: `cli:${cli}`, mode: 'agent_cli', cli,
      label: `Your ${CLI_LABEL[cli]}`,
      // NOT INSTALLED IS NO LONGER A DEAD END, so it must not read like one. The app installs it
      // now — its own Node, its own folder, no terminal — so the row invites rather than apologises,
      // and the cost line says what happens next instead of what is missing.
      blurb: have
        ? 'Thinks with the subscription you already pay for.'
        : `Already pay for ${CLI_LABEL[cli]}? adris will set it up for you — no terminal.`,
      cost: have ? 'included in your subscription' : 'set it up',
      logo: cli === 'claude_code' ? 'claude' : 'openai',
      // Deliberately NOT `unavailable`: that dims the row to 45% and makes it look unclickable,
      // which was right when there was nothing to click and is now exactly wrong.
      detail: { kind: 'cli', cli },
      needsSetup: !have,
    });
  }

  for (const p of avail?.byokProviders ?? []) {
    // WHICH MODEL, not just whose key. "billed by NVIDIA" answers who pays and not the question the
    // user actually has — what is it running? One key carries a dozen models and several of them do
    // not work, so a connected key without a model name is half an answer.
    const model = modelForProvider(p, pref ?? null);
    out.push({
      id: `key:${p}`, mode: 'own_key', provider: p,
      label: `Your ${PROVIDER_LABEL[p]} key`,
      blurb: model
        ? `Running ${model} on your own ${PROVIDER_LABEL[p]} key.`
        : `Runs on your own ${PROVIDER_LABEL[p]} key.`,
      cost: `billed by ${PROVIDER_LABEL[p]}`,
      logo: p,
      // Which model on that key is a real choice with real consequences — one answers in half a
      // second and another times out — so it gets a screen instead of being decided silently.
      detail: { kind: 'key', provider: p },
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
      detail: { kind: 'connect' },
      needsSetup: true,
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
      ? `Runs on this computer. Works with no internet. ${avail!.localModels.length} downloaded.`
      : 'Download one and it runs here, offline, with nothing leaving the machine.',
    cost: 'free',
    logo: 'local',
    detail: { kind: 'local' },
    needsSetup: !haveLocal,
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

/** What the collapsed pill in the title bar says: the source, and what it is thinking with. */
export interface SourcePill { label: string; detail: string; logo: string }

/**
 * The pill has to name what is ACTUALLY running.
 *
 * Two ways it did not. `getAiAvailability()` needs Tauri, a CLI probe and a session check, so
 * `avail` is null for the first stretch after launch — and with no key rows built yet,
 * currentChoiceId fell through to the "Connect your own key" row. Someone who had connected a key
 * months ago was told, on every launch, that they had not. The same fallback can land on a row of
 * an unrelated kind, which is how a machine running on an NVIDIA key came to be labelled Codex.
 *
 * So: when the exact row is there, use it. When it is not and we simply have not looked yet, trust
 * the stored preference — it was written at a moment when the thing did exist, which is better
 * evidence than a probe that has not answered. Only when we HAVE looked and it is genuinely gone
 * does the fallback row stand, because then it is true.
 *
 * The detail line carries the model, because "Your NVIDIA key" answers whose key and not the
 * question the user has, which is what it is thinking with.
 */
export function pillFor(pref: AiSourcePref, avail: AiAvailability | null, choices: Choice[]): SourcePill {
  const exact = choices.find((c) =>
    c.mode === pref.mode
    && (c.cli ?? null) === (pref.cli ?? null)
    && (c.provider ?? null) === (pref.provider ?? null));

  if (exact) {
    const model = exact.mode === 'own_key' && exact.provider ? modelForProvider(exact.provider, pref) : '';
    const local = exact.mode === 'local' ? String(pref.localModel ?? '').replace(/\.gguf$/i, '') : '';
    return { label: exact.label, detail: model || local || '', logo: exact.logo };
  }

  // Not found, and we have not finished looking: say what they chose, not what we cannot see yet.
  if (!avail) {
    if (pref.mode === 'own_key' && pref.provider) {
      return {
        label: `Your ${PROVIDER_LABEL[pref.provider as ByokProvider] ?? pref.provider} key`,
        detail: String(pref.model ?? ''),
        logo: String(pref.provider),
      };
    }
    if (pref.mode === 'local') {
      return { label: 'Local model', detail: String(pref.localModel ?? '').replace(/\.gguf$/i, ''), logo: 'local' };
    }
    if (pref.mode === 'agent_cli' && pref.cli) {
      return { label: `Your ${CLI_LABEL[pref.cli]}`, detail: 'subscription', logo: pref.cli === 'codex' ? 'codex' : 'claude_code' };
    }
    if (pref.mode === 'nivara') return { label: 'adris.tech', detail: '', logo: 'nivara' };
  }

  // We looked, and what they picked is not there. The fallback row is then the honest answer.
  const fallback = choices.find((c) => c.mode === pref.mode) ?? choices[choices.length - 1];
  return { label: fallback?.label ?? 'Automatic', detail: '', logo: fallback?.logo ?? 'auto' };
}

export default function AiSourceMenu() {
  const [pref, setPref] = useState<AiSourcePref>(getAiSource);
  const [avail, setAvail] = useState<AiAvailability | null>(null);
  const [open, setOpen] = useState(false);
  /** null = the source list; anything else = the second screen for that source. */
  const [detail, setDetail] = useState<Detail | null>(null);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const load = () => { getAiAvailability().then(setAvail).catch(() => {}); };
    load();
    // Kept in step with anything else that writes the same setting.
    const sync = () => setPref(getAiSource());
    window.addEventListener(AI_SOURCE_EVENT, sync);
    // A key connected (or removed) in Connect Apps changes what this menu can offer. Without this
    // the row for a key the user just added did not appear until the app was restarted.
    window.addEventListener('nv-creds-changed', load);
    return () => {
      window.removeEventListener(AI_SOURCE_EVENT, sync);
      window.removeEventListener('nv-creds-changed', load);
    };
  }, []);

  // Re-read what the machine offers each time the menu is opened, so a model downloaded or a CLI
  // installed since launch is there — this used to be read once, at mount.
  useEffect(() => { if (open) getAiAvailability().then(setAvail).catch(() => {}); }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) close(); };
    // Escape steps BACK one level before closing — a second screen you cannot leave without
    // losing the menu is the reason people stop opening it.
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (detail) setDetail(null); else close(); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open, detail]);

  function close() { setOpen(false); setDetail(null); }

  const choices = buildChoices(avail, pref);
  const currentId = currentChoiceId(pref, choices);
  const current = choices.find((c) => c.id === currentId) ?? choices[choices.length - 1];
  // What the pill SAYS is worked out separately from which row is highlighted, because the two
  // answer different questions: the row is "what did you pick", the pill is "what is running".
  // They diverge while availability is still loading — see pillFor.
  const pill = pillFor(pref, avail, choices);

  function pick(c: Choice) {
    // NOTHING HERE IS A DEAD END. A row that cannot answer yet — no key, nothing downloaded, a CLI
    // that is not installed — opens its own screen instead of selecting something that cannot run.
    // A choice that silently does nothing is worse than one that shows you what is missing.
    if (c.needsSetup) { setDetail(c.detail ?? null); return; }

    const next: AiSourcePref = { mode: c.mode };
    if (c.cli) next.cli = c.cli;
    if (c.provider) next.provider = c.provider;
    // The model belongs to the provider it was chosen for. Switching keys drops it rather than
    // sending a Groq model id to Gemini.
    if (c.provider && c.provider === pref.provider) next.model = pref.model;
    if (c.mode === 'local') next.localModel = pref.localModel ?? avail?.localModels[0]?.filename;
    setPref(next);
    setAiSource(next);      // one write; every module reads this

    // Selecting is complete on its own — the source is now in force everywhere. Where there is
    // something further to say (which model, what the bridge means), stay open on that screen
    // rather than closing and leaving the user to find it.
    if (c.detail) setDetail(c.detail); else close();
  }

  // A subscription or a local model costs nothing extra, so it is worth showing in the accent
  // colour — it is the state the user should be pleased to see.
  const isFree = current?.mode === 'agent_cli' || current?.mode === 'local';

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={`AI runs on: ${pill.label}${pill.detail ? ` · ${pill.detail}` : ''} (${current?.cost}). This applies everywhere in the app.`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1.5 h-[22px] pl-2 pr-1.5 rounded-full border text-[10px] font-medium
                    transition-colors duration-fast ease-nv ${isFree
          ? 'bg-accent/15 border-accent/45 text-accent'
          : 'bg-nv-surface2/60 border-nv-border text-nv-muted hover:text-nv-text hover:border-accent/35'}`}
      >
        <MenuMark id={pill.logo} className="w-3 h-3 shrink-0" />
        <span className="max-w-[130px] truncate">{pill.label}</span>
        {/* WHICH MODEL, beside whose key — "Your NVIDIA key" answers who pays and not what it is
            thinking with, and one key carries a dozen models. Muted and separated by a dot, the
            same shape the menu rows use for their own right-hand note. Hidden on a narrow window
            so the pill never pushes the window controls. */}
        {pill.detail && (
          <span className="hidden lg:inline max-w-[150px] truncate opacity-60">· {pill.detail}</span>
        )}
        <svg viewBox="0 0 24 24" className={`w-3 h-3 shrink-0 transition-transform duration-fast ease-nv ${open ? 'rotate-180' : ''}`}
             fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div role="menu"
             className="absolute right-0 top-[26px] w-[300px] nv-sheet p-1.5 z-50 nv-rise
                        max-h-[min(70vh,32rem)] overflow-y-auto overscroll-contain">
          {detail ? (
            <>
              {/* The way back is a whole row, not a 12px arrow. This sheet is 300px wide and the
                  people it is for do not hunt for chevrons. */}
              <button
                onClick={() => setDetail(null)}
                className="w-full flex items-center gap-1.5 px-2.5 pt-1 pb-2 text-[9.5px] uppercase
                           tracking-[0.12em] text-nv-faint hover:text-nv-text
                           transition-colors duration-fast ease-nv"
              >
                <svg viewBox="0 0 24 24" className="w-3 h-3 shrink-0" fill="none" stroke="currentColor"
                     strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
                <span className="truncate">{detailTitle(detail)}</span>
              </button>
              <AiSourceDetail
                detail={detail}
                avail={avail}
                pref={pref}
                // Re-read rather than trusting what was just written: the detail screens write the
                // preference themselves, and this is the one place both levels have to agree.
                onPick={() => { setPref(getAiSource()); getAiAvailability().then(setAvail).catch(() => {}); }}
              />
            </>
          ) : (
          <>
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
                  {/* There is more behind this row. Shown on every row that has a second screen,
                      including the selected one — "already chosen" and "nothing more to see" are
                      different things. */}
                  {c.detail && (
                    <svg viewBox="0 0 24 24" className="w-3 h-3 shrink-0 text-nv-faint" fill="none"
                         stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
                         strokeLinejoin="round" aria-hidden="true">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  )}
                </span>
                <span className="block pl-6 text-[10.5px] text-nv-muted leading-snug mt-0.5">{c.blurb}</span>
              </button>
            );
          })}
          <p className="px-2.5 pt-2 pb-1 text-[9.5px] text-nv-faint leading-snug">
            Krew, Guard, automations and every other module use this one choice.
          </p>
          </>
          )}
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
