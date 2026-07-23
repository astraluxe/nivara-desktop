import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, emit } from '@tauri-apps/api/event';
import { getVersion } from '@tauri-apps/api/app';
import { useAuth } from '../contexts/AuthContext';
import AiSourcePicker from '../components/AiSourcePicker';
import { loadUserLocation, saveUserLocation, clearUserLocation, locationLabel, type UserLocation } from '../lib/userLocation';

interface NvSettings {
  automationAutoRun: boolean;
  automationNotify:  boolean;
  automationRunMode: 'always' | 'app_open';  // 'app_open' = only while app is open (current default)
  // Default behaviour when an agent produces a list/table that matches existing work:
  // 'continue' tops up the existing Brain note, 'new' always starts a fresh one. Either way an
  // explicit instruction in chat ("continue the existing list") wins over this default.
  listMode: 'continue' | 'new';
  // Advanced/experimental — Krew can explore an arbitrary website (snapshot → click → fill) and
  // learn a reusable "skill" from what it did, instead of only using pre-built site integrations.
  // Off by default: opt-in, since it lets the agent interact with sites it has no specific
  // instructions for. It still NEVER submits/sends/pays without an explicit approval click either
  // way — this setting only controls whether the exploratory tools exist at all.
  webAutopilot: boolean;
}

const DEFAULTS: NvSettings = {
  automationAutoRun: true,
  automationNotify:  true,
  automationRunMode: 'app_open',
  listMode:          'continue',
  webAutopilot:      false,
};

export function loadSettings(): NvSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('nv-settings') ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(s: NvSettings) {
  localStorage.setItem('nv-settings', JSON.stringify(s));
}

