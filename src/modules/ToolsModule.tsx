// ─── The Shelf ───────────────────────────────────────────────────────────────
//
// Browse free business tools, install one without seeing a terminal, and then use it here.
//
// See ADRIS-OS/plan.md §12e for where the rules come from and lib/toolShelf.ts for what they are.
// The two that shape this screen:
//
//   "STARTING UP…" UNTIL THE PORT GENUINELY ANSWERS. A container that has been created is not a
//   working app, and opening a window at a port nothing is listening on looks broken in a way the
//   user cannot diagnose. `ready` here is only ever set by an answer from `tool_ready`.
//
//   NOTHING INSTALLS WITHOUT THE USER PRESSING THE BUTTON. An agent may suggest a tool and open this
//   page at it. It may not install one. That is not about capability — it is about who is
//   responsible for what ends up on the machine.

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import {
  TOOLS, toolById, isAllowedImage, dockerAdvice, phaseLabel, toolUrl, pickHostPort,
  aiWiringFor, allowedEnvKeys, requiredEnvFor, installableNow, composeFileFor, composeAllowed,
  type DockerState, type ToolApp, type ToolState, type ToolPhase, type AiWiring,
} from '../lib/toolShelf';
import { resolveAiSource } from '../lib/aiSource';
import ToolMarkIcon from '../components/ToolMarkIcon';

const STATE_KEY = 'nv-tool-states';

