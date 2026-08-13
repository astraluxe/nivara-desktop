import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ConnectionMode, Provider, PROVIDERS, fetchRankedModels, type RankedModel } from '../../lib/ai';
import { contextWindowFor } from '../../lib/contextBudget';
import { rankScan, markUserChosen } from '../../lib/modelHealth';
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
  explore: 'Free', free: 'Free', solo: 'Solo', builder: 'Builder', business: 'Team', custom: 'Custom',
};

const MODES: { id: ConnectionMode; label: string; dotClass: string }[] = [
  { id: 'local',   label: 'Local',   dotClass: 'bg-nv-green' },
  { id: 'own_key', label: 'Own Key', dotClass: 'bg-nv-yellow' },
  { id: 'nivara',  label: 'adris.tech',  dotClass: 'bg-accent' },
];

// THE DROPDOWN IS BUILT FROM THIS LIST, NOT FROM PROVIDERS. A provider missing here simply does
// not exist as far as the user is concerned, however completely it is wired underneath.
//
// Two were missing. NVIDIA — despite the free-key box a few hundred lines below saying "Pick NVIDIA
// (free) in Provider above", which it was not possible to do. And OmniRoute, which was added as a
// provider, given a one-button installer and a help panel, and then could not be selected at all.
//
// Free first, because that is what someone opening this panel is usually looking for.
const PROVIDER_ORDER: Provider[] = [
  'nvidia', 'groq', 'omniroute',
  'openai', 'mistral', 'perplexity', 'together', 'deepseek', 'claude', 'gemini', 'custom',
];

/**
 * OmniRoute, set up by the app rather than by the user.
 *
 * "Install it from GitHub and paste the address" is a feature for people who already know how, and
 * everyone else stops reading at "install". This is the same one-button shape as connecting a key:
 * press it, watch it, done — and the address it produces is filled in automatically, because
 * asking someone to copy a localhost URL is exactly the step that loses them.
 *
 * It installs from npm, not GitHub: measured, omniroute is on registry.npmjs.org, and npm is a
 * different network path from GitHub release assets — which are blocked outright on this user's
 * ISP. Node comes from the copy the app already provisions, so a machine with no Node still works
 * and nothing lands system-wide.
 */