// Short, human-readable "what changed" notes for the current version — shown in About below.
// Add a new entry here on future releases; keep only the last few so this doesn't grow forever.
const WHATS_NEW: { version: string; items: string[] } = {
  version: '1.6.35',
  items: [
    'Fixed a bad error: with an NVIDIA key connected, a task could fail with “401 — Incorrect API key … platform.openai.com” because the NVIDIA key was being sent to OpenAI. Keys are now routed by their own type — an nvapi-/gsk_/sk-ant-/AIza key always goes to the right provider (NVIDIA/Groq/Claude/Gemini), no matter which one is selected — so that mix-up can’t happen.',
    'Connected more than one AI key (say Gemini AND NVIDIA)? The chat connection bar’s “Own Key” panel now shows your connected keys as a clear choice — tap the one you want the agents to run on. Pick NVIDIA and the recommended-model chooser appears right there.',

    'Fixed: the “Test” button in Connect Apps said “Unknown service” for NVIDIA and Groq. It now actually checks your key with a tiny request and tells you plainly whether it works.',
    'You can connect SEVERAL NVIDIA (or Groq) keys and switch between them — useful if one hits its free rate limit. In the chat connection bar under “Own Key” you now see your connected keys, which one is active (✓ Using your own key), and can toggle, add another, or remove one.',
    'Clicking NVIDIA/Groq no longer flings you out to the website straight away — it opens the short setup guide, and you open the site from there when you’re ready.',
    'Clearer key steps: NVIDIA only shows your real key AFTER you press “Generate API Key”, so the guide now says to click that first. If you copy the code too early it contains a placeholder (like $NVIDIA_API_KEY) — adris now spots that and tells you to generate the key first instead of saving the placeholder.',

    'You no longer have to know which NVIDIA/Groq model to pick. When you connect, adris reads the models your key can actually use, picks a capable one automatically, and the model chooser groups them into ★ Recommended (best for research, lead-finding, LinkedIn and the other multi-step commands) and Fast (quick replies & writing) — no cryptic names or “B” numbers to decode. Leave the Recommended one and it behaves closest to adris.tech’s own AI.',
    'The Info page now explains, in plain words, which kinds of models handle the complex commands well and why context size matters — so if you ever do choose by hand, you know what to look for.',

    'Connecting a free NVIDIA or Groq key is now foolproof. Their website hands you a whole block of code with the key buried inside — so instead of making you hunt for it, just paste the ENTIRE thing and adris finds the key for you (it even picks up the model you were looking at). It shows “✓ Found your key” so you know it worked. Pasting only the key still works too.',

    'Brain now connects related files for you. New files auto-link as they arrive, and a “Connect files” button links anything related that was left unjoined — a list to the product doc it came from, files from the same folder, notes that reference each other. Instant and free (no AI tokens).',
    'Brain can import from GitHub: paste a public repo URL (or one folder, …/tree/main/src) and it pulls up to 40 text files in, saved and linked under a repo hub — no clone, no token, no cost. Good for handing the agents a codebase or docs to read.',
    'Getting a free, fast AI key is now one click: in the chat connection bar press “Own Key” → “Get NVIDIA key” or “Get Groq key”, and it opens the sign-up and the guided setup. You can also ask Krew to “connect NVIDIA”. These free cloud models answer in seconds and use none of your adris.tech allowance — the fix when a local model is slow.',

    'New free, fast AI: connect an NVIDIA or Groq key in Connect Apps and adris runs on their cloud — fast answers, no adris.tech tokens used, no card needed. Both are the quick fix when a local model is too slow: NVIDIA (build.nvidia.com/models) hands out free API credits, and Groq (console.groq.com) is the fastest of all, usually answering in a second or two. You can also just ask Krew to “connect NVIDIA” and it opens the setup for you.',
    'Refining outreach on adris.tech (or your own cloud key) now does all 30 in one fast pass — only a local model splits into small batches, because it is slow and would otherwise get cut off.',

    '/refine now shows it’s actually working: a live counter ticks the seconds and the words written as the model writes — so a slow local model no longer looks frozen on “Refining 1–6”. Press Stop any time and whatever was refined is kept.',
    '/refine only rewrites contacts you HAVEN’T acted on yet. Anyone already sent, connected, replied or skipped is left exactly as they are — refining a message you already sent made no sense.',
    '/refine is much faster on a local model: it trims the background product text it re-reads each time, keeps messages shorter, works in smaller batches, and does ten per run (run it again for the next ten) so it finishes in a couple of minutes instead of ten. Each message is written on its own so people’s details don’t bleed together. If it’s still slow, it now tells you a hosted or smaller model would be quicker.',
    'Drafting outreach shows the same live progress, and also writes in smaller batches on a local model.',

    'The outreach copilot now has a search box — type a name to jump straight to that person instead of clicking Prev/Next through the whole list, so updating someone’s status is quick.',
    'Opening a contact’s chat from the copilot now types the message into the LinkedIn box for you — just like the inbox reply button — so you only review it and press Send. (It still never sends by itself, and the message is copied as a backup in case typing doesn’t catch.)',
    'Fixed the real reason so many outreach messages came out identical (“great to be connected, your work caught my eye”). That is the fallback the app uses when the model’s reply can’t be read — and asking a model to write all fifty messages in one go made it run out of room and get cut off, so only the first few were kept and everyone else got the fallback. Messages are now written in small batches that come back complete, so real, personalised messages reach far more people. /refine works the same way, and could no longer come back empty.',

    'Fixed: Local mode failing with “Engine started but is not responding” right after choosing a local model. A large model (a 14B is ~8.5 GB) takes 30–60 seconds to load into memory the first time, and the app was giving up after 30. It now waits properly for the model to finish loading, shows a “loading the model” note while it does, and only the FIRST message after launch waits — the rest are instant.',

    'New: /refine. After the copilot has drafted your outreach, /refine rewrites the messages to be genuinely personal to each person — from their profile and what you’re selling — instead of the generic “great to be connected, your work caught my eye” fallback. Add a note on how you want them (“warmer”, “lead with the time we save them”) and it follows it. It only rewrites people you haven’t messaged yet, and never sends anything.',
    'Fixed: “Local AI engine not found” even with a model downloaded. The engine binary is only extracted when you press Run in the Models tab — using Local mode from chat skipped that. Now the engine is set up automatically the first time Local mode needs it, so a downloaded model just works.',

    'Fixed: a location you set in Settings could vanish after an update. It was only kept in the browser layer’s storage, which an update can reset. It is now also saved to the app’s durable store and restored automatically on launch, so it survives updates and reinstalls.',
    'Google Maps searches for local leads now insist on a confirmed city — your saved location or one you name in the request. If it isn’t sure where you mean, it asks first instead of running a Maps search on a guessed area and quietly returning businesses from the wrong place.',

    'Fixed: Local mode said “Your local model isn’t responding” even with a model downloaded. The engine was only ever started if you visited the Models tab and loaded it by hand — sending a message never started it. Now picking Local and sending a message starts the engine automatically with the model you chose, waits for it to be ready, and answers. Verified end to end against a downloaded 14B model.',
    'The in-app guide (Info → Slash commands) now says which commands open a browser and what they open — Google Maps for finding local businesses and their phone/email, LinkedIn for connections and messages — and reminds you to set Settings → Location so “near me” works.',

    'When someone agrees a time on LinkedIn, the meeting is now MADE for you — no button to press. adris creates a real Google Meet room, opens Google Calendar with the event filled in and that link on it, and drops the link into the reply so the other person actually gets it. All you do is press Save on the calendar tab.',
    'It looks up their email first — from your outreach campaign or any lead list in your Brain — and adds them as a guest when it finds one, so saving genuinely sends them an invitation. When there is no email it says so plainly rather than letting you believe an invite went out: the link in the reply is what reaches them.',
    'Video links are real or absent, never invented. A drafted reply cannot mention a meeting link unless one was actually created.',

    'Fixed: pressing Continue on a drafted LinkedIn reply re-read your whole inbox and re-drafted every thread, instead of sending that one reply. The Continue instruction spanned two lines, the rule that recognises “send the reply to …” only ever matched single-line text, so it fell through to the inbox scan. A to-do now performs its action directly rather than being re-read as English — and it uses the profile link captured from the thread, so it works even for someone you have never scanned.',
    'Replies can no longer tell someone a meeting link is included. There is no way for adris to create a video link or attach a file, so that phrasing was always false and sent people looking for something that did not exist. A reply may only promise the invite when it also records the calendar action that actually creates it.',
    'Fixed: reading your LinkedIn inbox could mix up who said what. LinkedIn only prints a sender name on the first message of a run, so a reply you had already sent could be read as the other person’s — and Arjun would draft an answer to your own words. Every message is now tagged from LinkedIn’s own page markup as either yours or theirs, and a thread where you spoke last is recognised as waiting on them, not on you.',
    'Meetings actually reach your calendar. Arjun was writing “I’ll send over a calendar invite with a meeting link” — and nothing happened, because the app had no calendar capability at all, so an agreed meeting was silently lost. There is now a real one: it opens Google Calendar with the event filled in — title, date, time, timezone, guests — for you to press Save. No account to connect, nothing to set up. It also will not claim an invite was sent or a link attached, because neither is true until you save it.',
    'When a time gets agreed in a thread, it becomes a to-do of its own — “Calendar invite for <name>: Tuesday 2:00 PM IST” — so a confirmed meeting can no longer evaporate when you close the chat.',
    'Continue on a LinkedIn to-do now does the work instead of just opening the person’s profile. On a drafted reply it opens their chat with the message typed in; on a promised deck or document it hands the job to the right agent; on a time still to agree it drafts the message proposing slots; on a question only you can answer it drafts that from your own notes.',
    'adris.tech is no longer built around one country. Leads, customers, local businesses and events now come from YOUR market: set your city and country in Settings → Location, and every agent searches there. Before this, the research agent was under a standing order that every result must be an Indian company, blank city cells silently became "Bangalore", and the company databases queried India by construction — so someone in Chicago asking for Chicago leads got Indian companies, and it looked like a normal answer rather than an error.',
    'If Krew does not know where you are, it now ASKS instead of guessing — and asks properly: it wants the country as well as the city, because London UK and London Ontario are different markets, as are Birmingham UK and Alabama, or Cambridge UK and Massachusetts. Answer once and it is saved to Settings, so no agent asks again. You can see and change it there at any time.',
    'A background step that cannot ask you — one stage of a multi-agent job — will report that it needs your location rather than quietly picking a country and handing back a finished-looking list from the wrong place.',
    'Fixed: the suggestion to run a model on your own machine never appeared. It was set to show only if it had literally never been shown before, so on any existing install it could not appear again until a quarter of the monthly allowance was gone. It now appears when the task in front of you is genuinely one your own machine would handle well — writing, rewriting, summarising, sorting — and stays quiet for web lookups and multi-step jobs, where a local model would give you a worse answer. It is also no longer marked "seen" unless it actually reached the screen.',
    'Ask about a real person — "brief me before my meeting with <name>", "who is <name>" — and adris now goes and looks them up: it finds their actual LinkedIn profile, reads their headline, About, experience and recent posts, and searches the web for news about them, then writes the briefing from what it read. Before this it had no way to look anyone up, so it wrote the career history, the current job and the "recent posts" from imagination — fluent, confident, and made up. If it genuinely cannot find someone now, it says so and asks for their LinkedIn or company instead of inventing a person.',
    'Picking the right profile is deliberately strict: searching for "Kevin Christophe" will not settle for one of the five different people called "Kevin Christopher". If no profile is confidently that person, nothing from LinkedIn is used at all.',
    'Fixed: "Check for updates" said to check your connection when the connection was fine — and an update was in fact waiting. The updater failing on its own is not proof the network is down, so it now falls back to reading the release directly before blaming anything.',
    'What’s new is no longer a wall of text in Settings. You get a one-line summary and a "Read the details" button that opens the full list on its own screen.',
    'Chats can be renamed — double-click a chat in the sidebar, or use the pencil — and pinned to the top with the small square, so the ones that matter stay findable.',
    'The local-model suggestion now appears the first time it is relevant instead of waiting until you had spent a quarter of your monthly allowance — on Solo that meant a million tokens, so almost nobody ever saw it.',
    'Fixed: a long request that merely MENTIONED LinkedIn was treated as a command to go and read your LinkedIn. Asking for a slide deck whose slides happened to mention LinkedIn and "stages a reply" opened a browser instead of writing the deck. Shortcuts like this now only fire on short, direct instructions — anything that looks like a brief or a document goes to Arjun, who reads the whole thing first. Requests to write a deck, blog, article or report are never mistaken for inbox commands.',
    'The suggestion to download a local model no longer appears in the middle of your chat. It shows as a dismissible notification at the top of the window with an "Open Models" button, so it cannot bury the answer you were reading.',
    'Arjun now works out what a LinkedIn conversation actually requires, not just what to say back. When someone accepts something you offered — a “sure” after you promised a breakdown — he treats delivering that as the real outstanding task, names the one thing to do next, and puts it on your To-do list alongside the reply.',
    'Replies are now written from your own product notes in the Brain. Arjun pulls the notes that relate to what the person actually asked — plus your product and pricing notes — and answers from those. Asked how adris.tech sources its data, he previously made up a confident answer you could have sent to a prospect; he now uses what you have written, and anything he genuinely does not know is flagged “check before sending” with exactly what needs confirming rather than being guessed.',
    'Each conversation gets ONE recommended next step and one agent to do it — a deck goes to Slade, a time goes to your calendar — instead of several agents being pulled in for a single message.',
    'Every drafted message now has a “Reply on LinkedIn” button that opens that person’s chat with the reply already typed in — you just press send. No need to type “send the reply to …” any more.',
    'Fixed: that button typed the reply and then closed the browser window before you could send it, while telling you to go and press Enter in it. The window now stays open until you close it.',
    'A draft that still contains a blank like [source] can no longer be sent by mistake — the reply button is replaced by “Fill in [source] first” until you complete it.',
    'Work you were left owing someone — a deck, a document — now has a Continue button in your To-do list that hands the job straight back to Arjun, who passes it to the right agent. Previously it only reminded you it existed.',
    'Fixed: replies longer than one paragraph were cut short in the draft.',
    'Fixed: the recipient’s name appeared as the first line inside the drafted message itself.',
    'Fixed: model downloads that failed partway with “error decoding response body”. A model is several gigabytes, and a single dropped connection threw the whole download away. Downloads now resume from where they stopped instead of starting over, retry a broken connection by themselves, and only claim a model is installed once the file is genuinely complete.',
    'The recommended model now shows its own progress bar and a Cancel button while downloading. Pressing Download used to look like it had done nothing, because the only progress was further down the page.',
    'Fixed: messages disappeared from a chat when you reopened it. Anything that ended in an error — including outreach that stopped because no local model was downloaded — was only ever drawn on screen and never saved, so the conversation came back with a gap in it. Nothing is dropped from a chat now.',
    'Guard runs on a local model or your own API key without using up your monthly Guard checks, and keeps working after the pool is empty — it runs on your hardware, so there is nothing to meter. You can now also see and change where Guard’s AI runs from any of its tabs, not just Threat Monitor.',
    'The To-do button is purple whether the panel is open or closed, so unfinished work is easier to spot.',
    'Fixed: local models could not start at all. A file the AI engine needs (mtmd.dll) was missing from the app, so Windows stopped it before it began — the “code execution cannot proceed” box. The engine is now complete and has been tested end to end: it loads a model and replies. Engine files are also refreshed automatically by future updates, which previously never happened, so a broken engine could not repair itself.',
    'The recommended local model is now shown permanently at the top of the Models tab, based on your machine’s actual memory and free disk. It used to appear only as an occasional chat message after you had used a quarter of your monthly allowance, so most people never saw it at all.',
    '“Show me around” now explains how the app works instead of pointing at the sidebar and the theme toggle. It walks the real sequence — how Krew works, how to use slash commands, and the /scan → /verify → /enrich → /outreach order for lead generation — and opens the full written guide in Info.',
    'Fixed: /scan on a large network returned almost nobody new. Every run reloaded your connections page and scrolled from the very top, so once a few hundred people were saved it spent all its time re-reading names it already had. It now carries on from where it stopped and keeps going over several passes.',
    'Fixed: using a local model no longer shows “internet disconnected, reconnecting”. A local model runs on your own machine and sends nothing online — that message came from mistaking “the local engine isn’t running” for a dropped connection, and it then retried ten times. It now tells you plainly to check the Models tab.',
    'Local models can do everything adris.tech does — including web lookups, Google Maps and LinkedIn scanning. Those tools belong to the app, not to the cloud AI, so a local model drives the same ones. What changes is size: writing and summaries run on a small model, while lookups, multi-step runs and research need a larger one. Krew now checks your memory and free disk and names the right model for the task, and only suggests adris.tech when your machine genuinely cannot hold a model big enough.',
    'Your plan now refreshes the moment you return to the window after paying, and the upgrade screen checks with the server first — so nobody who has already paid is asked to pay again.',
    'The corner badge can be dragged anywhere and stays where you put it. If a screen it was on is unplugged it returns to a visible position instead of vanishing.',
    'Importing your own model file is now a paid feature; downloading the built-in models stays free for everyone.',
    'Fixed: outreach no longer rewrites messages that already exist. People who were drafted in an earlier run keep their message and no longer use up the batch, so each run goes to the people who still have none — which is why newly scanned contacts kept waiting.',
    'Outreach messages are signed with your real name instead of “Best, [Your Name]”.',
    'Upgrading opens the checkout in your browser from a clear button, and the plan applies as soon as payment clears.',
    'Fixed: people added by a later /scan now get messages. Attaching a campaign file made it the whole list of people, so anyone scanned afterwards could never be drafted for, however many times you ran outreach. A campaign file records how far you got, not who you know — so the roster is now topped up from your saved connections, and everyone you have already messaged keeps their status and is not drafted again.',
    'Upgrading now opens the checkout on adris.tech in your browser instead of doing nothing. Payment is deliberately handled only on the website: the app never processes money and never grants a plan by itself, so a tampered copy cannot fake one. Pay signed in with the same email, then press “I’ve paid — check my plan” and it updates.',
    'Fixed: asking for DMs or cold emails “for the people in <file>” now opens the outreach copilot with the drafted messages. Without the literal word “outreach” it used to be routed to a strategy agent, which replied with a market-analysis report instead of the messages.',
    '/outreach now asks two questions before it starts: which list of people to message, then which campaign note to save into (or a new one you name). It no longer guesses either — guessing is what put a 52-person list under one contact’s name. It remembers the note you last chose and marks it “last used”.',
    'The same searchable file picker now opens for /summarize as well as /verify, /enrich, /findleads, /expand, /draft, /email and /repair-table — pick a saved file instead of typing its name.',
    'Fixed: long AI replies no longer come back with words missing from the middle of sentences. The streaming reader parsed each network packet on its own, so any message split across a packet boundary failed to decode and was silently thrown away — taking a chunk of the answer with it. Text now survives the boundary intact, including accented and non-English characters.',
    'Web Autopilot is much better at unfamiliar forms: Krew now reads every field — its label, whether it is required, and a dropdown’s real options — before filling anything, and can set dropdowns, tick checkboxes and choose radio buttons, which it simply could not do before. Fields labelled the normal way, or with no label at all, are no longer invisible to it.',
    'Skills are now saved as a step-by-step recipe — the site, which fields to fill, what to ask you for, and which step needs your approval — so repeating a task follows what worked last time instead of working the page out again. Krew will not build or run a skill for anything unlawful or abusive.',
    'Fixed: "block Tuesday" and similar now go through the calendar tool, which shows you the event and waits for your approval. Krew was instead driving the Google Calendar website by hand, which left a half-filled form it could never safely save — so nothing was created and you were never asked.',
    'When a task stops before producing anything there is now a Continue button, so you do not have to retype the request. The message it leaves also no longer talks about lead lists when the task had nothing to do with leads.',
    'Fixed: to-dos created by Krew no longer show a literal "!high" in the task name.',
    'Ticking a to-do off keeps it in Done rather than removing it, and each completed item now has a visible ✕ so you decide when it goes.',
    'Asking Krew to update your to-do no longer tells you to connect Google Calendar — the to-do list is local and needs no connected account.',
    'Fixed: text typed into "Your reference note" in the Brain is no longer lost when you close the panel with Escape or the ✕ — it used to save only if you clicked out of the box first.',
    'Renaming a Brain note now renames it everywhere: the to-do that points at it, and — for an outreach note — the campaign itself. Previously the campaign kept its old name internally, so it recreated a second note under the old title and the to-do never updated.',
    'Fixed: replying to one person no longer renames your whole outreach campaign after them. A one-person errand saves a campaign too, and the next full run was inheriting its name — which is how a 52-person list ended up filed under a single contact.',
  ],
};

