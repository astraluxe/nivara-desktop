// ─── The second layer of the one control ─────────────────────────────────────
//
// Picking a *source* is one decision; picking WHICH model on that source is another, and it used
// to live in a panel bolted to the top of the Krew chat. That panel is real work — it measures
// which models a key can actually call, and how fast — but it only existed on two screens, so from
// Brain, Guard or Settings the title-bar menu could offer "Local model" and "your NVIDIA key" with
// no way to see what was behind either.
//
// So the detail comes to the menu instead of the menu sending people to the detail. Same sheet,
// same styling, one step deeper: choose the source on the first screen, refine it on the second.
//
// WHAT IS DELIBERATELY NOT HERE: connecting a key, and downloading a model. Those are multi-step
// flows with their own screens (Connect Apps, Models) and cramming them into a 320px popup would
// make both worse. What is here is a route straight to them, which is the part that was missing.

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import {
  setAiSource, AI_SETUP_EVENT, type AiSourcePref, type ByokProvider, type AiAvailability,
} from '../lib/aiSource';
import { fetchRankedModels, PROVIDERS, type Provider, type RankedModel } from '../lib/ai';
import { credentialStore } from '../lib/krewDb';
import {
  CLI_LABEL, detectClis, installCli, uninstallCli, cliAuthStatus, cliLogin, cliLogout, daysUntilExpiry,
  readCliUsage, rollUpDaily, totalUsage, formatTokens, prettyModel, type CliUsage,
  usageWindow, untilReset, getReplyLimits, setReplyLimit, FIVE_HOURS, ONE_WEEK,
  type AgentCli, type CliAuth,
} from '../lib/agentCli';

/** Which second screen is open. `null` is the source list itself. */
export type Detail =
  | { kind: 'local' }
  | { kind: 'key'; provider: ByokProvider }
  | { kind: 'cli'; cli: AgentCli }
  | { kind: 'connect' };

export function detailTitle(d: Detail): string {
  switch (d.kind) {
    case 'local':   return 'Local models on this computer';
    case 'key':     return `Models your ${PROVIDER_LABEL[d.provider]} key can call`;
    case 'cli':     return CLI_LABEL[d.cli];
    case 'connect': return 'Connect a key';
  }
}

const PROVIDER_LABEL: Record<ByokProvider, string> = {
  gemini: 'Gemini', openai: 'OpenAI', claude: 'Claude',
  nvidia: 'NVIDIA', groq: 'Groq', omniroute: 'OmniRoute',
};

/** Every source that has something worth showing behind it. */
export function hasDetail(d: Detail | null): boolean { return d !== null; }

// ── Shared bits ──────────────────────────────────────────────────────────────

function Row({ active, onClick, title, right, sub, tone }: {
  active?: boolean; onClick?: () => void; title: string;
  right?: React.ReactNode; sub?: React.ReactNode; tone?: 'muted';
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`w-full text-left px-2.5 py-1.5 rounded-nv transition-colors duration-fast ease-nv
                  ${active ? 'bg-accent/[0.13] ring-1 ring-inset ring-accent/25'
                    : onClick ? 'hover:bg-nv-surface2/70' : 'opacity-60 cursor-default'}`}
    >
      <span className="flex items-center gap-2">
        <span className={`text-[11.5px] font-medium flex-1 truncate ${active ? 'text-accent' : tone === 'muted' ? 'text-nv-muted' : 'text-nv-text'}`}>
          {title}
        </span>
        {right}
      </span>
      {sub && <span className="block text-[10px] text-nv-faint leading-snug mt-0.5">{sub}</span>}
    </button>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="px-2.5 py-2 text-[10.5px] text-nv-muted leading-relaxed">{children}</p>;
}

function LinkBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="text-[10.5px] px-2 py-1 rounded-md border border-accent/45 text-accent
                 hover:bg-accent/10 transition-colors duration-fast ease-nv"
    >{children}</button>
  );
}

/** Send the user to a module of the app. The menu lives in the title bar, so this always works —
 *  unlike AI_SETUP_EVENT, which is only heard while Krew or Coder happens to be mounted. */
function goTo(module: string) {
  emit('nv-navigate', { module }).catch(() => {});
}

// ── Local models ─────────────────────────────────────────────────────────────

/**
 * What is downloaded, and which one is answering.
 *
 * "Free" and "works offline" are the reasons someone opens this, and neither is any use if they
 * cannot tell whether they have a model at all. Size is shown because it is the one number that
 * separates the quick small model from the capable big one without asking anybody to know what a
 * parameter count is.
 */