export default function ToolsModule({ openId, onStatesChange }: {
  /** A tool to show on arrival — set when the rail or an agent opened this page at one. */
  openId?: string | null;
  onStatesChange?: (s: Record<string, ToolState>) => void;
}) {
  const [docker, setDocker] = useState<DockerState | null>(null);
  const [states, setStates] = useState<Record<string, ToolState>>(() => {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch { return {}; }
  });
  const [viewing, setViewing] = useState<string | null>(openId ?? null);
  const [confirming, setConfirming] = useState<ToolApp | null>(null);
  /** The title-bar choice, reduced to what a container can be told. Null until it is known. */
  const [ai, setAi] = useState<{ mode: string; apiKey?: string | null; provider?: string | null } | null>(null);
  useEffect(() => {
    let dead = false;
    const read = () => {
      resolveAiSource()
        .then((r) => { if (!dead) setAi({ mode: r.mode, apiKey: r.apiKey, provider: r.provider }); })
        .catch(() => { if (!dead) setAi(null); });
    };
    read();
    window.addEventListener('nv-ai-source-changed', read);
    return () => { dead = true; window.removeEventListener('nv-ai-source-changed', read); };
  }, []);

  useEffect(() => { if (openId) setViewing(openId); }, [openId]);
  useEffect(() => {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(states)); } catch { /* quota */ }
    onStatesChange?.(states);
  }, [states, onStatesChange]);

  const patch = useCallback((id: string, p: Partial<ToolState>) => {
    setStates((s) => {
      // The existing entry is the base, or a fresh one. Written this way rather than as a literal
      // followed by spreads so `phase` is not declared and then silently overwritten.
      const base: ToolState = s[id] ?? { id, phase: 'absent' };
      return { ...s, [id]: { ...base, ...p, id } };
    });
  }, []);

  // ── What Docker says, and what is actually running ────────────────────────
  const refresh = useCallback(async () => {
    try {
      const d = JSON.parse(await invoke<string>('docker_state')) as DockerState;
      setDocker(d);
      if (!d.running) return;
      // ASK DOCKER, DO NOT TRUST MEMORY. A container the user stopped from Docker Desktop, or one
      // that died overnight, has to read as stopped here — a shelf insisting a tool is running
      // because it started it once is worse than one that says nothing.
      const list = JSON.parse(await invoke<string>('tool_list')) as {
        ok: boolean; containers: { id: string; state: string; hostPort?: number }[];
      };
      setStates((prev) => {
        const next: Record<string, ToolState> = {};
        for (const c of list.containers ?? []) {
          const running = /^run/i.test(c.state);
          // MEASURED, not guessed: a container that cannot start reports "restarting" forever while
          // Docker retries it. Calling that "stopped" hides a failure, and calling it "starting"
          // is a lie that never resolves — Vikunja did exactly this until its required config was
          // found. It gets its own phase and its own sentence.
          const crashing = /^restart/i.test(c.state);
          next[c.id] = {
            id: c.id,
            // Running is not the same as READY. The readiness poll below promotes it.
            phase: crashing ? 'crashing'
              : running ? (prev[c.id]?.phase === 'ready' ? 'ready' : 'starting')
                : 'stopped',
            // NEVER INVENT A PORT FOR A CONTAINER THAT ALREADY EXISTS.
            //
            // `pickHostPort` is a suggestion for a NEW install. Falling back to it here means that
            // a container published on any other port — one made before the id hashed differently,
            // one the user started themselves — gets an address it is not listening on, and the
            // panel shows "127.0.0.1 refused to connect". Exactly that happened in testing.
            //
            // Docker's answer, or nothing. Nothing keeps the tool in "Starting up…", which is
            // honest, instead of framing a dead port.
            hostPort: c.hostPort ?? prev[c.id]?.hostPort,
          };
        }
        return next;
      });
    } catch { setDocker({ installed: false, running: false }); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Progress from the pull, in docker's own words.
  useEffect(() => {
    const un = listen<{ id: string; step: string; phase: ToolPhase }>('tool_progress', (e) => {
      patch(e.payload.id, { step: e.payload.step, phase: e.payload.phase });
    });
    return () => { un.then((f) => f()).catch(() => {}); };
  }, [patch]);

  // ── The readiness poll ────────────────────────────────────────────────────
  //
  // The one thing that separates "a container exists" from "you can use it". Runs only while
  // something is actually starting, so an idle shelf does no work at all.
  const polling = useRef<Set<string>>(new Set());
  useEffect(() => {
    const starting = Object.values(states).filter((s) => s.phase === 'starting' && s.hostPort);
    for (const s of starting) {
      if (polling.current.has(s.id)) continue;
      polling.current.add(s.id);
      let tries = 0;
      const tick = async () => {
        tries++;
        try {
          if (await invoke<boolean>('tool_ready', { hostPort: s.hostPort })) {
            patch(s.id, { phase: 'ready', step: undefined });
            polling.current.delete(s.id);
            return;
          }
        } catch { /* not up yet */ }
        // Some of these genuinely take minutes on a first run — Invoice Ninja builds a database.
        // Ninety tries at two seconds is three minutes before it is called a failure.
        if (tries > 90) {
          patch(s.id, { phase: 'failed', error: 'It did not start answering. It may need longer, or the port may be in use.' });
          polling.current.delete(s.id);
          return;
        }
        setTimeout(tick, 2000);
      };
      setTimeout(tick, 2000);
    }
  }, [states, patch]);

  async function install(t: ToolApp) {
    setConfirming(null);
    // THE GATE, again, at the last moment before Docker is touched. Checked in the catalogue too;
    // checked here as well because this is the function that pulls, and a guard is worth most at
    // the point of the act. For a compose tool the check covers EVERY image the file names, not
    // just the app — a support image is exactly what gets added later without a re-check.
    const allowed = t.compose ? composeAllowed(t) : isAllowedImage(t.image);
    if (!allowed) { patch(t.id, { phase: 'failed', error: 'That tool is not in the catalogue.' }); return; }
    const hostPort = pickHostPort(t.id, Object.values(states).map((s) => s.hostPort ?? 0));

    // The model the user chose, handed to the tool that asked for one. Built ONLY from the keys the
    // tool declared — see allowedEnvKeys — so a container can never be handed a variable that is
    // not part of its own definition.
    // Configuration the tool refuses to start without, with its real address filled in. Separate
    // from the AI wiring because the two fail for different reasons and the user needs to know which.
    let env: [string, string][] = Object.entries(requiredEnvFor(t, hostPort)) as [string, string][];
    if (t.ai) {
      const w = aiWiringFor(t, ai as never);
      if (!w.ok) { patch(t.id, { phase: 'failed', error: `${w.reason} ${w.suggest}` }); return; }
      const allowed = allowedEnvKeys(t);
      env = [...env, ...Object.entries(w.env).filter(([k]) => allowed.includes(k))] as [string, string][];
    }

    patch(t.id, { phase: 'pulling', hostPort, step: 'Starting…', error: undefined });
    try {
      // A database-backed tool goes through compose. The YAML is GENERATED from the catalogue —
      // see composeFileFor — never assembled from anything a caller supplied.
      if (t.compose) {
        await invoke<string>('tool_compose_up', { id: t.id, yaml: composeFileFor(t, hostPort) });
        patch(t.id, { phase: 'starting', step: 'Waiting for it to answer…' });
        return;
      }
      await invoke<string>('tool_install', {
        id: t.id, image: t.image, port: t.port, hostPort, env,
        // Per tool: they do not agree on where their data lives, and mounting the wrong path makes
        // a container crash-loop on "permission denied" rather than fail visibly.
        dataPath: t.dataPath ?? '/data',
      });
      patch(t.id, { phase: 'starting', step: 'Waiting for it to answer…' });
    } catch (e) {
      patch(t.id, { phase: 'failed', error: e instanceof Error ? e.message : String(e) });
    }
  }

  const advice = dockerAdvice(docker);
  const current = viewing ? toolById(viewing) : null;
  const currentState = viewing ? states[viewing] : undefined;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-nv-bg">
      <div className="flex items-center gap-2 px-4 h-11 border-b border-nv-border shrink-0">
        <h1 className="text-[13px] font-semibold text-nv-text">
          {current ? current.name : 'Tools'}
        </h1>
        {current && (
          <button onClick={() => setViewing(null)}
                  className="text-[10.5px] text-nv-faint hover:text-nv-text transition-fast">
            ← all tools
          </button>
        )}
        <div className="flex-1" />
        {docker?.running && <span className="text-[10px] text-nv-faint">Docker ready</span>}
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        {!advice.ok ? (
          <DockerMissing advice={advice} onRetry={() => void refresh()} />
        ) : current ? (
          <ToolDetail
            tool={current}
            state={currentState}
            wiring={current.ai ? aiWiringFor(current, ai as never) : null}
            onInstall={() => setConfirming(current)}
            // A compose tool is several containers. Stopping only the app would leave its database
            // running, and removing only the app would leave the data behind — so both go through
            // compose when there is a compose file.
            onStop={async () => {
              if (current.compose) await invoke('tool_compose_down', { id: current.id, purge: false });
              else await invoke('tool_stop', { id: current.id });
              void refresh();
            }}
            onRemove={async () => {
              if (current.compose) await invoke('tool_compose_down', { id: current.id, purge: true });
              else await invoke('tool_remove', { id: current.id });
              void refresh();
            }}
          />
        ) : (
          <Catalogue states={states} onPick={setViewing} />
        )}
      </div>

      {confirming && (
        <ConfirmInstall tool={confirming} onCancel={() => setConfirming(null)} onConfirm={() => void install(confirming)} />
      )}
    </div>
  );
}

// ── Docker is not here, or not up ───────────────────────────────────────────

function DockerMissing({ advice, onRetry }: {
  advice: ReturnType<typeof dockerAdvice>; onRetry: () => void;
}) {
  return (
    <div className="max-w-[520px] mx-auto mt-12 px-6 text-center">
      <p className="text-[15px] font-semibold text-nv-text">{advice.headline}</p>
      <p className="text-[12px] text-nv-muted leading-relaxed mt-2">{advice.detail}</p>
      <div className="flex items-center justify-center gap-2 mt-4">
        {advice.action === 'install' && (
          <button
            onClick={() => { openExternal('https://www.docker.com/products/docker-desktop/').catch(() => {}); }}
            className="text-[11px] px-3 py-1.5 rounded-nv bg-accent text-white hover:bg-accent-dim transition-fast font-medium"
          >Get Docker Desktop</button>
        )}
        <button onClick={onRetry}
                className="text-[11px] px-3 py-1.5 rounded-nv border border-nv-border text-nv-muted hover:text-nv-text transition-fast">
          Check again
        </button>
      </div>
      <p className="text-[10.5px] text-nv-faint leading-relaxed mt-5">
        These tools run inside Docker so they stay separate from the rest of your computer. Nothing
        is installed into Windows, and removing a tool removes all of it.
      </p>
    </div>
  );
}

// ── The catalogue ───────────────────────────────────────────────────────────

function Catalogue({ states, onPick }: {
  states: Record<string, ToolState>; onPick: (id: string) => void;
}) {
  return (
    <div className="p-4 max-w-[860px] mx-auto">
      <p className="text-[12px] text-nv-muted leading-relaxed mb-4">
        Free, open software that does what the paid tools do — running on this computer, with your
        data staying on it. adris installs and runs each one for you; there is no terminal and
        nothing to configure.
      </p>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' }}>
        {TOOLS.map((t) => {
          const st = states[t.id];
          const on = st && st.phase !== 'absent';
          return (
            <button key={t.id} onClick={() => onPick(t.id)}
                    className="text-left nv-card p-3 hover:border-accent/40 transition-colors duration-fast ease-nv">
              <div className="flex items-center gap-2">
                {/* The project's own mark, so the card is recognisable before it is read. */}
                <ToolMarkIcon id={t.id} name={t.name} size={22} />
                <span className="text-[12.5px] font-semibold text-nv-text flex-1 truncate">{t.name}</span>
                {on && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full shrink-0 ${
                    st.phase === 'ready' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-amber-500/15 text-amber-500'}`}>
                    {phaseLabel(st.phase)}
                  </span>
                )}
              </div>
              {/* THE SENTENCE THAT MEANS SOMETHING TO A BUYER. Not what it is — what they can stop
                  paying for. */}
              <p className="text-[10.5px] text-accent mt-1">Instead of {t.replaces}</p>
              {/* LISTED, BUT NOT PRETENDING. Every ERP and CRM a business actually wants needs a
                  database beside it, and a single `docker run` starts one container. Saying so on
                  the card is better than an Install button that produces a crash loop — which is
                  exactly what an unmarked Vikunja did. See T1c. */}
              {!installableNow(t) && (
                <p className="text-[9.5px] text-amber-500/90 mt-1">Needs a database — adris cannot set this one up yet</p>
              )}
              <p className="text-[11px] text-nv-muted leading-snug mt-1">{t.blurb}</p>
              <p className="text-[9.5px] text-nv-faint mt-1.5">{t.licence} · {t.repo}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── One tool ────────────────────────────────────────────────────────────────

function ToolDetail({ tool, state, wiring, onInstall, onStop, onRemove }: {
  tool: ToolApp; state?: ToolState;
  /** Null for a tool that needs no model. */
  wiring: AiWiring | null;
  onInstall: () => void; onStop: () => void; onRemove: () => void;
}) {
  const url = toolUrl(state);
  const phase = state?.phase ?? 'absent';

  // ── CAN WE EMBED IT? ──────────────────────────────────────────────────────
  //
  // Not all of them will allow it. n8n sends `X-Frame-Options: SAMEORIGIN`, and a blocked frame
  // renders as Chrome's **"127.0.0.1 refused to connect."** — which reads exactly like a dead port
  // and is nothing of the kind. Asking first means the user gets a real answer instead of an error
  // that sends them (and us) looking at the wrong thing entirely.
  //
  // `null` = not asked yet. Embedding optimistically while the answer is in flight would flash the
  // very error message this is here to avoid.
  const [frameable, setFrameable] = useState<boolean | null>(null);
  useEffect(() => {
    if (!url || !state?.hostPort) { setFrameable(null); return; }
    let dead = false;
    invoke<boolean>('tool_frameable', { hostPort: state.hostPort })
      .then((ok) => { if (!dead) setFrameable(ok); })
      .catch(() => { if (!dead) setFrameable(false); });
    return () => { dead = true; };
  }, [url, state?.hostPort]);

  // Running: hand the whole pane to the tool's own interface. The user came here to use it, not to
  // read about it, and its real UI is better than any summary of it.
  if (url) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-nv-border shrink-0">
          <span className="text-[10px] text-nv-faint flex-1 truncate">{tool.name} · running on this computer</span>
          <button onClick={() => { openExternal(url).catch(() => {}); }}
                  className="text-[10px] text-nv-faint hover:text-accent transition-fast">Open in browser</button>
          <button onClick={onStop}
                  className="text-[10px] text-nv-faint hover:text-nv-text transition-fast">Stop</button>
        </div>

        {frameable === null && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-[11px] text-nv-faint">Opening {tool.name}…</p>
          </div>
        )}

        {frameable === true && (
          <iframe src={url} title={tool.name} className="flex-1 w-full border-0 bg-white" />
        )}

        {frameable === false && (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="max-w-[420px] text-center">
              <p className="text-[13px] font-semibold text-nv-text">{tool.name} opens in your browser</p>
              <p className="text-[11.5px] text-nv-muted leading-relaxed mt-2">
                It is running on this computer and it is working — it just does not allow itself to be
                shown inside another app, which is a deliberate security setting on its side and a
                sensible one. Nothing is wrong with your install.
              </p>
              <button
                onClick={() => { openExternal(url).catch(() => {}); }}
                className="mt-4 px-3.5 py-2 rounded-lg bg-accent text-white text-[12px] font-medium hover:opacity-90 transition-fast"
              >
                Open {tool.name}
              </button>
              <p className="text-[10px] text-nv-faint mt-3 font-mono">{url}</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-[560px] mx-auto p-6">
      <p className="text-[10.5px] text-accent">Instead of {tool.replaces}</p>
      {/* ✅ MEANS SEEN WORKING, applied to a catalogue. An entry only read about is a claim, and a
          one-click install that crash-loops is worse than no entry — the user cannot tell whether
          they did something wrong. Vikunja was removed for exactly that; see toolShelf.ts. */}
      {!tool.verified && (
        <p className="text-[10px] text-amber-500/90 mt-1">
          Not yet tested by us on Windows. It should work, and if it does not, tell us rather than
          assuming you did something wrong.
        </p>
      )}
      <h2 className="text-[16px] font-semibold text-nv-text mt-0.5">{tool.name}</h2>
      <p className="text-[12px] text-nv-muted leading-relaxed mt-1.5">{tool.blurb}</p>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-nv-faint mt-3">
        <span>Licence: {tool.licence}</span>
        <button onClick={() => { openExternal(`https://github.com/${tool.repo}`).catch(() => {}); }}
                className="hover:text-accent transition-fast">{tool.repo} ↗</button>
      </div>
      {tool.note && <p className="text-[10.5px] text-nv-faint mt-2">{tool.note}</p>}

      {/* WHICH MODEL IT WILL RUN ON, before the user installs it. An AI tool that arrives with no
          model behind it is an empty box, and finding that out afterwards is the worst moment to
          find it out. The refusals are shown here too, with what to do instead — see aiWiringFor
          for why adris.tech and the CLI bridge are not passed on. */}
      {wiring && (
        <div className={`mt-3 rounded-nv px-2.5 py-2 border ${wiring.ok
          ? 'border-accent/30 bg-accent/[0.06]' : 'border-amber-500/35 bg-amber-500/[0.06]'}`}>
          {wiring.ok ? (
            <p className="text-[10.5px] text-nv-muted leading-relaxed">
              This runs on <span className="text-accent font-medium">{wiring.describe}</span> — the same
              choice as the rest of adris, from the menu at the top of the window.
            </p>
          ) : (
            <>
              <p className="text-[10.5px] text-nv-text font-medium">{wiring.reason}</p>
              <p className="text-[10.5px] text-nv-muted leading-relaxed mt-0.5">{wiring.suggest}</p>
            </>
          )}
        </div>
      )}

      {(phase === 'pulling' || phase === 'starting') && (
        <div className="mt-4">
          <div className="h-1 rounded-full bg-nv-surface2 overflow-hidden">
            <div className="h-full bg-accent animate-pulse" style={{ width: phase === 'pulling' ? '45%' : '85%' }} />
          </div>
          <p className="text-[11px] text-nv-muted mt-2">{state?.step ?? phaseLabel(phase)}</p>
          {/* Said out loud, because a progress bar that has not moved for two minutes reads as a
              hang and the honest answer is that it is downloading something large. */}
          <p className="text-[10px] text-nv-faint mt-1">
            The first time is the slow one — it is downloading the whole program. You can leave this
            page; it keeps going.
          </p>
        </div>
      )}

      {phase === 'crashing' && <CrashReason id={tool.id} />}

      {phase === 'failed' && (
        <div className="mt-4 rounded-nv border border-red-500/35 bg-red-500/5 px-3 py-2">
          <p className="text-[11px] text-nv-text font-medium">It did not start</p>
          <p className="text-[10.5px] text-nv-muted mt-0.5">{state?.error}</p>
        </div>
      )}

      <div className="flex items-center gap-2 mt-5">
        {!installableNow(tool) ? (
          <div className="rounded-nv border border-amber-500/35 bg-amber-500/[0.06] px-3 py-2">
            <p className="text-[11px] text-nv-text font-medium">adris cannot install this one yet</p>
            <p className="text-[10.5px] text-nv-muted leading-relaxed mt-0.5">
              {tool.name} needs a database running beside it, and adris can currently start only one
              program at a time. It is listed so you can see it is coming — and so you know adris
              knows about it.
            </p>
          </div>
        ) : (phase === 'absent' || phase === 'failed') && (
          <button onClick={onInstall}
                  className="text-[11px] px-3 py-1.5 rounded-nv bg-accent text-white hover:bg-accent-dim transition-fast font-medium">
            Install {tool.name}
          </button>
        )}
        {phase === 'stopped' && (
          <button onClick={onInstall}
                  className="text-[11px] px-3 py-1.5 rounded-nv bg-accent text-white hover:bg-accent-dim transition-fast font-medium">
            Start it
          </button>
        )}
        {phase !== 'absent' && (
          <button onClick={onRemove}
                  className="text-[10.5px] text-nv-faint hover:text-red-400 transition-fast">
            Remove it and its data
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Asked before anything is downloaded.
 *
 * Not a formality. This is software from the internet arriving on a business owner's computer, and
 * the honest thing is to say what is about to happen, how big it is, and who wrote it — before, not
 * after. It is also the line that keeps an agent from installing things: the button is here, and
 * only a person can press it.
 */
function ConfirmInstall({ tool, onCancel, onConfirm }: {
  tool: ToolApp; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onCancel}>
      <div className="nv-sheet w-[min(92vw,26rem)] p-5" onClick={(e) => e.stopPropagation()}>
        <p className="text-[13px] font-semibold text-nv-text">Install {tool.name}?</p>
        <p className="text-[11.5px] text-nv-muted leading-relaxed mt-2">
          adris will download {tool.name} from its official publisher and run it on this computer,
          inside Docker. It cannot see your files. Removing it later takes everything with it.
        </p>
        <div className="mt-3 rounded-nv border border-nv-border bg-nv-bg/60 px-2.5 py-2 text-[10.5px] text-nv-faint leading-relaxed">
          <div>From <span className="text-nv-text">{tool.repo}</span></div>
          <div>Licence <span className="text-nv-text">{tool.licence}</span></div>
          <div className="mt-1">Your data stays on this computer. Nothing is sent to adris.tech.</div>
        </div>
        <div className="flex items-center justify-end gap-2 mt-4">
          <button onClick={onCancel}
                  className="text-[11px] px-3 py-1.5 rounded-nv border border-nv-border text-nv-muted hover:text-nv-text transition-fast">
            Not now
          </button>
          <button onClick={onConfirm}
                  className="text-[11px] px-3 py-1.5 rounded-nv bg-accent text-white hover:bg-accent-dim transition-fast font-medium">
            Install it
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Why a tool keeps stopping, in its own words.
 *
 * "Keeps stopping" on its own is not actionable. Vikunja said "service.publicurl is required when
 * cors.enable is true" — one line saying exactly what was wrong, which the user would otherwise
 * only ever see by learning `docker logs`. That is the whole gap this closes.
 */
function CrashReason({ id }: { id: string }) {
  const [log, setLog] = useState<string>('');
  useEffect(() => {
    let dead = false;
    invoke<string>('tool_logs', { id })
      .then((t) => { if (!dead) setLog(t); })
      .catch(() => {});
    return () => { dead = true; };
  }, [id]);
  // The newest line that looks like a complaint. A crash loop repeats itself, so one is enough.
  const reason = log.split('\n').filter((l) => /error|fatal|denied|required|refused/i.test(l)).pop();
  return (
    <div className="mt-4 rounded-nv border border-amber-500/35 bg-amber-500/5 px-3 py-2">
      <p className="text-[11px] text-nv-text font-medium">It keeps stopping and starting again</p>
      <p className="text-[10.5px] text-nv-muted mt-0.5">
        Docker is retrying it, so it will not settle on its own. This is what it said:
      </p>
      <p className="text-[10px] font-mono text-nv-faint mt-1.5 break-all leading-snug">
        {reason ? reason.slice(0, 300) : 'Nothing readable in its log yet.'}
      </p>
    </div>
  );
}