function OmniRouteSetup({ onBaseUrlChange }: {
  /** Filled in for the user once the gateway answers — copying a localhost URL by hand is exactly
   *  the step that loses people. */
  onBaseUrlChange: (v: string) => void;
}) {
  const [state, setState] = useState<'checking' | 'absent' | 'installing' | 'installed' | 'starting' | 'running' | 'error'>('checking');
  const [msg, setMsg] = useState('');
  const [pct, setPct] = useState(0);
  /** How many providers the gateway can actually route to. Zero means it is running and useless. */
  const [providers, setProviders] = useState<number | null>(null);
  /** A key the user has already connected in this app, offered for pasting into OmniRoute. */
  const [ownKey, setOwnKey] = useState<{ provider: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const dashUrl = 'http://127.0.0.1:20128';

  /** Ask the machine, not our own memory, what is true — see omniroute_status in Rust. */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const s = await invoke<{ installed: boolean; running: boolean; providers: number | null }>('omniroute_status');
      setProviders(s.providers ?? null);
      // A RUNNING GATEWAY MUST NOT LOOK STOPPED. Reopening the panel used to offer "Start" for a
      // process that had been up the whole time, which is why closing the popup read as stopping
      // it. If it answers, it is running, whatever this component last remembered.
      if (s.running) {
        setState('running');
        onBaseUrlChange(`${dashUrl}/v1/chat/completions`);
        return;
      }
      setState(s.installed ? 'installed' : 'absent');
    } catch { setState('absent'); }
  }, [onBaseUrlChange]);

  useEffect(() => {
    let alive = true;
    void refresh();
    const un = listen<{ step: string; pct: number }>('omniroute_progress', (e) => {
      if (!alive) return;
      setMsg(e.payload.step);
      setPct(e.payload.pct);
    });
    // The key the user already connected here is almost always the key OmniRoute wants, and
    // hunting for it again on a provider's website is exactly where people give up.
    void (async () => {
      try {
        for (const p of ['nvidia', 'groq', 'gemini', 'openai', 'claude']) {
          const c = await credentialStore.get(p).catch(() => null);
          if (c?.api_key) { if (alive) setOwnKey({ provider: p, key: c.api_key }); return; }
        }
      } catch { /* no key saved — the panel just says where to get one */ }
    })();
    return () => { alive = false; un.then((f) => f()).catch(() => {}); };
  }, [refresh]);

  async function install() {
    setState('installing'); setMsg('Starting…'); setPct(0);
    try {
      await invoke('omniroute_install');
      setState('installed'); setMsg('Installed.');
      await start();
    } catch (e) { setState('error'); setMsg(String(e)); }
  }

  async function start() {
    setState('starting'); setMsg('Starting the gateway…');
    try {
      const url = await invoke<string>('omniroute_start', {});
      onBaseUrlChange(url);
      setState('running');
      await refresh();
    } catch (e) { setState('error'); setMsg(String(e)); }
  }

  const busy = state === 'installing' || state === 'starting';

  // THREE NUMBERED STEPS, AND ONLY ONE IS EVER LIVE.
  //
  // This was a paragraph explaining what OmniRoute is, and a button. The honest reaction to it was
  // "idk if its working or not... or wht exactly i need to do". Somebody who has never run a server
  // needs to see where they are, what is already done, and the single next thing — not a
  // description of the software. Each step shows its own control only while it is the current one.
  const Step = ({ n, title, done, active, children }: {
    n: number; title: string; done: boolean; active: boolean; children?: React.ReactNode;
  }) => (
    <div className={`flex gap-2.5 px-2.5 py-2 rounded-lg ${active ? 'bg-accent/5 border border-accent/25' : 'border border-transparent'}`}>
      <span className={`shrink-0 w-5 h-5 rounded-full grid place-items-center text-[10px] font-semibold ${
        done ? 'bg-emerald-500 text-white' : active ? 'bg-accent text-white' : 'bg-nv-border text-nv-faint'
      }`}>{done ? '✓' : n}</span>
      <div className="min-w-0 flex-1">
        <p className={`text-[11.5px] font-medium ${done || active ? 'text-nv-text' : 'text-nv-faint'}`}>{title}</p>
        {active && children}
      </div>
    </div>
  );

  return (
    <div className="mb-3 rounded-lg border border-nv-border bg-nv-bg px-2.5 py-2.5">
      <p className="text-[11px] leading-relaxed text-nv-faint mb-2">
        <span className="text-nv-text font-medium">One address, many AI providers.</span> When one
        runs out of free quota it moves to another, so you are not stuck on whichever model still
        answers. It runs on your machine — your keys, nothing sent to adris.tech.
      </p>

      <Step n={1} title="Install it — about 2 minutes, once"
        done={state === 'installed' || state === 'starting' || state === 'running'}
        active={state === 'absent' || state === 'installing' || state === 'checking'}>
        <button
          onClick={install}
          disabled={busy || state === 'checking'}
          className="mt-1.5 text-[11px] px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent/85 transition-fast font-medium disabled:opacity-50"
        >
          {state === 'installing' ? 'Installing…' : state === 'checking' ? 'Checking…' : 'Install OmniRoute'}
        </button>
        {state === 'installing' && (
          <div className="mt-2">
            <div className="h-1 bg-nv-border rounded-full overflow-hidden">
              <div className="h-full bg-accent rounded-full transition-all duration-500" style={{ width: `${Math.max(pct, 8)}%` }} />
            </div>
            <p className="text-[10px] text-nv-faint mt-1">{msg}</p>
            <p className="text-[10px] text-nv-faint mt-0.5">Nothing for you to do. You can close this and come back.</p>
          </div>
        )}
      </Step>

      <Step n={2} title="Start it" done={state === 'running'}
        active={state === 'installed' || state === 'starting' || state === 'error'}>
        {state !== 'starting' && (
          <button
            onClick={start}
            disabled={busy}
            className="mt-1.5 text-[11px] px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent/85 transition-fast font-medium disabled:opacity-50"
          >Start OmniRoute</button>
        )}
        {state === 'starting' && (
          <>
            <p className="text-[10.5px] text-nv-faint mt-1">{msg}</p>
            <p className="text-[10px] text-nv-faint mt-0.5">A first start builds its database — up to three minutes. Leave it running.</p>
          </>
        )}
        {state === 'error' && <p className="text-[10.5px] text-nv-bad mt-1 leading-relaxed whitespace-pre-wrap">{msg}</p>}
      </Step>

      {/* "ADD A FREE PROVIDER KEY INSIDE IT" MEANT NOTHING, and the honest reaction was "wht is
          tht key now?? idk wht tht means". It reads as though the app is asking for something new.
          It is not. OmniRoute is an empty switchboard: it routes to AI providers, and until one of
          those providers' keys is inside it there is nothing on the other end of any wire. The key
          in question is the ordinary API key from NVIDIA or Groq — and if one is already connected
          in this app, it is the same key, so it is offered here rather than sent off to find it
          again. */}
      <Step n={3} title="Give it a provider key — the same kind you connect here"
        done={providers !== null && providers > 0} active={state === 'running'}>
        <p className="text-[10.5px] text-nv-faint mt-1 leading-relaxed">
          {providers !== null && providers > 0
            ? `Ready — ${providers} model${providers === 1 ? '' : 's'} available. Nothing else to do here.`
            : <>
                OmniRoute doesn&apos;t come with any AI of its own — it forwards your messages to
                providers like NVIDIA or Groq, so it needs one of their API keys before it can
                answer anything. Open it, go to <span className="text-nv-text">Connections → Add</span>,
                and paste a key.
              </>}
        </p>
        {/* The key they already have, one press away. Hunting for it again on a provider's website
            is exactly the step people stop at. */}
        {ownKey && !(providers && providers > 0) && (
          <div className="mt-1.5 flex items-center gap-2">
            <button
              onClick={async () => {
                try { await invoke('copy_text', { text: ownKey.key }); }
                catch { try { await navigator.clipboard.writeText(ownKey.key); } catch { /* no clipboard */ } }
                setCopied(true);
                setTimeout(() => setCopied(false), 2500);
              }}
              className="text-[10.5px] px-2.5 py-1 rounded-md border border-nv-border text-nv-text hover:border-accent/50 transition-fast"
            >{copied ? '✓ Copied — now paste it in OmniRoute' : `Copy my ${ownKey.provider} key`}</button>
            <span className="text-[10px] text-nv-faint">
              …{ownKey.key.slice(-6)} — already connected here
            </span>
          </div>
        )}
        {!ownKey && !(providers && providers > 0) && (
          <p className="text-[10px] text-nv-faint mt-1">
            No key saved in this app yet — NVIDIA and Groq both give one free in about a minute.
          </p>
        )}
        <div className="flex items-center gap-2 mt-1.5">
          <button
            onClick={() => {
              import('@tauri-apps/plugin-shell').then(({ open }) => open(dashUrl)).catch(() => window.open(dashUrl, '_blank'));
            }}
            className="text-[10.5px] px-2.5 py-1 rounded-md border border-accent/50 text-accent hover:bg-accent/10 transition-fast"
          >Open OmniRoute →</button>
          <button
            onClick={refresh}
            className="text-[10.5px] text-nv-faint hover:text-nv-text transition-fast"
          >Check again</button>
        </div>
      </Step>

      {state === 'running' && (
        <p className="text-[10.5px] text-emerald-400 mt-1.5 px-2.5 leading-relaxed">
          Gateway running at {dashUrl} — the address below is filled in for you. It keeps running on
          its own; closing this panel doesn&apos;t stop it.
        </p>
      )}
    </div>
  );
}