function LocalDetail({ avail, pref, onPick }: {
  avail: AiAvailability | null; pref: AiSourcePref; onPick: () => void;
}) {
  const models = avail?.localModels ?? [];
  const [engine, setEngine] = useState<'checking' | 'up' | 'down'>('checking');
  const [loading, setLoading] = useState<string | null>(null);
  const [failed, setFailed] = useState('');

  useEffect(() => {
    invoke<boolean>('models_check_engine')
      .then((ok) => setEngine(ok ? 'up' : 'down'))
      .catch(() => setEngine('down'));
  }, []);

  async function choose(filename: string) {
    setFailed('');
    setAiSource({ mode: 'local', localModel: filename });
    // Load it now rather than on the first message. A cold 14B takes half a minute to come up, and
    // paying that while reading the menu is far better than paying it while waiting for an answer.
    setLoading(filename);
    try { await invoke('models_run', { modelFilename: filename }); setEngine('up'); }
    catch (e) { setFailed(String(e)); }
    setLoading(null);
    onPick();
  }

  if (!models.length) {
    return (
      <>
        <Note>
          Nothing is downloaded yet. A local model runs on this computer, costs nothing and works
          with no internet — but it has to be fetched once, and they are large files.
        </Note>
        <div className="px-2.5 pb-1"><LinkBtn onClick={() => goTo('models')}>Open the Models page</LinkBtn></div>
      </>
    );
  }

  return (
    <>
      {models.map((m) => {
        const active = pref.mode === 'local' && (pref.localModel ?? models[0].filename) === m.filename;
        return (
          <Row
            key={m.filename}
            active={active}
            onClick={() => void choose(m.filename)}
            title={m.name}
            right={<span className="text-[9.5px] text-nv-faint shrink-0">
              {loading === m.filename ? 'loading…' : m.sizeGb ? `${m.sizeGb.toFixed(1)} GB` : ''}
            </span>}
          />
        );
      })}
      {failed && (
        <Note>
          <span className="text-nv-text">That model would not start.</span> {failed.slice(0, 160)}
        </Note>
      )}
      {engine === 'down' && !loading && (
        <Note>The local engine is not running. Choosing a model above starts it.</Note>
      )}
      <div className="px-2.5 pt-1 pb-1"><LinkBtn onClick={() => goTo('models')}>Download another</LinkBtn></div>
    </>
  );
}

// ── Models behind a key ──────────────────────────────────────────────────────

/** The measured record for this key, if the app has ever swept it. */
type Scan = import('../lib/modelHealth').ModelScan;

/**
 * Which models this key can actually call.
 *
 * ASKED, NOT ASSUMED. A provider's catalogue lists what the company hosts, not what a particular
 * account may call, and on a free tier those are very different lists — which is why this hits the
 * key's own /models endpoint rather than shipping a list that rots. Anything the app has already
 * measured (see modelHealth) is shown alongside, because "answers in 0.5s" is the thing that
 * decides whether a model is worth choosing and no name ever tells you.
 */