function Toggle({ on, onChange, label, desc }: { on: boolean; onChange: (v: boolean) => void; label: string; desc?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-nv-border/60 last:border-0">
      <div className="flex-1">
        <p className="text-[12px] text-nv-text font-medium">{label}</p>
        {desc && <p className="text-[10px] text-nv-muted mt-0.5 leading-relaxed">{desc}</p>}
      </div>
      <button
        onClick={() => onChange(!on)}
        className={`relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200 focus:outline-none ${on ? 'bg-accent' : 'bg-nv-surface2'}`}
        aria-checked={on}
        role="switch"
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${on ? 'translate-x-4' : 'translate-x-0'}`}
        />
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-nv-surface border border-nv-border rounded-xl p-5 mb-4">
      <p className="nv-eyebrow text-nv-muted mb-3">{title}</p>
      {children}
    </div>
  );
}

type UpdateStatus = 'idle' | 'checking' | 'available' | 'latest' | 'installing' | 'error';
type VoiceStatus = 'checking' | 'ready' | 'downloading' | 'idle' | 'error';

export default function SettingsModule() {
  const { session } = useAuth();
  const uid = session?.user?.id;
  const [settings, setSettings] = useState<NvSettings>(loadSettings);
  const [appVersion, setAppVersion]   = useState<string>('');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{ version?: string; body?: string; current?: string; propagating?: boolean }>({});
  const [updateErr, setUpdateErr] = useState('');
  const [updatePct, setUpdatePct] = useState(0);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('checking');
  const [voicePct, setVoicePct]       = useState(0);
  const [voiceStep, setVoiceStep]     = useState('');

  // Where the user is. Agents read this for every location-dependent task; an agent that had to
  // ask writes it here too, so it is asked once and then visible/editable in one place.
  const [loc, setLoc]                 = useState<UserLocation | null>(loadUserLocation);
  const [locCity, setLocCity]         = useState(() => loadUserLocation()?.city ?? '');
  const [locRegion, setLocRegion]     = useState(() => loadUserLocation()?.region ?? '');
  const [locCountry, setLocCountry]   = useState(() => loadUserLocation()?.country ?? '');
  const [locErr, setLocErr]           = useState('');
  const [locSaved, setLocSaved]       = useState(false);
  const inputStyle = { background: 'var(--nv-bg)', border: '1px solid var(--nv-border)', color: 'var(--nv-text)' };

  // An agent can save the location mid-conversation (set_user_location). Reflect that here without
  // a reload, so Settings never shows a stale "not set" next to a location Krew is already using.
  useEffect(() => {
    const onLoc = () => {
      const l = loadUserLocation();
      setLoc(l);
      setLocCity(l?.city ?? ''); setLocRegion(l?.region ?? ''); setLocCountry(l?.country ?? '');
    };
    window.addEventListener('nv-location-changed', onLoc);
    return () => window.removeEventListener('nv-location-changed', onLoc);
  }, []);

  useEffect(() => { getVersion().then(setAppVersion).catch(() => {}); }, []);

  useEffect(() => {
    invoke<{ ready: boolean }>('voice_check_setup')
      .then(r => setVoiceStatus(r.ready ? 'ready' : 'idle'))
      .catch(() => setVoiceStatus('idle'));
  }, []);

  async function downloadVoice() {
    setVoiceStatus('downloading');
    setVoiceStep('Preparing…');
    setVoicePct(0);
    const unsub = await listen<{ step: string; pct: number }>('voice_setup_progress', e => {
      setVoiceStep(e.payload.step);
      setVoicePct(e.payload.pct);
    });
    try {
      await invoke('voice_download_setup');
      setVoiceStatus('ready');
    } catch (e) {
      setVoiceStatus('error');
      setVoiceStep(`Failed: ${e}`);
    } finally {
      unsub();
    }
  }

  async function checkUpdate() {
    setUpdateStatus('checking');
    setUpdateInfo({});
    setUpdateErr('');
    try {
      const res = await invoke<{ available: boolean; version?: string; body?: string; current?: string; propagating?: boolean }>('check_for_update');
      if (res.available) {
        setUpdateStatus('available');
        setUpdateInfo({ version: res.version, body: res.body, current: res.current, propagating: res.propagating });
      } else {
        setUpdateInfo({ current: res.current });
        setUpdateStatus('latest');
      }
    } catch (e) {
      // The Tauri updater failing is NOT proof the network is down — it fails on its own for
      // signature/endpoint reasons too, and telling someone to check a working connection is both
      // wrong and unfixable from their side. The startup check already falls back to reading
      // latest.json straight from the GitHub release; do the same here before blaming the network.
      console.error('check_for_update failed, trying latest.json:', e);
      try {
        const [json, current] = await Promise.all([
          fetch('https://github.com/astraluxe/nivara-desktop/releases/latest/download/latest.json')
            .then((r) => r.json()) as Promise<{ version?: string; notes?: string }>,
          getVersion(),
        ]);
        const remote = json.version ?? '';
        const newer = (() => {
          const r = remote.split('.').map(Number), l = current.split('.').map(Number);
          for (let i = 0; i < Math.max(r.length, l.length); i++) {
            if ((r[i] ?? 0) > (l[i] ?? 0)) return true;
            if ((r[i] ?? 0) < (l[i] ?? 0)) return false;
          }
          return false;
        })();
        if (remote && newer) {
          setUpdateInfo({ version: remote, body: json.notes, current });
          setUpdateStatus('available');
        } else if (remote) {
          setUpdateInfo({ current });
          setUpdateStatus('latest');
        } else {
          setUpdateStatus('error');
        }
      } catch {
        setUpdateStatus('error');
      }
    }
  }

  // Live download progress so "installing…" never just looks frozen (the cursor-spinner the user
  // saw). The Rust install_update emits `update-progress` {downloaded,total} as it streams.
  useEffect(() => {
    const un = listen<{ downloaded: number; total: number }>('update-progress', (e) => {
      const { downloaded, total } = e.payload || { downloaded: 0, total: 0 };
      if (total > 0) setUpdatePct(Math.min(100, Math.round((downloaded / total) * 100)));
    });
    return () => { un.then((f) => f()).catch(() => {}); };
  }, []);

  async function installUpdate() {
    setUpdateStatus('installing');
    setUpdateErr('');
    setUpdatePct(0);
    try {
      await invoke('install_update');
      // install_update restarts the app on success, so reaching here means it returned without
      // installing (e.g. the release is still propagating) — surface that instead of hanging.
      setUpdateStatus('available');
    } catch (e) {
      setUpdateErr(e instanceof Error ? e.message : String(e));
      setUpdateStatus('available');
    }
  }

  function update<K extends keyof NvSettings>(key: K, val: NvSettings[K]) {
    const next = { ...settings, [key]: val };
    setSettings(next);
    saveSettings(next);
  }

  // Quick Bar — the always-on-top mini chat at the top of the screen.
  const [quickbarOn, setQuickbarOn] = useState(() => localStorage.getItem('nv-quickbar') !== 'off');
  async function toggleQuickbar(v: boolean) {
    setQuickbarOn(v);
    localStorage.setItem('nv-quickbar', v ? 'on' : 'off');
    emit('nv-quickbar-toggle', { on: v }).catch(() => {});
    // The bar's whole point is being there at login without opening the app —
    // so the autostart registration follows the same switch.
    try {
      const { enable, disable } = await import('@tauri-apps/plugin-autostart');
      if (v) await enable(); else await disable();
    } catch { /* autostart unavailable — bar still toggles for this session */ }
  }

  // Full changelog on its own screen, reached from the About panel's "Read the details" button.
  if (showWhatsNew) {
    return (
      <div className="h-full overflow-y-auto bg-nv-bg">
        <div className="px-6 py-4 border-b border-nv-border flex items-center gap-3 sticky top-0 bg-nv-bg z-10">
          <button
            onClick={() => setShowWhatsNew(false)}
            className="text-[11px] text-nv-faint hover:text-nv-text transition-fast shrink-0"
          >&larr; Back</button>
          <div className="min-w-0">
            <h1 className="text-[16px] font-semibold text-nv-text tracking-tight">What's new in v{WHATS_NEW.version}</h1>
            <p className="text-[11px] text-nv-muted mt-0.5">{WHATS_NEW.items.length} changes in this release.</p>
          </div>
        </div>
        <div className="px-6 py-5 max-w-3xl">
          <ul className="space-y-3">
            {WHATS_NEW.items.map((it, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="text-accent shrink-0 text-[11px] leading-relaxed">&bull;</span>
                <span className="text-[12px] text-nv-muted leading-relaxed">{it}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-nv-bg">
      {/* Header */}
      <div className="px-6 py-4 border-b border-nv-border shrink-0">
        <h1 className="text-[16px] font-semibold text-nv-text tracking-tight">Settings</h1>
        <p className="text-[11px] text-nv-muted mt-0.5">Preferences stored locally on this device.</p>
      </div>

      <div className="p-6 max-w-xl">

        {/* Automation */}
        <Section title="Automation">
          <Toggle
            on={settings.automationAutoRun}
            onChange={(v) => update('automationAutoRun', v)}
            label="Auto-run scheduled automations"
            desc="When enabled, automations fire automatically based on their trigger. Disable to pause all automations without deleting them."
          />
          <Toggle
            on={settings.automationNotify}
            onChange={(v) => update('automationNotify', v)}
            label="Show run notifications"
            desc="Display a desktop notification each time an automation runs successfully."
          />
          <div className="pt-3">
            <p className="text-[12px] text-nv-text font-medium mb-2">Run mode</p>
            <div className="flex flex-col gap-2">
              {[
                { val: 'app_open' as const, label: 'Only while adris.tech is open', desc: 'Automations run when the app is active. Nothing runs in the background.' },
                { val: 'always'   as const, label: '24/7 background mode', desc: 'Automations run even when the window is hidden. App stays in the system tray.' },
              ].map((opt) => (
                <button
                  key={opt.val}
                  onClick={() => update('automationRunMode', opt.val)}
                  className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-fast ${
                    settings.automationRunMode === opt.val
                      ? 'border-accent/50 bg-accent/5'
                      : 'border-nv-border hover:border-nv-border/80'
                  }`}
                >
                  <span className={`mt-0.5 w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center ${
                    settings.automationRunMode === opt.val ? 'border-accent' : 'border-nv-faint'
                  }`}>
                    {settings.automationRunMode === opt.val && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
                  </span>
                  <div>
                    <p className={`text-[11px] font-medium ${settings.automationRunMode === opt.val ? 'text-accent' : 'text-nv-text'}`}>{opt.label}</p>
                    <p className="text-[10px] text-nv-muted mt-0.5">{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div className="pt-3">
            <p className="text-[12px] text-nv-text font-medium mb-2">Lists &amp; notes</p>
            <div className="flex flex-col gap-2">
              {[
                { val: 'continue' as const, label: 'Continue the existing list', desc: 'When Krew produces a list that matches earlier work, it tops up that note instead of creating another one — so your outreach status and saved rows carry over.' },
                { val: 'new'      as const, label: 'Always start a new list', desc: 'Every run saves to its own new note. Useful if you want a clean record of each session.' },
              ].map((opt) => (
                <button
                  key={opt.val}
                  onClick={() => update('listMode', opt.val)}
                  className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-fast ${
                    settings.listMode === opt.val ? 'border-accent/50 bg-accent/5' : 'border-nv-border hover:border-nv-border/80'
                  }`}
                >
                  <span className={`mt-0.5 w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center ${
                    settings.listMode === opt.val ? 'border-accent' : 'border-nv-faint'
                  }`}>
                    {settings.listMode === opt.val && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
                  </span>
                  <div>
                    <p className={`text-[11px] font-medium ${settings.listMode === opt.val ? 'text-accent' : 'text-nv-text'}`}>{opt.label}</p>
                    <p className="text-[10px] text-nv-muted mt-0.5">{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-nv-faint mt-2 leading-relaxed">
              Whatever you pick here, saying <span className="text-nv-muted">“continue the existing list”</span> in chat always wins for that request.
            </p>
          </div>
        </Section>

        {/* Where the user is — drives every location-dependent search */}
        <Section title="Location">
          <p className="text-[11px] text-nv-muted leading-relaxed mb-3">
            Where you are, and the market Krew searches. Leads, customers, local businesses and
            events all come from here. If it isn&rsquo;t set, Krew asks you the first time a task
            needs it and saves your answer here.
          </p>
          {loc && (
            <p className="text-[11px] mb-3">
              <span className="text-nv-faint">Currently searching: </span>
              <span className="text-accent font-medium">{locationLabel(loc)}</span>
            </p>
          )}
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                value={locCity}
                onChange={(e) => { setLocCity(e.target.value); setLocErr(''); setLocSaved(false); }}
                placeholder="City — e.g. Chicago"
                className="flex-1 rounded-lg px-3 py-2 text-[11px] outline-none"
                style={inputStyle}
              />
              <input
                value={locRegion}
                onChange={(e) => { setLocRegion(e.target.value); setLocSaved(false); }}
                placeholder="State / region (optional)"
                className="flex-1 rounded-lg px-3 py-2 text-[11px] outline-none"
                style={inputStyle}
              />
            </div>
            <input
              value={locCountry}
              onChange={(e) => { setLocCountry(e.target.value); setLocErr(''); setLocSaved(false); }}
              placeholder="Country — e.g. United States"
              className="w-full rounded-lg px-3 py-2 text-[11px] outline-none"
              style={inputStyle}
            />
            {/* Country is required on purpose: a city alone is ambiguous, and guessing it wrong
                sends every future search to the wrong continent without anyone noticing. */}
            <p className="text-[10px] text-nv-faint leading-relaxed">
              Country is required — a city on its own is ambiguous (London UK vs London Ontario,
              Cambridge UK vs Massachusetts), and getting it wrong quietly sends every search to
              the wrong place.
            </p>
            {locErr && <p className="text-[10px] text-red-400">{locErr}</p>}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => {
                  const city = locCity.trim(); const country = locCountry.trim();
                  if (!city)    { setLocErr('Enter a city.'); return; }
                  if (!country) { setLocErr('Enter a country too — a city on its own is ambiguous.'); return; }
                  saveUserLocation({ city, country, region: locRegion.trim() || undefined });
                  setLoc(loadUserLocation()); setLocErr(''); setLocSaved(true);
                }}
                className="px-3 py-2 rounded-lg text-[11px] text-white font-medium transition-fast hover:opacity-90"
                style={{ background: '#7C5CFF' }}
              >
                Save location
              </button>
              {loc && (
                <button
                  onClick={() => {
                    clearUserLocation();
                    setLoc(null); setLocCity(''); setLocRegion(''); setLocCountry('');
                    setLocErr(''); setLocSaved(false);
                  }}
                  className="px-3 py-2 rounded-lg text-[11px] font-medium border border-nv-border text-nv-muted transition-fast hover:border-nv-border/80"
                >
                  Clear
                </button>
              )}
              {locSaved && <span className="text-[10px] text-accent">Saved — Krew will search here from now on.</span>}
            </div>
          </div>
        </Section>

        {/* Advanced / experimental */}
        <Section title="Advanced">
          <Toggle
            on={settings.webAutopilot}
            onChange={(v) => update('webAutopilot', v)}
            label="Web Autopilot"
            desc="Let Krew figure out sites it wasn't specifically built for: it reads the page, works out which fields/buttons matter, fills things in, and can attach a file it finds on your computer. It always shows you the finished action and waits for your approval before anything is actually sent, submitted, or paid — never automatically. Once you approve a task, Krew remembers how it did it as a reusable skill for next time (visible in Brain, say /skills)."
          />
        </Section>

        {/* AI source — governs every module that runs AI in the background */}
        <Section title="Where AI runs">
          <p className="text-[11.5px] leading-[1.6] text-nv-muted mb-3">
            Guard scans, automations and other background work use this. Pick the hosted AI, your own
            API key, or a model running on this machine — your own key and local models never touch
            your monthly allowance. The Krew chat keeps its own switch in the connection bar.
          </p>
          <AiSourcePicker compact />
        </Section>

        {/* Interface */}
        <Section title="Interface">
          <Toggle
            on={quickbarOn}
            onChange={toggleQuickbar}
            label="Quick Bar & corner badge"
            desc="The adris chat bar sits at the top-center of your desktop; inside other apps it becomes a small logo at the right edge (click it to chat, right-click to hide it for 1 or 24 hours). Starts with Windows. Turn off to remove both entirely."
          />
          <div className="py-2">
            <p className="text-[12px] text-nv-text font-medium">Theme</p>
            <p className="text-[10px] text-nv-muted mt-1">Use the theme toggle at the bottom of the sidebar (sun/moon icon) to switch between Ink (dark) and Paper (light).</p>
          </div>
          <div className="pt-2 border-t border-nv-border/60 py-2">
            <p className="text-[12px] text-nv-text font-medium">Sidebar expand</p>
            <p className="text-[10px] text-nv-muted mt-1">The sidebar expands after hovering for 2 seconds, showing module names and status labels. Move the mouse away to collapse.</p>
          </div>
        </Section>

        {/* Data */}
        <Section title="Local data">
          <div className="py-2">
            <p className="text-[12px] text-nv-text font-medium">Storage location</p>
            <p className="text-[10px] text-nv-muted mt-1">All data (chat history, credentials, automation logs) is stored on your device only. Nothing is sent to adris.tech servers unless you explicitly use cloud features.</p>
          </div>
          <div className="pt-3 border-t border-nv-border/60">
            <p className="text-[11px] text-nv-muted mb-3">Clear specific local data:</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => { localStorage.removeItem('nv-coder-state'); alert('Coder state cleared.'); }}
                className="text-[10px] px-3 py-1.5 rounded-lg border border-nv-border text-nv-muted hover:border-nv-red hover:text-nv-red transition-fast"
              >Clear Coder state</button>
              <button
                onClick={() => {
                  const key = uid ? `nv-tour-done-${uid}` : 'nv-tour-done';
                  const setupKey = uid ? `nv-first-run-done-v1-${uid}` : 'nv-first-run-done-v1';
                  localStorage.removeItem(key);
                  localStorage.removeItem(setupKey);
                  alert('Onboarding reset. Relaunch the app to see it again.');
                }}
                className="text-[10px] px-3 py-1.5 rounded-lg border border-nv-border text-nv-muted hover:border-accent hover:text-accent transition-fast"
              >Reset onboarding tour</button>
            </div>
          </div>
        </Section>

        {/* Voice */}
        <Section title="Voice — Whisper">
          {voiceStatus === 'checking' && (
            <p className="text-[11px] text-nv-muted">Checking…</p>
          )}
          {voiceStatus === 'ready' && (
            <div className="flex items-center gap-2 py-1">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="shrink-0">
                <circle cx="9" cy="9" r="9" fill="#22c55e"/>
                <path d="M4.5 9.5l3 3 6-6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <div>
                <p className="text-[12px] text-nv-text font-medium">Voice is ready</p>
                <p className="text-[10px] text-nv-muted mt-0.5">Whisper engine + model installed. Use the mic button in any chat.</p>
              </div>
            </div>
          )}
          {(voiceStatus === 'idle' || voiceStatus === 'error') && (
            <div>
              <p className="text-[12px] text-nv-text font-medium mb-0.5">Voice / Speech-to-text</p>
              <p className="text-[10px] text-nv-muted mb-3">Downloads Whisper (OpenAI) locally — ~150 MB. Lets you speak to adris.tech instead of typing.</p>
              {voiceStatus === 'error' && (
                <p className="text-[10px] text-nv-red font-mono mb-2">{voiceStep}</p>
              )}
              <button
                onClick={downloadVoice}
                className="text-[10px] px-3 py-1.5 rounded-lg border border-nv-border text-nv-muted hover:border-accent hover:text-accent transition-fast"
              >
                Download Voice (~150 MB)
              </button>
            </div>
          )}
          {voiceStatus === 'downloading' && (
            <div>
              <p className="text-[12px] text-nv-text font-medium mb-2">Downloading…</p>
              <div className="h-1 bg-nv-border rounded-full overflow-hidden mb-1">
                <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${voicePct}%` }} />
              </div>
              <p className="text-[10px] text-nv-faint font-mono">{voiceStep}</p>
            </div>
          )}
        </Section>

        {/* About */}
        <Section title="About adris.tech">
          <div className="space-y-1.5 mb-4">
            <div className="flex justify-between text-[11px]">
              <span className="text-nv-muted">Version</span>
              <span className="text-nv-text font-mono">{appVersion || '—'}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-nv-muted">Platform</span>
              <span className="text-nv-text font-mono">Tauri 2 · React · Rust</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-nv-muted">Built in</span>
              <span className="text-nv-text font-mono">India</span>
            </div>
          </div>

          {/* What's new — a summary line and a button. The full list runs to twenty-odd detailed
              entries, and dumping all of it inline turned the About panel into a wall of text
              nobody reads. The detail lives on its own screen. */}
          <div className="pt-3 border-t border-nv-border/60 mb-1">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12px] text-nv-text font-medium">What's new in v{WHATS_NEW.version}</p>
                <p className="text-[10.5px] text-nv-muted mt-0.5">
                  {WHATS_NEW.items.length} changes in this release.
                </p>
              </div>
              <button
                onClick={() => setShowWhatsNew(true)}
                className="text-[11px] px-2.5 py-1 rounded-lg border border-accent/50 text-accent hover:bg-accent/10 transition-fast shrink-0"
              >Read the details</button>
            </div>
          </div>

          {/* Update checker */}
          <div className="pt-3 border-t border-nv-border/60">
            {updateStatus === 'available' && (
              <div className="mb-3 p-3 rounded-lg bg-accent/10 border border-accent/30">
                <p className="text-[11px] text-accent font-medium">Update available — v{updateInfo.version}{updateInfo.current ? <span className="text-nv-muted font-normal"> (you're on v{updateInfo.current})</span> : null}</p>
                {updateInfo.body && <p className="text-[10px] text-nv-muted mt-1 leading-relaxed">{updateInfo.body}</p>}
                {updateInfo.propagating && !updateErr && (
                  <p className="text-[10px] text-nv-muted mt-1 leading-relaxed">Just published — if Install says it's not ready yet, give it a minute and try again.</p>
                )}
                {updateErr && (
                  <p className="text-[10px] text-nv-red mt-1.5 leading-relaxed">{updateErr}</p>
                )}
              </div>
            )}
            {updateStatus === 'latest' && (
              <p className="text-[11px] text-nv-green mb-3">You're on the latest version{updateInfo.current ? ` (v${updateInfo.current})` : ''}.</p>
            )}
            {updateStatus === 'error' && (
              <p className="text-[11px] text-nv-red mb-3">Could not check for updates. Check your connection.</p>
            )}
            {updateStatus === 'installing' && (
              <div className="mb-3">
                <p className="text-[11px] text-nv-muted">{updatePct > 0 ? `Downloading update — ${updatePct}%` : 'Starting download…'} The app will restart automatically when done.</p>
                <div className="mt-1.5 h-1.5 rounded-full bg-nv-surface2 overflow-hidden">
                  <div className="h-full bg-accent transition-all" style={{ width: `${updatePct}%` }} />
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={checkUpdate}
                disabled={updateStatus === 'checking' || updateStatus === 'installing'}
                className="text-[10px] px-3 py-1.5 rounded-lg border border-nv-border text-nv-muted hover:border-accent hover:text-accent transition-fast disabled:opacity-40"
              >
                {updateStatus === 'checking' ? 'Checking…' : 'Check for updates'}
              </button>
              {updateStatus === 'available' && (
                <button
                  onClick={installUpdate}
                  className="text-[10px] px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent/90 transition-fast"
                >
                  Install &amp; restart
                </button>
              )}
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