export default function ConnectionBar(props: Props) {
  const { mode, onModeChange, apiKey, onApiKeyChange, provider, onProviderChange,
          modelName, onModelNameChange, baseUrl, onBaseUrlChange,
          localModel, onLocalModelChange, currentPlan } = props;
  // 'omniroute' is a popup in its own right, not a mode. Rendering it off `provider` meant any
  // effect that corrected the provider — and one did, whenever the chosen provider had no key
  // yet — silently replaced this panel with the NVIDIA one while the user was looking at it.
  const [popup, setPopup] = useState<ConnectionMode | 'omniroute' | null>(null);
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
      // NOTHING IS HIDDEN ANY MORE — it is GROUPED. Models this key was caught not answering used
      // to be filtered out here, which is right about the danger (the catalogue lists everything the
      // provider hosts, not what your account may call) and wrong about the remedy: a model that was
      // rate-limited for one busy minute vanished with no explanation, and a user who knows they
      // have access to it is left thinking the app cannot see it. They are now shown under "didn't
      // answer when tested", with the reason, and can still be tried — which is exactly how a
      // rate-limited one gets recovered.
      if (!cancelled) { setRankedModels(list); setModelsLoading(false); }

      // Show whatever was measured before, then — if this key has never been swept — sweep it in
      // the background. Nothing waits on it: the popup stays usable and the numbers fill in.
      const { loadScan } = await import('../../lib/modelHealth');
      const saved = loadScan(provider, key);
      if (!cancelled) setScan(saved);
      if (!saved && !cancelled) void runScan(key);

      // MEASURE THE MODEL YOU ARE ACTUALLY ON, if the scan never covered it.
      //
      // A model connected after the last sweep — or one whose probe was rate-limited during it —
      // has no row, so it can only be listed as "not tested" while the user watches it working. One
      // probe settles that: it moves into the answered group with its real speed and JSON result,
      // and the popup stops disagreeing with the user's own experience. Costs a single tiny call,
      // and only when there is nothing on record.
      if (!cancelled && modelName && !(saved?.rows ?? []).some((r) => r.id === modelName)) {
        try {
          const { probeModelDetailed, contextWindowFor: ctxFor } = {
            ...(await import('../../lib/modelHealth')),
            contextWindowFor: (await import('../../lib/contextBudget')).contextWindowFor,
          };
          const res = await probeModelDetailed(provider, key, modelName, 20_000);
          if (!cancelled) {
            setScan((prev) => {
              const row = { id: modelName, ms: res.ms, jsonOk: res.jsonOk, ok: res.ok, reason: res.reason, window: ctxFor(modelName), tier: 'other' as const };
              return prev
                ? { ...prev, rows: [...prev.rows.filter((x) => x.id !== modelName), row] }
                : { provider, keyTail: key.slice(-6), scannedAt: Date.now(), rows: [row] };
            });
          }
        } catch { /* the popup is perfectly usable without this — it just shows "not tested" */ }
      }
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

  // ─── Capability, in words rather than numbers ────────────────────────────────────────────
  //
  // "128k context" means nothing to most of the people this app is for. What they actually need
  // to know is whether a model can hold a long document, or only a short chat — so say that, and
  // keep the number in the tooltip for anyone who wants it.
  const CAPABILITY = [
    { min: 200_000, label: 'High',   rank: 0, blurb: 'holds long documents — research, decks, big lists', cls: 'border-emerald-500/50 text-emerald-600 bg-emerald-500/10' },
    { min: 32_000,  label: 'Medium', rank: 1, blurb: 'good for chat, drafting and most everyday tasks',   cls: 'border-sky-500/50 text-sky-600 bg-sky-500/10' },
    { min: 0,       label: 'Basic',  rank: 2, blurb: 'short chats only — long tasks will get cut off',    cls: 'border-nv-border text-nv-faint' },
  ];
  const capabilityOf = (id: string) => {
    const w = contextWindowFor(id);
    return CAPABILITY.find((c) => w >= c.min) ?? CAPABILITY[CAPABILITY.length - 1];
  };
  // Filter + sort the picker. Default sort stays the app's own ranking, so what sits at the top is
  // genuinely what gets chosen for the user; "Most capable" is there for when they want the
  // biggest model rather than the most reliable one.
  const [capFilter, setCapFilter] = useState<'all' | 'High' | 'Medium' | 'Basic'>('all');
  const [capSort, setCapSort] = useState<'recommended' | 'capable'>('recommended');

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
    if (meta.defaultModel) {
      onModelNameChange(meta.defaultModel);
    } else {
      // A PROVIDER WITH NO DEFAULT MUST NOT INHERIT THE LAST ONE'S MODEL.
      //
      // Both branches above did the same thing, and neither fired when defaultModel was empty — so
      // switching from NVIDIA to OmniRoute kept "nvidia/nemotron-3.5-lightning-30b-a3b" and sent
      // an NVIDIA model id to a gateway that has never heard of it. Blank is also the right
      // default for OmniRoute: naming a model defeats the point, which is that it picks whichever
      // provider is actually up.
      onModelNameChange('');
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
        {/* OMNIROUTE BELONGS ON THIS ROW, NOT THREE CLICKS INSIDE OWN KEY.
            It was added as a provider, wired to Rust, given a one-button installer — and then
            looked for on this row twice by the person who asked for it. If the author of the app
            cannot find it, nobody will: the top row is where people decide what their AI runs on,
            and "a gateway I install" is that kind of decision, not a brand of API key.
            Underneath it IS own_key — same credentials, same free treatment, no new mode in the
            backend — so this button simply says "own key, and specifically this one". */}
        <button
          onClick={() => { onModeChange('own_key'); handleProviderChange('omniroute'); setPopup('omniroute'); }}
          title="A free gateway you run yourself — one address in front of many AI providers"
          className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded border transition-fast
            ${mode === 'own_key' && provider === 'omniroute'
              ? 'border-accent/50 text-accent bg-accent/10'
              : 'border-nv-border text-nv-faint hover:text-nv-muted hover:border-nv-muted'}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${mode === 'own_key' && provider === 'omniroute' ? 'bg-nv-green' : 'bg-nv-faint'}`} />
          OmniRoute
        </button>
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
                {popup === 'omniroute' && 'OmniRoute'}
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

            {/* OMNIROUTE GETS ITS OWN SCREEN, NOT A ROW BURIED IN THE OWN-KEY FORM.
                Pressing the OmniRoute button opened the Own Key panel: the title said "Own API
                Key", the first thing under it was a list of NVIDIA and Groq keys, and the actual
                OmniRoute setup was a hundred lines further down, below the fold. Nothing had gone
                wrong — it just looked like the button did nothing.
                A choice on the top row should land on a screen about that choice. */}
            {popup === 'omniroute' && (
              <>
                <OmniRouteSetup onBaseUrlChange={onBaseUrlChange} />

                <label className="text-nv-faint text-[11px] block mb-1.5">Gateway address</label>
                <input
                  value={baseUrl}
                  onChange={(e) => onBaseUrlChange(e.target.value)}
                  placeholder="http://127.0.0.1:20128/v1/chat/completions"
                  className="w-full bg-nv-bg border border-nv-border rounded-lg px-3 py-2
                    text-[12px] text-nv-text outline-none focus:border-accent transition-fast mb-3 font-mono"
                />

                {/* NO KEY FIELD, AND NO MODEL FIELD — both were asked for and neither is needed.
                    Measured against a running instance: GET /v1/models on the local gateway returns
                    200 with no Authorization header at all. The keys belong to the PROVIDERS and
                    live inside OmniRoute's own dashboard, which is also the only place they can be
                    entered. And the model is its whole purpose: it picks whichever provider is up,
                    so naming one here would fight the thing we installed it for.
                    Asking for either would have been asking for something the user cannot supply
                    from this screen and does not need. */}
                <div className="rounded-lg border border-nv-border bg-nv-bg px-3 py-2.5">
                  <p className="text-[11px] text-nv-text font-medium">One more step, in OmniRoute itself</p>
                  <p className="text-[10.5px] text-nv-faint leading-relaxed mt-1">
                    The gateway is empty until you add provider keys to it — free ones from NVIDIA,
                    Groq, Gemini and others. That happens on its own dashboard, not here. No key or
                    model is needed on this screen: the local gateway does not ask for one, and
                    choosing a model would defeat the point of letting it pick a provider that works.
                  </p>
                  <button
                    onClick={() => {
                      const dash = (baseUrl || 'http://127.0.0.1:20128').replace(/\/v1\/chat\/completions\/?$/, '');
                      import('@tauri-apps/plugin-shell')
                        .then(({ open }) => open(dash))
                        .catch(() => window.open(dash, '_blank'));
                    }}
                    className="mt-2 text-[10.5px] px-2.5 py-1 rounded-md border border-accent/50 text-accent hover:bg-accent/10 transition-fast"
                  >
                    Open the OmniRoute dashboard →
                  </button>
                </div>

                {/* A way out that does not require knowing OmniRoute lives inside Own Key. */}
                <button
                  onClick={() => { handleProviderChange('nvidia'); setPopup('own_key'); }}
                  className="mt-3 text-[10.5px] text-nv-faint hover:text-nv-text transition-fast"
                >
                  ← Use a normal API key instead
                </button>
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

                {/* Base URL — for any OpenAI-compatible endpoint the user hosts themselves.
                    OmniRoute is no longer handled here: it has its own screen above, because a
                    single row buried under the NVIDIA and Groq blocks read as the button not
                    working at all. */}
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
                            {(() => {
                              // ONE LIST, WITH EVERYTHING ON IT.
                              //
                              // This used to show EITHER the scan results (models that answered)
                              // OR, with no scan, six "smart" and four "fast" from the catalogue.
                              // Both ways hid models: anything added to the catalogue after the
                              // scan, anything whose probe was rate-limited during the sweep, and
                              // — with no scan at all — every model past the tenth. So a model you
                              // were connected to and working on could simply not be in the list.
                              //
                              // Now every model is here exactly once, grouped by what is actually
                              // KNOWN about it, which is the honest distinction: it answered, it
                              // has not been tried, or it did not answer and here is why. Nothing
                              // is silently dropped, and a model in the last group is still
                              // clickable — that is how a rate-limited one gets recovered.
                              const byId = new Map(rankedModels.map((m) => [m.id, m] as const));
                              const seen = new Set<string>();
                              const order: string[] = [];
                              const push = (id: string) => { if (id && !seen.has(id)) { seen.add(id); order.push(id); } };
                              if (modelName) push(modelName);          // in use — always first
                              rankedScan.forEach((r) => push(r.id));   // measured & working, best first
                              rankedModels.forEach((m) => push(m.id)); // the rest of the catalogue
                              (scan?.rows ?? []).forEach((r) => push(r.id));

                              const entryFor = (id: string) => byId.get(id) ?? { id, tier: 'other' as const };
                              const statusOf = (id: string): 'working' | 'untested' | 'failed' => {
                                const r = rowFor(id);
                                if (!r) return 'untested';
                                return r.ok ? 'working' : 'failed';
                              };
                              const GROUPS = [
                                { key: 'working'  as const, label: scan
                                    ? `★ Answered on your key when tested ${new Date(scan.scannedAt).toLocaleDateString()}`
                                    : '★ Answered on your key' },
                                { key: 'untested' as const, label: 'Not tested yet — available on your key, press Rescan to measure them' },
                                { key: 'failed'   as const, label: 'Did not answer when tested — you can still try one; a rate limit is temporary' },
                              ];
                              return GROUPS.map(({ key: gkey, label }) => {
                                let ids = order.filter((id) => statusOf(id) === gkey);
                                // The capability filter never hides the model you are ON.
                                if (capFilter !== 'all') ids = ids.filter((id) => id === modelName || capabilityOf(id).label === capFilter);
                                if (capSort === 'capable') {
                                  ids = ids.slice().sort((a, b) =>
                                    (a === modelName ? -1 : b === modelName ? 1 : 0)
                                    || capabilityOf(a).rank - capabilityOf(b).rank
                                    || contextWindowFor(b) - contextWindowFor(a));
                                }
                                const list = ids.map(entryFor);
                                if (!list.length) return null;
                                const tier = gkey;
                                return (
                                  <div key={tier} className="mb-1.5">
                                  <p className="text-[9.5px] text-nv-faint mb-1">{label} · {list.length}</p>
                                  {/* Filter + sort, on the FIRST group only — they apply to all of
                                      them. Plain words: someone choosing a model should not have to
                                      know what a token is. */}
                                  {tier === 'working' && (
                                    <div className="flex items-center gap-1 flex-wrap mb-1.5">
                                      {(['all', 'High', 'Medium', 'Basic'] as const).map((f) => (
                                        <button key={f} onClick={() => setCapFilter(f)}
                                          className={`text-[9px] px-1.5 py-0.5 rounded-full border transition-fast ${capFilter === f ? 'border-accent bg-accent text-white' : 'border-nv-border text-nv-faint hover:text-nv-text'}`}
                                        >{f === 'all' ? 'All' : f}</button>
                                      ))}
                                      <button
                                        onClick={() => setCapSort((s) => (s === 'recommended' ? 'capable' : 'recommended'))}
                                        className="ml-auto text-[9px] px-1.5 py-0.5 rounded-md border border-nv-border text-nv-faint hover:text-nv-text transition-fast"
                                        title="Recommended = most reliable for agent work. Most capable = biggest first."
                                      >{capSort === 'recommended' ? 'Sort: Recommended' : 'Sort: Most capable'}</button>
                                    </div>
                                  )}
                                  {/* NO CAP. Capping the list at six or ten is what made models
                                      invisible in the first place — it scrolls instead. */}
                                  <div className="flex flex-wrap gap-1 max-h-56 overflow-y-auto">
                                    {list.map((m) => {
                                      const short = m.id.split('/').pop() || m.id;
                                      const on = modelName === m.id;
                                      const r = rowFor(m.id);
                                      const cap = capabilityOf(m.id);
                                      return (
                                        <button key={m.id}
                                          title={`${m.id}\n${cap.label} capability — ${cap.blurb}\n${win(contextWindowFor(m.id))} context${r ? `\n${r.ms}ms · JSON ${r.jsonOk ? 'ok' : 'not returned'}` : '\nnot measured yet'}`}
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
                                            // NINETY SECONDS, AND A SECOND GO — not a flat thirty.
                                            //
                                            // Thirty seconds is shorter than several of these
                                            // models take on a good day: the sweep that built this
                                            // list measured 40s and 45s on the big ones. So a model
                                            // sitting right there in the list, shown as available,
                                            // answered a press with "didn't answer within 30
                                            // seconds" — the app telling the user something untrue
                                            // about their own key because it ran out of patience
                                            // first. It is a single call the user asked for and is
                                            // watching; there is no cost to waiting properly, and
                                            // the cost of not waiting is that a working model looks
                                            // broken.
                                            //
                                            // A timeout or a rate limit also gets one retry, because
                                            // on a free key the first of those is usually just a
                                            // busy minute.
                                            let res = await probeModelDetailed(provider, key, m.id, 90_000);
                                            if (!res.ok && (res.reason === 'timeout' || res.reason === 'rate_limit' || res.reason === 'unknown')) {
                                              setCheckNote(`${short} was slow to answer — giving it one more go…`);
                                              await new Promise((r) => setTimeout(r, res.reason === 'rate_limit' ? 6_000 : 1_500));
                                              res = await probeModelDetailed(provider, key, m.id, 90_000);
                                            }
                                            setChecking(null);
                                            if (res.ok) {
                                              onModelNameChange(m.id);
                                              // PERSIST THE CHOICE. Lifting it into React state was
                                              // all this used to do, and the call path reads the
                                              // credential — so picking a big model changed the
                                              // label and nothing else, and the model auto-picked at
                                              // connect time went on answering every message.
                                              // EVERY provider, not just the two free ones.
                                              // setByokModel is provider-agnostic — it writes the
                                              // model onto whichever credential is named — so this
                                              // guard only meant a Gemini or OpenAI user's choice
                                              // was lifted into React state and forgotten on the
                                              // next reload, while the model auto-picked at connect
                                              // time kept answering.
                                              {
                                                const { setByokModel } = await import('../../lib/byokKeys');
                                                await setByokModel(provider, m.id).catch(() => {});
                                                // AND RECORD THAT IT WAS A CHOICE, not a guess.
                                                // The self-heal replaces a model that stops
                                                // answering, and a big model going quiet while it
                                                // reads looks identical to one that has died — so
                                                // it demoted the 550B someone had just picked. This
                                                // is what tells it to leave a deliberate choice
                                                // alone. See markUserChosen in modelHealth.
                                                markUserChosen(provider, m.id);
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
                                            // Blame the right thing. Every failure used to read
                                            // "your account may not have access", and the model was
                                            // dropped from the list — so a free key that was simply
                                            // busy for ten seconds lost a model it owns perfectly
                                            // well, and the user was told something untrue about
                                            // their account. Only a genuine access failure retires
                                            // a model; a rate limit or a slow answer is worth
                                            // another try in a moment.
                                            if (res.reason === 'rate_limit') {
                                              setCheckNote(`${short} is rate-limited on your key right now — that is your provider's per-minute cap, not a problem with the model. Wait a moment and press it again.`);
                                            } else if (res.reason === 'timeout' || res.reason === 'unknown') {
                                              // Say what we waited and what it means, and do not
                                              // imply the model is at fault — twice past ninety
                                              // seconds is a busy provider far more often than a
                                              // broken model, and it stays in the list either way.
                                              setCheckNote(`${short} didn't answer within 90 seconds, twice. That is usually the provider being busy rather than anything wrong with the model — it's still in your list, so try again in a few minutes.`);
                                            } else {
                                              blockModel(provider, m.id);
                                              // Record the failure rather than deleting the model.
                                              // Removing it from the list is what left users hunting
                                              // for a model they knew they had; it now drops into
                                              // "did not answer", labelled, where they can see what
                                              // happened to it.
                                              setScan((prev) => (prev
                                                ? { ...prev, rows: [...prev.rows.filter((x) => x.id !== m.id), { id: m.id, ms: res.ms, jsonOk: false, ok: false, reason: res.reason, window: contextWindowFor(m.id), tier: m.tier }] }
                                                : prev));
                                              setCheckNote(`${short} isn't available on your key — your account doesn't have access to it. It's moved to "did not answer" below; pick another.`);
                                            }
                                          }}
                                          className={`text-[10px] px-2 py-1 rounded-md border transition-fast flex items-center gap-1 ${on ? 'border-accent bg-accent/10 text-accent font-medium' : 'border-nv-border text-nv-muted hover:text-nv-text'} ${checking === m.id ? 'opacity-60' : ''}`}>
                                          {checking === m.id ? `checking ${short}…` : short}
                                          {/* CAPABILITY IN WORDS, first. "High / Medium / Basic"
                                              answers the question someone is actually asking —
                                              can this thing handle my document? — where "128k"
                                              only answers it for people who already know. The
                                              measured numbers stay alongside for those who want
                                              them, and the full detail is in the tooltip. */}
                                          {checking !== m.id && (
                                            <span className={`text-[8px] px-1 py-px rounded border ${cap.cls}`}>{cap.label}</span>
                                          )}
                                          {checking !== m.id && r && r.ok && (
                                            <span className="text-[8.5px] text-nv-faint font-mono">
                                              {r.ms < 1000 ? `${r.ms}ms` : `${(r.ms / 1000).toFixed(1)}s`}·{r.jsonOk ? 'JSON' : 'prose'}·{win(contextWindowFor(m.id))}
                                            </span>
                                          )}
                                          {/* Never measured, or measured and failed. Say which, and
                                              what to do about it — showing nothing at all is what
                                              made a working model look like one the app had lost. */}
                                          {checking !== m.id && !r && (
                                            <span className="text-[8.5px] text-nv-faint font-mono">{on ? 'in use · not tested' : 'not tested'}</span>
                                          )}
                                          {checking !== m.id && r && !r.ok && (
                                            <span className="text-[8.5px] text-amber-500 font-mono">{r.reason === 'dead' ? 'no access' : 'retry'}</span>
                                          )}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                                );
                              });
                            })()}
                            {/* A "✓ it works, BUT it can't do JSON" is not good news — colour it
                                by the warning, not by the tick that happens to start the line. */}
                            {checkNote && <p className={`text-[9.5px] mt-1 ${checkNote.startsWith('✓') && !checkNote.includes('⚠') ? 'text-emerald-400' : 'text-amber-400'}`}>{checkNote}</p>}
                            <p className="text-[9.5px] text-nv-faint mt-1">
                              {scan
                                ? `Every model your key lists is shown above. ${scan.rows.filter((r) => r.ok).length} of ${scan.rows.length} tested answered; ${scan.rows.filter((r) => r.ok && r.jsonOk).length} can return JSON (needed for research, decks and reply checking). Measured, not a fixed favourite — press Rescan after your provider adds models.`
                                : 'Every model your key lists is shown above. Each is tested against your key when you pick it — a key doesn’t say which models your account may use, and a few accept requests without ever answering.'}
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
                    // EVERY provider. This was gated to nvidia/groq, so a Gemini or OpenAI user who
                    // typed a model name had it live in React state only — gone on the next reload,
                    // with the auto-picked model quietly answering again.
                    if (modelName.trim()) {
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
                  {/* THE ANSWER TO "ONE FREE KEY IS NOT ENOUGH". A single free key runs out, and on
                      NVIDIA most of the large models are not callable at all — measured, eight of
                      thirteen return 404. OmniRoute puts one address in front of many providers and
                      moves on when one runs dry. It belongs in this box because this is where
                      somebody looking for free capacity is already reading. */}
                  <p className="text-[10px] text-nv-faint leading-relaxed mt-2 pt-2" style={{ borderTop: '1px solid var(--nv-border)' }}>
                    One key running out, or the big models refusing to answer? Pick{' '}
                    <span className="text-nv-text">OmniRoute (your own gateway)</span> in Provider
                    above — the app installs and starts it for you, and it spreads your work across
                    many free providers instead of one.
                  </p>
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