function KeyDetail({ provider, pref, onPick }: {
  provider: ByokProvider; pref: AiSourcePref; onPick: () => void;
}) {
  const [list, setList] = useState<RankedModel[] | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [current, setCurrent] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'nokey' | 'nolist'>('loading');

  useEffect(() => {
    let dead = false;
    (async () => {
      const cred = await credentialStore.get(provider).catch(() => null);
      const key = cred?.api_key as string | undefined;
      if (dead) return;
      setCurrent(pref.provider === provider ? (pref.model || cred?.model || '') : (cred?.model || ''));
      if (!key) { setState('nokey'); return; }
      // Only the OpenAI-compatible providers expose a catalogue. Claude, Gemini and a user-run
      // OmniRoute do not, and inventing a list for them would be worse than saying so.
      if (!PROVIDERS[provider as Provider]?.endpoint) { setState('nolist'); return; }
      const [models, saved] = await Promise.all([
        fetchRankedModels(provider as Provider, key),
        import('../lib/modelHealth').then((m) => m.loadScan(provider, key)).catch(() => null),
      ]);
      if (dead) return;
      setScan(saved);
      setList(models);
      setState(models.length ? 'ready' : 'nolist');
    })();
    return () => { dead = true; };
  }, [provider, pref.model, pref.provider]);

  // ── TESTING THEM, RATHER THAN GUESSING ──────────────────────────────────
  //
  // The list showed a name and a context window, and a measured time only for models a background
  // scan had happened to reach. Everything else looked equally fine. The user's words: "IT JUST
  // SHOWS WORKING OR GETS CONNECTED LIKE SHOWS THE NAME BUT DOESNT TELL IF CONNECTION IS FAILED AND
  // GIVE A BUTTON TO RE SCAN TO SEE WHICH MODELS ARE WORKING RATHER THAN MAKING A GUESS ALWAYS".
  //
  // They are right: picking a model from this screen was a guess, and the one they picked returned
  // nothing the night before an exam. Every row now says which of three states it is in — answered,
  // did not answer, or never tested — and the button measures the lot.
  const [scanning, setScanning] = useState<{ done: number; total: number } | null>(null);

  async function rescan() {
    const cred = await credentialStore.get(provider).catch(() => null);
    const key = cred?.api_key as string | undefined;
    if (!key) return;
    setScanning({ done: 0, total: 0 });
    try {
      const { scanModels } = await import('../lib/modelHealth');
      const fresh = await scanModels(provider as Provider, key, (done, total) => setScanning({ done, total }));
      setScan(fresh);
    } catch { /* the rows keep whatever they last knew */ }
    finally { setScanning(null); }
  }

  async function choose(id: string) {
    setAiSource({ mode: 'own_key', provider, model: id });
    setCurrent(id);
    // Write it to the credential too. The chat treats the credential as the single source of truth
    // for which model is answering (a mid-task repair can swap a dead one), so a choice that only
    // lived in the preference would be overwritten the next time that effect ran.
    try {
      const cred = await credentialStore.get(provider);
      if (cred) await credentialStore.save(provider, { ...cred, model: id });
      const { markUserChosen } = await import('../lib/modelHealth');
      markUserChosen(provider, id);
      window.dispatchEvent(new Event('nv-creds-changed'));
    } catch { /* the preference alone still routes the next call correctly */ }
    onPick();
  }

  if (state === 'loading') return <Note>Asking your key which models it can call…</Note>;

  if (state === 'nokey') {
    return (
      <>
        <Note>No {PROVIDER_LABEL[provider]} key is saved on this computer any more.</Note>
        <div className="px-2.5 pb-1"><LinkBtn onClick={() => goTo('connect')}>Open Connect Apps</LinkBtn></div>
      </>
    );
  }

  if (state === 'nolist') {
    return (
      <>
        <Note>
          {PROVIDER_LABEL[provider]} does not publish a list of what your key can call, so there is
          nothing to choose from here. {current
            ? <>Your messages run on <span className="text-nv-text">{current}</span>.</>
            : 'Your messages run on the model this key was connected with.'}
        </Note>
        <div className="px-2.5 pb-1"><LinkBtn onClick={() => goTo('connect')}>Change it in Connect Apps</LinkBtn></div>
      </>
    );
  }

  const row = (id: string) => scan?.rows.find((r) => r.id === id);
  const TIER_LABEL: Record<string, string> = { smart: 'Best for complex work', fast: 'Fast', other: 'Other' };
  const groups: RankedModel['tier'][] = ['smart', 'fast', 'other'];

  return (
    <>
      {/* MEASURE THEM, DO NOT GUESS. A provider's catalogue lists what the company hosts; only a
          real call tells you what this key can use today, and free tiers change under you. */}
      <div className="px-2.5 pt-2 pb-1 flex items-center justify-between gap-2">
        <span className="text-[9.5px] text-nv-faint">
          {scanning
            ? `Testing ${scanning.done} of ${scanning.total || '…'}`
            : scan
              ? `${scan.rows.filter((r) => r.ok).length} of ${scan.rows.length} answered`
              : 'None tested yet'}
        </span>
        <button
          onClick={() => void rescan()}
          disabled={!!scanning}
          className="text-[10px] px-2 py-1 rounded-lg border border-accent/40 text-accent hover:bg-accent/10 transition-fast disabled:opacity-40 shrink-0"
        >{scanning ? 'Testing…' : scan ? 'Test again' : 'Test all models'}</button>
      </div>
      {groups.map((tier) => {
        const inTier = (list ?? []).filter((m) => m.tier === tier);
        if (!inTier.length) return null;
        return (
          <div key={tier}>
            <p className="px-2.5 pt-2 pb-1 text-[9px] uppercase tracking-[0.12em] text-nv-faint">{TIER_LABEL[tier]}</p>
            {inTier.map((m) => {
              const r = row(m.id);
              return (
                <Row
                  key={m.id}
                  active={m.id === current}
                  onClick={() => void choose(m.id)}
                  title={m.id.split('/').pop() ?? m.id}
                  right={
                    <span className="text-[9.5px] shrink-0 tabular-nums">
                      {/* THREE STATES, NEVER TWO.
                          A model that answered, one that did not, and one nobody has tried are
                          three different things, and this used to show a context window for the
                          third — a real number that reads like a verdict and is not one. Picking
                          from that list was a guess, and the guess returned nothing the night
                          before an exam. "Not tested" says so, and the button above measures. */}
                      {r
                        ? (r.ok
                            ? <span className="text-nv-green">{(r.ms / 1000).toFixed(1)}s</span>
                            : <span style={{ color: '#f87171' }}>no answer</span>)
                        : <span className="text-nv-faint">not tested</span>}
                    </span>
                  }
                />
              );
            })}
          </div>
        );
      })}
      <Note>
        Nothing here is charged to your adris.tech balance — it runs on your own
        {' '}{PROVIDER_LABEL[provider]} key and is billed by them.
      </Note>
    </>
  );
}

// ── The subscription bridge ──────────────────────────────────────────────────

/**
 * What "your Claude Code" actually means, said once where it is chosen.
 *
 * This is the strategically important source — the user's own subscription is larger than anything
 * this product could resell them — and it is also the one where the honest position about their
 * data has to be stated, not buried in a settings page.
 */
/**
 * Setting the bridge up, for someone who has never opened a terminal.
 *
 * THIS IS THE MOST VALUABLE THING IN THE MENU AND IT WAS THE HARDEST TO REACH. Someone already
 * paying for Claude Code or Codex can run the whole of adris on it and be charged nothing here —
 * and the instruction for getting there used to be a line of shell to copy. For the people this
 * product is built for that is three impossible steps: know what a terminal is, have Node, and know
 * what to do when npm prints a permissions error.
 *
 * So it is three buttons instead, and each one only appears when it is the next thing to do:
 *
 *   1. INSTALL   — our own Node, our own folder, nothing on their PATH, no Administrator.
 *   2. SIGN IN   — the CLI's own sign-in, in a window we warn them about first.
 *   3. (nothing) — it says who is signed in and on what.
 *
 * The bold words are the ones someone skimming has to catch: what it costs, what is about to
 * happen, and what to press.
 */
function CliDetail({ cli, installed, onChanged }: {
  cli: AgentCli; installed: boolean; onChanged: () => void;
}) {
  const [busy, setBusy] = useState<'install' | 'login' | null>(null);
  const [step, setStep] = useState('');
  const [pct, setPct] = useState(0);
  const [failed, setFailed] = useState('');
  const [auth, setAuth] = useState<CliAuth | null>(null);
  const [exe, setExe] = useState('');

  // Where it is, and whether the user is signed in. Both re-read whenever this panel is opened,
  // because either can have changed in another window since the app started.
  const refresh = useCallback(async () => {
    try {
      const paths = await detectClis({ force: true });
      const path = cli === 'claude_code' ? paths.claude_code : paths.codex;
      setExe(path);
      setAuth(path ? await cliAuthStatus(cli, path) : null);
    } catch { setAuth(null); }
  }, [cli]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function doInstall() {
    setFailed(''); setBusy('install'); setPct(0); setStep('Starting…');
    try {
      await installCli(cli, (p) => { setStep(p.step); setPct(p.pct); });
      await refresh();
      onChanged();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  }

  async function doLogin() {
    setFailed(''); setBusy('login');
    try {
      await cliLogin(cli, exe);
      // The sign-in happens in its own window, on the user's own time, so there is nothing to await.
      // Poll for a while instead of asking them to come back and press something.
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const a = await cliAuthStatus(cli, exe);
        if (a.state === 'signed_in') { setAuth(a); onChanged(); break; }
        setAuth(a);
      }
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  }

  const expiryDays = auth ? daysUntilExpiry(auth) : null;
  const have = installed || !!exe;

  // ── Not installed ──────────────────────────────────────────────────────────
  if (!have) {
    return (
      <>
        <Note>
          If you already pay for {CLI_LABEL[cli]}, adris can run on it and you are charged{' '}
          <B>nothing here</B> — your subscription does the thinking, adris does the work.
        </Note>
        <Note>
          It is <B>not on this computer</B> yet. adris can install it for you: <B>no terminal</B>,
          nothing added to your system, and it can be removed again from this screen.
        </Note>
        {busy === 'install' ? (
          <Progress step={step} pct={pct} />
        ) : (
          <div className="px-2.5 pb-1">
            <LinkBtn onClick={() => void doInstall()}>Install {CLI_LABEL[cli]} for me</LinkBtn>
          </div>
        )}
        {failed && <Failed text={failed} />}
        <Note>
          It is about <B>200 MB</B> and takes a few minutes the first time. You will need a{' '}
          {cli === 'claude_code' ? 'Claude' : 'ChatGPT'} account to sign in with afterwards.
        </Note>
      </>
    );
  }

  // ── Installed, and the check has not come back yet ─────────────────────────
  //
  // "Ready" MUST NOT BE THE DEFAULT. Falling through to it while the answer is still in flight — or
  // when the CLI said something unreadable — is how the user is told everything is fine and then
  // meets a CLI error on their first message. Ready is claimed only on evidence.
  if (!auth) return <Note>Checking your sign-in…</Note>;

  // ── Installed, but not signed in ───────────────────────────────────────────
  if (auth.state !== 'signed_in') {
    return (
      <>
        <Note>
          {CLI_LABEL[cli]} is <B>installed</B>. One step left: <B>sign in</B> with the account your
          subscription is on. adris never sees that password — {CLI_LABEL[cli]} handles it.
        </Note>
        <Note>
          Pressing this opens <B>a small black window</B> and then your web browser. That is normal.
          Sign in there, and this screen will notice on its own.
        </Note>
        {busy === 'login' ? (
          <Note>Waiting for you to finish signing in…</Note>
        ) : (
          <div className="px-2.5 pb-1">
            <LinkBtn onClick={() => void doLogin()}>Sign in to {CLI_LABEL[cli]}</LinkBtn>
          </div>
        )}
        {failed && <Failed text={failed} />}
        <RemoveRow cli={cli} exe={exe} onChanged={() => { void refresh(); onChanged(); }} />
      </>
    );
  }

  // ── Ready ──────────────────────────────────────────────────────────────────
  return (
    <>
      <Note>
        <B>Ready.</B> adris does the work — your files, your mailbox, real Word and Excel, the
        browser — and {CLI_LABEL[cli]} does the thinking, on the subscription you already pay for.
        Nothing is charged to your adris.tech balance.
      </Note>
      {auth?.email && (
        <Row
          title={auth.email}
          right={<span className="text-[9.5px] text-nv-faint shrink-0">{auth.plan ?? 'signed in'}</span>}
        />
      )}

      {/* Shown only once the bridge is actually working. Usage above a "you are not signed in"
          message would be answering a question the user has not got to yet. */}
      <UsagePanel cli={cli} />
      {/* THE WARNING NOTHING USED TO GIVE. Claude Code prefers an API key over the user's login
          when both are present, and says so in its own output. That means the CLI can be installed,
          signed in and working — while billing per token instead of using the subscription the
          entire bridge exists to use. It is invisible unless something asks, so this asks. */}
      {/* SIGNED IN, BUT WE COULD NOT PROVE ON WHAT. Said out loud rather than shown as "Ready",
          because the whole reason to connect a subscription is not to be billed per message — and
          quietly assuming the good case is how that promise gets broken without anyone noticing.
          The bridge still runs; see subscriptionVerdict for why unknown is not treated as guilty. */}
      {auth?.subscription === undefined && (
        <Note>
          adris could not confirm whether this is using your <B>subscription</B> or an <B>API key</B>.
          It will still run. If you see charges appear on your API account rather than your
          subscription, sign in again from here.
        </Note>
      )}

      {/* Warned while it is still a sentence rather than a failed overnight task. Two weeks is
          enough notice to act without being nagged for months. */}
      {expiryDays !== null && expiryDays <= 14 && (
        <Note>
          {expiryDays < 0
            ? <>Your sign-in has <B>expired</B>. Sign in again to keep using it.</>
            : <>Your sign-in runs out in <B>{expiryDays} day{expiryDays === 1 ? '' : 's'}</B>. Signing in again now avoids a task failing later.</>}
        </Note>
      )}
      {(auth?.subscription === false || (expiryDays !== null && expiryDays <= 14)) && (
        <div className="px-2.5 pb-1">
          <LinkBtn onClick={() => void doLogin()}>Sign in again</LinkBtn>
        </div>
      )}

      {auth?.subscription === false && (
        <Note>
          <B>Careful:</B> this is signed in with an <B>API key</B>, not your subscription — so it is
          billed per message by {cli === 'claude_code' ? 'Anthropic' : 'OpenAI'} rather than being
          included in what you already pay. <B>adris will not run it</B> until that is fixed.
        </Note>
      )}
      <Note>
        Work adris does on this machine stays on it. Anything handed to {CLI_LABEL[cli]} goes to
        that provider under their terms, not ours — which is why it is said here, where you choose.
      </Note>
      <DisconnectRow cli={cli} exe={exe} onChanged={() => { void refresh(); onChanged(); }} />
    </>
  );
}

/**
 * Two different things a person can mean by "disconnect", kept apart on purpose.
 *
 *   1. STOP USING IT IN ADRIS — a preference. Reversible in a click, changes nothing outside adris,
 *      and it is what almost everybody means.
 *   2. SIGN OUT OF THE CLI — removes the credential it keeps for the whole computer, so their
 *      terminal Claude Code stops working too.
 *
 * Doing (2) when they meant (1) breaks a tool they use elsewhere, and connecting adris is no reason
 * to expect that. So (1) is the plain button, and (2) is a quieter one that says what it affects
 * before it can be pressed.
 */
function DisconnectRow({ cli, exe, onChanged }: { cli: AgentCli; exe: string; onChanged: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <div className="px-2.5 pt-2 pb-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          onClick={() => {
            // Only a preference: put the app back on "choose for me" and leave the CLI untouched.
            setAiSource({ mode: 'auto' });
            onChanged();
          }}
          className="text-[10.5px] text-nv-faint hover:text-accent transition-colors duration-fast ease-nv"
        >Stop using it in adris</button>
        <button
          onClick={() => setConfirming(true)}
          className="text-[10px] text-nv-faint/70 hover:text-red-400 transition-colors duration-fast ease-nv"
        >Sign out of {CLI_LABEL[cli]}</button>
      </div>

      {confirming && (
        <div className="mx-2.5 mb-1 px-2.5 py-2 rounded-nv border border-red-500/35 bg-red-500/[0.05]">
          <p className="text-[11px] text-nv-text font-medium">Sign out of {CLI_LABEL[cli]} everywhere?</p>
          <p className="text-[10.5px] text-nv-muted leading-relaxed mt-1">
            This signs you out on <B>this whole computer</B>, not just in adris — if you use{' '}
            {CLI_LABEL[cli]} in a terminal, that stops working too until you sign in again.
          </p>
          <p className="text-[10.5px] text-nv-muted leading-relaxed mt-1">
            To stop adris using it and leave everything else alone, use{' '}
            <span className="text-nv-text">Stop using it in adris</span> instead.
          </p>
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={async () => {
                setBusy(true);
                try { await cliLogout(cli, exe); } catch { /* the panel re-reads either way */ }
                setBusy(false); setConfirming(false); onChanged();
              }}
              disabled={busy}
              className="text-[10.5px] px-2 py-1 rounded-md border border-red-500/45 text-red-400
                         hover:bg-red-500/10 transition-fast disabled:opacity-50"
            >{busy ? 'Signing out…' : 'Sign out everywhere'}</button>
            <button onClick={() => setConfirming(false)}
                    className="text-[10.5px] text-nv-faint hover:text-nv-text transition-fast">Cancel</button>
          </div>
        </div>
      )}

      <RemoveRow cli={cli} exe={exe} onChanged={onChanged} />
    </>
  );
}

/**
 * What this subscription has actually been used for, on this machine.
 *
 * WHY IT EARNS ITS PLACE. Someone on a ₹400 Codex or ₹2,000 Claude plan is routing adris through a
 * budget they can feel, so "how much have I used?" is a real question — and answering it used to
 * mean leaving the app for a website.
 *
 * WHAT IT HONESTLY CANNOT SAY. Claude Code records what each turn COST in tokens; nothing on this
 * machine records what the plan's ceiling is. So this reports USE and never a percentage of a limit
 * it cannot see. "83% of your weekly quota" would be a number the user trusts and that is wrong,
 * which is the one outcome this feature must avoid.
 */
function UsagePanel({ cli }: { cli: AgentCli }) {
  const [usage, setUsage] = useState<CliUsage | null>(null);
  // Bumped when the user edits their own limits, so the windows recompute.
  const [, setNonce] = useState(0);

  useEffect(() => {
    let dead = false;
    readCliUsage(cli, 7).then((u) => { if (!dead) setUsage(u); }).catch(() => {});
    return () => { dead = true; };
  }, [cli]);

  if (!usage) return <Note>Reading what you have used…</Note>;
  if (!usage.ok) {
    return (
      <Note>
        {usage.reason === 'not_supported'
          ? <>adris cannot read {CLI_LABEL[cli]} usage yet — it keeps its history in a format that has not been read on a real install.</>
          : <>No history on this computer yet. Usage appears here once you have used it.</>}
      </Note>
    );
  }

  const buckets = usage.buckets ?? [];
  const week = totalUsage(buckets);
  const days = rollUpDaily(buckets, 7);
  // THE WINDOW THAT MATTERS. These plans reset on a rolling five hours, with a second limit over
  // seven days — a calendar day is not a unit any of them use, so "today" could not answer the only
  // question the user has: can I keep working now, or should I wait?
  const limits = getReplyLimits()[cli] ?? {};
  const session = usageWindow(buckets, FIVE_HOURS, Date.now(), limits.session);
  const weekWin = usageWindow(buckets, ONE_WEEK, Date.now(), limits.week);
  // The bar height is driven by OUTPUT tokens: cache reads dwarf everything else by two orders of
  // magnitude (944M against 2.1M in real data), so a chart scaled to them would be one spike and
  // six flat lines. Output is what the model actually produced for the user.
  const peak = Math.max(1, ...days.map((d) => d.out));
  const models = Object.entries(usage.models ?? {}).sort((a, b) => b[1].out - a[1].out);
  const dayLabel = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'narrow' });

  return (
    <>
      <p className="px-2.5 pt-2 pb-1 text-[9px] uppercase tracking-[0.12em] text-nv-faint">
        Used in the last 7 days
      </p>

      <div className="flex gap-2 px-2.5 pb-1">
        <Stat
          label="This 5 hours"
          value={session.percent !== undefined ? `${session.percent}%` : String(session.used.n)}
          sub={session.percent !== undefined
            ? `${session.used.n} of ${limits.session} replies`
            // An empty window has nothing to free up, and "frees up in now" reads like a fault
            // rather than like good news.
            : session.used.n === 0 ? 'nothing used in this window'
              : `${session.used.n === 1 ? 'reply' : 'replies'} · frees up in ${untilReset(session.resetsAt)}`}
          accent
        />
        <Stat
          label="This week"
          value={weekWin.percent !== undefined ? `${weekWin.percent}%` : String(week.n)}
          sub={weekWin.percent !== undefined
            ? `${week.n} of ${limits.week} replies`
            : `${formatTokens(week.out)} written`}
        />
      </div>

      {/* WHY THERE IS NO PERCENTAGE UNTIL THE USER GIVES ONE.
          Checked rather than assumed: the credential file holds a tier NAME, not a remaining count,
          and no transcript carries a rate-limit header. Claude Code's own /usage fetches the number
          live using the OAuth token — the one thing adris refuses to touch. So the denominator is
          genuinely not ours to know, and a percentage against a figure we guessed would be a number
          the user trusts and we invented. They can supply theirs, and then it is theirs. */}
      <LimitSetter cli={cli} limits={limits} onChange={() => setNonce((x) => x + 1)} />

      {/* Seven bars, one per day, including the quiet ones — a chart that omits empty days
          compresses time and turns a single busy afternoon into a picture of steady use. */}
      <div className="flex items-end gap-[3px] h-[38px] px-2.5 pt-1.5">
        {days.map((d) => (
          <div key={d.day} className="flex-1 flex flex-col items-center gap-1 group">
            <div
              className={`w-full rounded-sm transition-colors duration-fast ease-nv ${d.out > 0 ? 'bg-accent/55 group-hover:bg-accent' : 'bg-nv-surface2'}`}
              style={{ height: `${Math.max(d.out > 0 ? 3 : 2, (d.out / peak) * 30)}px` }}
              title={`${new Date(d.day).toLocaleDateString()} — ${formatTokens(d.out)} written, ${d.n} replies`}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-[3px] px-2.5 pb-1">
        {days.map((d) => (
          <span key={d.day} className="flex-1 text-center text-[8px] text-nv-faint">{dayLabel(d.day)}</span>
        ))}
      </div>

      {models.length > 0 && (
        <>
          <p className="px-2.5 pt-2 pb-0.5 text-[9px] uppercase tracking-[0.12em] text-nv-faint">
            Which model did the work
          </p>
          {models.slice(0, 4).map(([id, m]) => (
            <Row
              key={id}
              title={prettyModel(id)}
              right={<span className="text-[9.5px] text-nv-faint shrink-0">{formatTokens(m.out)} · {m.n}</span>}
            />
          ))}
        </>
      )}

      {/* SAID PLAINLY, because the obvious next question is "so how much is left?" and the honest
          answer is that this computer does not know. Inventing a percentage would be worse than
          saying so. */}
      <Note>
        This is what you have <B>used</B>, read from this computer — adris cannot see your plan's
        limit, so it does not guess one. Nothing here is charged to adris.tech.
      </Note>
    </>
  );
}

/** One headline number. Two of these sit side by side; the week is the one that matters. */
function Stat({ label, value, sub, accent }: {
  label: string; value: string; sub: string; accent?: boolean;
}) {
  return (
    <div className={`flex-1 rounded-nv px-2.5 py-2 border ${accent ? 'border-accent/30 bg-accent/[0.07]' : 'border-nv-border bg-nv-bg/60'}`}>
      <p className="text-[9px] uppercase tracking-[0.1em] text-nv-faint">{label}</p>
      <p className={`text-[16px] font-semibold leading-tight mt-0.5 ${accent ? 'text-accent' : 'text-nv-text'}`}>{value}</p>
      <p className="text-[9.5px] text-nv-faint leading-tight">{sub}</p>
    </div>
  );
}

/** Bold, for the words someone skimming has to catch. */
function B({ children }: { children: React.ReactNode }) {
  return <b className="text-nv-text font-semibold">{children}</b>;
}

function Progress({ step, pct }: { step: string; pct: number }) {
  return (
    <div className="px-2.5 py-2">
      <div className="h-1 rounded-full bg-nv-surface2 overflow-hidden">
        <div className="h-full bg-accent transition-[width] duration-slow ease-nv"
             style={{ width: `${Math.max(3, Math.min(100, pct))}%` }} />
      </div>
      <p className="text-[10px] text-nv-muted mt-1.5 leading-snug">{step}</p>
    </div>
  );
}

function Failed({ text }: { text: string }) {
  return (
    <div className="mx-2.5 mb-1 px-2 py-1.5 rounded-nv border border-red-500/35 bg-red-500/5">
      <p className="text-[10px] text-nv-text font-medium">That did not work</p>
      <p className="text-[10px] text-nv-muted leading-snug mt-0.5 break-words">{text.slice(0, 300)}</p>
    </div>
  );
}

/**
 * Removing it again — but ONLY a copy this app installed.
 *
 * Someone who installed Claude Code themselves, before adris existed, must not find an adris button
 * that deletes it. `agent_cli_uninstall` only ever touches our own folder, and the row is hidden
 * entirely when the executable in use is not in it.
 */
function RemoveRow({ cli, exe, onChanged }: { cli: AgentCli; exe: string; onChanged: () => void }) {
  const ours = /[\\/]agent-cli[\\/]/.test(exe);
  const [gone, setGone] = useState(false);
  if (!ours || gone) return null;
  return (
    <div className="px-2.5 pt-1 pb-1">
      <button
        onClick={async () => {
          try { await uninstallCli(cli); setGone(true); onChanged(); } catch { /* leave it be */ }
        }}
        className="text-[10px] text-nv-faint hover:text-nv-text transition-colors duration-fast ease-nv"
      >Remove the copy adris installed</button>
    </div>
  );
}

// ── No key yet ───────────────────────────────────────────────────────────────

/** The usual reaction to "use your own key" is that it means paying for an account. Two of them
 *  hand keys out free, and that is the fact worth leading with. */
function ConnectDetail() {
  async function open(id: 'nvidia' | 'groq') {
    try {
      const { requestServiceSetup } = await import('../lib/connectAppsRequest');
      requestServiceSetup(id);
    } catch { /* the Connect page still opens, just without the wizard preselected */ }
    goTo('connect');
  }

  /**
   * OmniRoute's one-button installer lives inside ConnectionBar, at the top of Krew.
   *
   * That panel is real work — it installs the gateway from npm through the app's own Node, starts
   * it, and fills the address in — and it is the answer when a free key runs dry. It is also the
   * ONE setup flow that has no home outside those two screens, so the route to it has to be kept
   * deliberately: go to Krew first, then ask, because AI_SETUP_EVENT is only heard while the
   * component that owns the panel is mounted. Deleting this would strand a working feature.
   */
  function openOmniRoute() {
    goTo('krew');
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent(AI_SETUP_EVENT, { detail: { which: 'omniroute' } }));
    }, 350);
  }

  return (
    <>
      <Note>
        NVIDIA and Groq give API keys away free. Neither costs you anything afterwards, and neither
        touches your adris.tech balance.
      </Note>
      <div className="flex gap-1.5 px-2.5 pb-1">
        <LinkBtn onClick={() => void open('nvidia')}>Connect NVIDIA</LinkBtn>
        <LinkBtn onClick={() => void open('groq')}>Connect Groq</LinkBtn>
      </div>
      <Note>Already have an OpenAI, Gemini or Anthropic key? Connect Apps takes those too.</Note>
      <Note>
        Or run your own gateway. OmniRoute puts one address in front of hundreds of providers and
        moves on when one runs dry — the app installs and starts it for you.
      </Note>
      <div className="px-2.5 pb-1"><LinkBtn onClick={openOmniRoute}>Set up OmniRoute</LinkBtn></div>
    </>
  );
}

// ── The dispatcher the menu renders ──────────────────────────────────────────

export default function AiSourceDetail({ detail, avail, pref, onPick }: {
  detail: Detail; avail: AiAvailability | null; pref: AiSourcePref; onPick: () => void;
}) {
  switch (detail.kind) {
    case 'local':   return <LocalDetail avail={avail} pref={pref} onPick={onPick} />;
    case 'key':     return <KeyDetail provider={detail.provider} pref={pref} onPick={onPick} />;
    case 'cli':     return <CliDetail cli={detail.cli} installed={(avail?.clis ?? []).includes(detail.cli)} onChanged={onPick} />;
    case 'connect': return <ConnectDetail />;
  }
}

/**
 * The user's own allowance, if they know it.
 *
 * Deliberately empty by default and never pre-filled with a published figure. Anthropic's and
 * OpenAI's limits change, differ by model and by message size, and a stale default presented as
 * fact is precisely the invented number this panel exists to avoid. Their plan page says what they
 * get; this turns that into a bar.
 */
function LimitSetter({ cli, limits, onChange }: {
  cli: AgentCli;
  limits: { session?: number; week?: number };
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const has = limits.session || limits.week;

  if (!open) {
    return (
      <div className="px-2.5 pb-1">
        <button
          onClick={() => setOpen(true)}
          className="text-[10px] text-nv-faint hover:text-accent transition-colors duration-fast ease-nv"
        >
          {has ? 'Change your plan limits' : 'Know your plan limits? Show them as a percentage'}
        </button>
      </div>
    );
  }
  return (
    <div className="mx-2.5 mb-1 px-2.5 py-2 rounded-nv border border-nv-border bg-nv-bg/60">
      <p className="text-[10.5px] text-nv-muted leading-relaxed">
        adris cannot see your plan's limit — only {CLI_LABEL[cli]} knows that. If your plan page
        tells you, put it here and this becomes a percentage.
      </p>
      <div className="flex items-center gap-2 mt-2">
        <LimitField label="per 5 hours" value={limits.session}
                    onSet={(v) => { setReplyLimit(cli, 'session', v); onChange(); }} />
        <LimitField label="per week" value={limits.week}
                    onSet={(v) => { setReplyLimit(cli, 'week', v); onChange(); }} />
      </div>
      <button onClick={() => setOpen(false)}
              className="text-[10px] text-nv-faint hover:text-nv-text transition-fast mt-2">Done</button>
    </div>
  );
}

function LimitField({ label, value, onSet }: {
  label: string; value?: number; onSet: (v: number | null) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[10px] text-nv-faint">
      <input
        type="number"
        min={1}
        defaultValue={value ?? ''}
        placeholder="—"
        onBlur={(e) => onSet(e.target.value ? Number(e.target.value) : null)}
        className="w-14 bg-nv-surface2 border border-nv-border rounded-md px-1.5 py-0.5
                   text-[10.5px] text-nv-text outline-none focus:border-accent"
      />
      {label}
    </label>
  );
}
