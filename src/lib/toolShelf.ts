// ─── The Shelf: free software instead of a subscription ──────────────────────
//
// THE COMMERCIAL ARGUMENT, WHICH IS THE REAL ONE. A small business pays for a CRM, a helpdesk, an
// invoicing tool, a booking page — often ₹2,000–₹10,000 a month each. Genuinely good, genuinely free
// versions of all of them exist and are actively maintained. They are unreachable because their
// README opens with "clone the repo and run docker compose up", and for the person this product is
// for that is a wall. It is the reason they end up paying for worse software.
//
// ── THE RULES, CARRIED FROM ADRIS-OS §12e ───────────────────────────────────
//
// That document worked this out for Linux and its rules are the good part. They do not change:
//
//   1. NEVER build from source. NEVER run an install script. "curl | sh and unattended make are how
//      a one-click installer becomes a way to own the machine."
//   2. Only ever install what the project ITSELF published — the same trust model as an app store.
//   3. Catalogue-gated, not arbitrary URLs. An agent must not be able to install "whatever the
//      model said" while there is no sandbox story.
//   4. When nothing is installable, SAY SO. Silence gets read as success.
//   5. Match this machine POSITIVELY. The real bug §12e caught: it chose an `arm-64` asset on an
//      x86-64 machine because the pattern /arm64/ did not match `arm-64`. An asset must look like
//      THIS machine rather than merely fail to look like another.
//
// ── WHY DOCKER, AND NOT A WINDOWS INSTALLER ─────────────────────────────────
//
// Windows has no apt, so §12e's ladder (apt → .deb → AppImage) does not port. What does port is its
// reasoning, and it lands on Docker: it is the sandbox AND the runtime. Dependencies live inside the
// image, nothing is installed into the user's Windows, removal is one command, and the app arrives
// with a web UI on a port — which is exactly the thing adris can put in a window. Downloading an
// unsigned .exe from a release page and running it on a business owner's machine is the highest-risk
// thing this product could do, and it is deliberately not the first route.

export type ToolCategory =
  | 'Customers' | 'Money' | 'Work' | 'Data' | 'Documents' | 'Scheduling'
  | 'Everything';   // ERP — the ones that try to run the whole business in one place

export interface ToolApp {
  id: string;
  name: string;
  /** What it does, in one line, to somebody who has never heard of it. */
  blurb: string;
  /** The paid product it stands in for. This is the sentence that means something to the buyer. */
  replaces: string;
  category: ToolCategory;
  /** owner/name on GitHub — provenance the user can go and check. */
  repo: string;
  /** Stated, never hidden. Several are AGPL: fine to RUN your own copy, not fine to bundle and sell. */
  licence: string;
  /** The image the project itself publishes. Nothing else is ever pulled. */
  image: string;
  /** The port the app listens on INSIDE the container. */
  port: number;
  /** Anything the user genuinely has to know before pressing install. */
  note?: string;
  /** Set when the tool needs a model, and names the variables it reads to find one. */
  ai?: AiAware;
  /**
   * This tool needs a DATABASE and cannot run from a single container.
   *
   * FOUND WHILE ADDING THE ERP AND CRM ENTRIES, and it is the honest limit of the installer as
   * built: `docker run` starts ONE container. ERPNext wants MariaDB and Redis, Odoo wants
   * Postgres, Chatwoot wants Postgres and Redis. Those are `docker compose` jobs, and pretending
   * otherwise would produce the crash loop Vikunja produced — an install that "works" and then
   * never answers.
   *
   * Listed rather than hidden, because someone looking for an ERP should see that adris knows about
   * it and what is still needed. See T1c.
   */
  needsDatabase?: boolean;
  /** How to run it WITH its database. Present means T1c can install it; see composeFileFor. */
  compose?: ComposeSpec;
  /**
   * Configuration the tool REFUSES TO START WITHOUT.
   *
   * Found the only way it could be: by running one. Vikunja pulls and starts and then crash-loops
   * forever on "service.publicurl is required when cors.enable is true" — a container that exists,
   * reports as created, and will never answer. §12a's "a repository is not an app" made concrete.
   *
   * `{{url}}` is replaced with the address the tool will actually be reachable at, which is the
   * thing that cannot be written down in advance because the port is chosen at install time.
   */
  requiredEnv?: Record<string, string>;
  /**
   * Where inside the container this tool keeps its data.
   *
   * ALSO FOUND BY RUNNING ONE. A single hardcoded /data mount looked reasonable and is wrong:
   * Vikunja writes to /app/vikunja/files and crash-loops on "permission denied" when /data is
   * mounted instead — a second failure hiding behind the first, and invisible without an install.
   * Defaults to /data, which is right for the tools that follow that convention.
   */
  dataPath?: string;
  /**
   * Has this entry actually been installed and seen answering on THIS platform?
   *
   * The roadmap's rule — ✅ means seen working, not written — applied to a catalogue. An entry that
   * has only been read about is a claim, and a one-click install that crash-loops is worse than no
   * entry at all: the user cannot tell whether they did something wrong.
   *
   * Everything here was plausible from its documentation. Only what carries this flag has been run.
   */
  verified?: boolean;
}

/**
 * Curated, and small on purpose.
 *
 * Every entry is a project that publishes its OWN image, is actively maintained, and replaces
 * something a small business is otherwise paying for monthly. The list is short because each one has
 * to be worth defending — a catalogue of two hundred half-working tools is how an app store becomes
 * a support burden.
 */
export const TOOLS: ToolApp[] = [
  // ── VIKUNJA IS DELIBERATELY NOT HERE ──────────────────────────────────────
  //
  // It was, and it was removed after being installed. It pulls and starts and then crash-loops:
  // first on "service.publicurl is required", which requiredEnv fixed; then on a wrong data path,
  // which dataPath fixed; and then on "permission denied [process uid=1000, dir owner uid=0]",
  // because a fresh named volume is root-owned and Vikunja runs as uid 1000. That needs per-tool
  // user mapping, which is more than a one-click entry can honestly carry.
  //
  // §12e rule 4: when something is not installable, SAY SO. A catalogue entry that produces a
  // crash loop is worse than no entry, because the user cannot tell whether they did it wrong.
  // It comes back when it has been made to work, not before.
  {
    id: 'focalboard', name: 'Focalboard',
    blurb: 'Project boards and task tracking that run entirely on this computer.',
    replaces: 'Trello or Notion boards', category: 'Work',
    repo: 'mattermost/focalboard', licence: 'MIT',
    image: 'mattermost/focalboard', port: 8000,
  },
  {
    id: 'invoiceninja', name: 'Invoice Ninja',
    blurb: 'Send invoices and quotes, chase what is unpaid, and take card payments.',
    replaces: 'FreshBooks or Zoho Invoice', category: 'Money',
    repo: 'invoiceninja/invoiceninja', licence: 'Elastic-2.0',
    image: 'invoiceninja/invoiceninja', port: 80,
    note: 'Wants a database, so the first start takes a few minutes.',
  },
  {
    id: 'calcom', name: 'Cal.com',
    blurb: 'A booking page people use to put meetings in your calendar themselves.',
    replaces: 'Calendly', category: 'Scheduling',
    repo: 'calcom/cal.com', licence: 'AGPL-3.0',
    image: 'calcom/cal.com', port: 3000,
  },
  {
    id: 'chatwoot', name: 'Chatwoot',
    blurb: 'Every customer conversation — email, WhatsApp, live chat — in one inbox.',
    replaces: 'Intercom or Zendesk', category: 'Customers',
    repo: 'chatwoot/chatwoot', licence: 'MIT',
    image: 'chatwoot/chatwoot', port: 3000,
    note: 'A large image. The first download can take a while.',
  },
  {
    id: 'baserow', name: 'Baserow',
    blurb: 'Spreadsheets that behave like a database, shared with whoever needs them.',
    replaces: 'Airtable', category: 'Data',
    repo: 'bramw/baserow', licence: 'MIT',
    image: 'baserow/baserow', port: 80,
  },
  {
    id: 'metabase', name: 'Metabase',
    blurb: 'Ask questions of your own data and get charts back, without writing queries.',
    replaces: 'Tableau or Power BI', category: 'Data',
    repo: 'metabase/metabase', licence: 'AGPL-3.0',
    image: 'metabase/metabase', port: 3000,
  },
  {
    id: 'documenso', name: 'Documenso',
    blurb: 'Send a document for signature and keep the signed copy yourself.',
    replaces: 'DocuSign', category: 'Documents',
    repo: 'documenso/documenso', licence: 'AGPL-3.0',
    image: 'documenso/documenso', port: 3000,
  },

// ── RUN THE WHOLE BUSINESS ────────────────────────────────────────────────
  //
  // ERP and CRM, which is what the owner actually asked for and is the strongest thing on this
  // shelf: these are the systems a business pays the most for and adopts most deeply.
  //
  // EVERY ONE OF THEM NEEDS A DATABASE, so none can be started by the single `docker run` this
  // installer does today — they are `docker compose` jobs. They are listed anyway, marked
  // honestly, because somebody looking for an ERP should be able to see that adris knows about it
  // and exactly what is still missing. Hiding them would be the same as pretending; claiming they
  // install would be the Vikunja crash loop again, with more moving parts. See T1c.
  {
    id: 'erpnext', name: 'ERPNext',
    blurb: 'Accounts, stock, sales, purchase, payroll and manufacturing in one system — built in India, with GST.',
    replaces: 'Tally, SAP Business One or Zoho One', category: 'Everything',
    repo: 'frappe/erpnext', licence: 'GPL-3.0',
    image: 'frappe/erpnext', port: 8080,
    // THE MOST IMPORTANT ENTRY ON THIS SHELF for the audience this product is for. ADRIS-OS §12b
    // named "does my Tally still work" as the biggest commercial barrier in India; ERPNext is the
    // credible open answer, it is Indian-built, and it understands GST out of the box.
    // ERPNext is NOT given a compose spec, and that is deliberate. It needs a site-creation step
    // after the containers are up (bench new-site), plus a worker and a scheduler — several
    // processes and an ordered setup, not just "app plus database". Generating a compose file that
    // starts the containers and leaves no usable site would be the Vikunja crash loop again, with
    // more moving parts. It stays listed because someone looking for an ERP should see adris knows
    // about it, and because it is the single most valuable entry on this shelf for an Indian
    // business — see ADRIS-OS §12b on Tally.
    note: 'The most complete open ERP, and the hardest to set up — it needs a guided first-run adris does not do yet.',
    needsDatabase: true,
  },
  {
    id: 'odoo', name: 'Odoo',
    blurb: 'CRM, invoicing, stock, projects and website — pick the parts you want and leave the rest.',
    replaces: 'Zoho One or SAP', category: 'Everything',
    repo: 'odoo/odoo', licence: 'LGPL-3.0',
    image: 'odoo', port: 8069,
    note: 'adris starts PostgreSQL beside it. The first start takes a few minutes while it builds its database.',
    needsDatabase: true,
    // Odoo reads HOST/USER/PASSWORD directly, and 'postgres' is the service name on the compose
    // network — which is why services are named by kind rather than by anything arbitrary.
    compose: {
      needs: ['postgres'],
      appEnv: { HOST: 'postgres', USER: '{{dbUser}}', PASSWORD: '{{dbPass}}' },
      // MEASURED: Odoo builds its own database through a first-run wizard. Pre-creating one for it
      // hands it a database with no Odoo schema, and every page then 500s on
      // `KeyError: 'ir.http'` — a container that is running, answering, and useless. So Postgres is
      // left with only its own default database and Odoo makes its own.
      dbEnv: { POSTGRES_DB: 'postgres' },
      appData: '/var/lib/odoo',
    },
    // INSTALLED AND SEEN WORKING: compose file generated from this entry, both containers up, and
    // Odoo answering HTTP 303 to its own database-manager — which is what a usable fresh Odoo does.
    verified: true,
  },
  {
    id: 'dolibarr', name: 'Dolibarr',
    blurb: 'A smaller ERP and CRM for a business that wants one place for customers, quotes and stock.',
    replaces: 'Zoho or a pile of spreadsheets', category: 'Everything',
    repo: 'Dolibarr/dolibarr', licence: 'GPL-3.0',
    image: 'dolibarr/dolibarr', port: 80,
    note: 'adris starts MariaDB beside it.',
    needsDatabase: true,
    compose: {
      needs: ['mariadb'],
      appEnv: {
        DOLI_DB_HOST: 'mariadb', DOLI_DB_USER: '{{dbUser}}',
        DOLI_DB_PASSWORD: '{{dbPass}}', DOLI_DB_NAME: '{{dbName}}',
        DOLI_URL_ROOT: '{{url}}',
      },
      appData: '/var/www/documents',
    },
  },
  {
    id: 'espocrm', name: 'EspoCRM',
    blurb: 'Track every customer, deal and follow-up, with the whole team seeing the same thing.',
    replaces: 'Salesforce or HubSpot', category: 'Customers',
    repo: 'espocrm/espocrm', licence: 'AGPL-3.0',
    image: 'espocrm/espocrm', port: 80,
    note: 'adris starts MySQL beside it. Sign in as admin the first time.',
    needsDatabase: true,
    compose: {
      needs: ['mysql'],
      appEnv: {
        ESPOCRM_DATABASE_HOST: 'mysql', ESPOCRM_DATABASE_USER: '{{dbUser}}',
        ESPOCRM_DATABASE_PASSWORD: '{{dbPass}}', ESPOCRM_DATABASE_NAME: '{{dbName}}',
        ESPOCRM_SITE_URL: '{{url}}',
      },
      appData: '/var/www/html',
    },
  },
  {
    id: 'twentycrm', name: 'Twenty',
    blurb: 'A modern CRM that feels like a spreadsheet and keeps your pipeline in one view.',
    replaces: 'Salesforce', category: 'Customers',
    repo: 'twentyhq/twenty', licence: 'AGPL-3.0',
    image: 'twentycrm/twenty', port: 3000,
    note: 'Needs PostgreSQL and Redis alongside it.',
    needsDatabase: true,
  },
  {
    id: 'zammad', name: 'Zammad',
    blurb: 'Turn customer emails and calls into tickets nothing falls out of.',
    replaces: 'Zendesk or Freshdesk', category: 'Customers',
    repo: 'zammad/zammad', licence: 'AGPL-3.0',
    image: 'zammad/zammad', port: 8080,
    note: 'Needs PostgreSQL, Redis and Elasticsearch alongside it.',
    needsDatabase: true,
  },
  {
    id: 'akaunting', name: 'Akaunting',
    blurb: 'Small-business accounting — invoices, expenses, and what you actually made this month.',
    replaces: 'QuickBooks or Zoho Books', category: 'Money',
    repo: 'akaunting/akaunting', licence: 'GPL-3.0',
    image: 'akaunting/akaunting', port: 80,
    note: 'Needs MySQL alongside it.',
    needsDatabase: true,
  },
  {
    id: 'kimai', name: 'Kimai',
    blurb: 'Track hours against customers and projects, and bill from them.',
    replaces: 'Toggl or Harvest', category: 'Money',
    repo: 'kimai/kimai', licence: 'AGPL-3.0',
    image: 'kimai/kimai2', port: 8001,
    note: 'adris starts MySQL beside it.',
    needsDatabase: true,
    compose: {
      needs: ['mysql'],
      appEnv: {
        DATABASE_URL: 'mysql://{{dbUser}}:{{dbPass}}@mysql/{{dbName}}?charset=utf8mb4&serverVersion=8.0.0',
        APP_ENV: 'prod',
      },
      appData: '/opt/kimai/var/data',
    },
  },

  // ── AI-NATIVE: these run on whatever the title-bar menu is set to ─────────
  //
  // A chat UI or a workflow builder with no model behind it is an empty box, so these take their
  // model from the SAME choice as the rest of adris. Without that the user would be configuring a
  // second AI source inside a third-party app — the exact competing-control problem the title-bar
  // menu exists to end, reintroduced one container at a time.
  {
    id: 'openwebui', name: 'Open WebUI',
    blurb: 'A full chat workspace for your team, with saved prompts, documents and per-person logins.',
    replaces: 'ChatGPT Team seats', category: 'Work',
    repo: 'open-webui/open-webui', licence: 'BSD-3-Clause',
    image: 'ghcr.io/open-webui/open-webui', port: 8080,
    note: 'A large download the first time. Runs on the model you picked at the top of the window.',
    ai: { baseUrlEnv: 'OPENAI_API_BASE_URL', apiKeyEnv: 'OPENAI_API_KEY', wantsV1: true },
  },
  {
    id: 'flowise', name: 'Flowise',
    blurb: 'Build an AI assistant by dragging boxes — no code, and it runs on your own model.',
    replaces: 'Custom GPT builders', category: 'Work',
    repo: 'FlowiseAI/Flowise', licence: 'Apache-2.0',
    image: 'flowiseai/flowise', port: 3000,
    ai: { baseUrlEnv: 'OPENAI_API_BASE_URL', apiKeyEnv: 'OPENAI_API_KEY', wantsV1: true },
  },
  // n8n was here and has been REMOVED. Two reasons, and the second is the real one:
  //
  //   1. adris already HAS an automation engine, with its own canvas and its own agents. Offering a
  //      second one on the Shelf asks a non-technical owner to choose between two things that do
  //      the same job, which is a worse product than offering one.
  //   2. It cannot be used from inside adris anyway: it sends `X-Frame-Options: SAMEORIGIN`, so the
  //      best the Shelf could ever do was hand the user a link out to their browser. A catalogue
  //      entry whose whole experience is "we opened a browser tab for you" is not carrying its weight.
  //
  // Nothing is lost by its absence: anyone who wants n8n can run it themselves, and the Automation
  // module covers the job the entry was there for.
];

/** What a single `docker run` can actually start today. The rest wait for compose — see T1c. */
// A tool needing a database is installable once adris has a RECIPE for it. The gate is no longer
// "does it need a database" — T1c answered that — but "does adris know how to bring the whole
// thing up". ERPNext needs a site-creation step and extra processes, so it still has none.
export const installableNow = (t: ToolApp): boolean => !t.needsDatabase || !!t.compose;

export const toolById = (id: string): ToolApp | undefined => TOOLS.find((t) => t.id === id);

/**
 * THE GATE. Nothing is ever pulled that is not in the catalogue.
 *
 * This is rule 3 from §12e and it is the single most important function in the file. An agent can
 * suggest a tool; a model can produce a string that looks like an image name; neither may cause a
 * pull. Every path to Docker goes through here, so "install whatever the model said" is not a bug
 * that can be introduced later by a careless caller — it is unreachable.
 */
export function isAllowedImage(image: string): boolean {
  return TOOLS.some((t) => t.image === image);
}

// ── Docker, and the two very different ways it can be absent ────────────────

export interface DockerState {
  /** The CLI is on this machine. */
  installed: boolean;
  /** The daemon actually answers. Installed-but-not-running is the common case. */
  running: boolean;
  version?: string;
}

/**
 * What to tell the user, and what they can do about it.
 *
 * "Docker is missing" and "Docker is not running" are DIFFERENT SENTENCES with different actions,
 * and collapsing them into "Docker unavailable" leaves someone who already has it installed with
 * no idea that they simply need to start it. This machine is currently in exactly that state, which
 * is how the distinction got written down rather than assumed.
 */
export function dockerAdvice(d: DockerState | null): { ok: boolean; headline: string; detail: string; action?: 'install' | 'start' } {
  if (!d || !d.installed) {
    return {
      ok: false,
      headline: 'These bigger tools need Docker',
      // SAY WHAT IT ACTUALLY COSTS THEM. "It is free and only has to be installed once" was true
      // and misleading: it takes a large download, a restart, and usually Administrator rights, and
      // on a managed office laptop it may not be possible at all. Someone who presses the button
      // expecting a two-minute job and meets a reboot prompt has been misled by us.
      //
      // The licence line is not optional either. Docker Desktop is free for personal use and small
      // businesses and NOT free above roughly 250 staff or $10M revenue — a business owner learning
      // that from Docker rather than from us is a trust problem we created.
      detail: 'Docker is a free program that keeps them separate from the rest of your computer. '
            + 'It is a large download and usually needs a restart, so set aside about ten minutes. '
            + 'Free for personal use and small businesses; larger companies need a paid licence.',
      action: 'install',
    };
  }
  if (!d.running) {
    return {
      ok: false,
      // The headline is kept free of the word "install" on purpose. A user skimming a red box for
      // what to do next reads two or three words, and "install" is the wrong one when the whole
      // point is that they already have it — the reassurance belongs in the detail, where it is
      // read as reassurance rather than as an instruction.
      headline: 'Docker is not running',
      detail: 'It is already on this computer — just start Docker Desktop and this page will pick '
            + 'it up. Nothing needs downloading.',
      action: 'start',
    };
  }
  return { ok: true, headline: 'Ready', detail: '' };
}

// ── What is installed, and whether it is actually usable yet ────────────────

export type ToolPhase = 'absent' | 'pulling' | 'starting' | 'ready' | 'stopped' | 'failed' | 'crashing';

export interface ToolState {
  id: string;
  phase: ToolPhase;
  /** Host port it was published on. Chosen by us, remembered here. */
  hostPort?: number;
  /** Progress line from the pull, shown verbatim — docker's own words are clearer than ours. */
  step?: string;
  error?: string;
  /**
   * The tail of the container's own log, kept when a start fails.
   *
   * A failure used to be one guessed sentence — "It may need longer, or the port may be in use" —
   * with nothing behind it. The log is where the actual reason is (a database that would not
   * migrate, a port already taken, a missing environment variable), and it is Docker's own words
   * rather than ours.
   */
  log?: string;
}

/**
 * What the user is told, per phase.
 *
 * "STARTING UP…" UNTIL THE PORT GENUINELY ANSWERS. §12a records the exact failure this prevents: a
 * container that has been created is not a working app, and opening a window at a port nothing is
 * listening on looks broken in a way the user cannot diagnose. `ready` is only ever set by something
 * that got an answer.
 */
export function phaseLabel(p: ToolPhase): string {
  switch (p) {
    case 'absent':   return 'Not installed';
    case 'pulling':  return 'Downloading…';
    case 'starting': return 'Starting up…';
    case 'ready':    return 'Running';
    case 'stopped':  return 'Stopped';
    // A container restarting over and over is NOT stopped and NOT starting — it is failing, on a
    // loop, and saying "Starting up…" about it would be a lie that never resolves.
    case 'crashing': return 'Keeps stopping';
    case 'failed':   return 'Did not start';
  }
}

/** Only a running tool has something to show. */
export function toolUrl(s: ToolState | undefined): string | null {
  return s && s.phase === 'ready' && s.hostPort ? `http://127.0.0.1:${s.hostPort}` : null;
}

/**
 * A free host port for a tool, stable per tool so its URL does not move between restarts.
 *
 * Deliberately deterministic rather than random: a bookmark, a webhook, or a link the user pasted
 * somewhere else keeps working. The range is high enough to avoid anything a business machine is
 * likely to be running, and `taken` skips a collision rather than failing.
 */
export function pickHostPort(id: string, taken: number[] = []): number {
  const BASE = 21_000, SPAN = 500;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % SPAN;
  let port = BASE + h;
  while (taken.includes(port)) port = BASE + ((port - BASE + 1) % SPAN);
  return port;
}

/** The container adris made for a tool. Namespaced so it can never collide with the user's own. */
export const containerName = (id: string): string => `adris-tool-${id}`;

/** Where the tool's own storage is mounted. Per tool, because they do not agree — see dataPath. */
export const dataMount = (t: ToolApp): string => `adris-tool-${t.id}-data:${t.dataPath ?? '/data'}`;

/**
 * Which architecture this machine is, for picking an asset.
 *
 * §12e'S REAL BUG, KEPT: it selected `LocalSend-1.18.2-linux-arm-64.deb` on an x86-64 machine
 * because `/arm64/` does not match `arm-64`. So the test is POSITIVE — an asset must look like this
 * machine — and the separator is allowed to be anything. Docker resolves architecture itself, so
 * this is not on the critical path today; it is here because the moment a second route is added
 * (a release binary) it is needed, and re-deriving it from scratch is how the bug comes back.
 */
export function assetMatchesArch(name: string, arch: 'x64' | 'arm64'): boolean {
  const n = name.toLowerCase();
  const wanted = arch === 'arm64'
    ? /(arm[-_. ]?64|aarch[-_. ]?64)/
    : /(x86[-_. ]?64|amd[-_. ]?64|win[-_. ]?64|x64)/;
  return wanted.test(n);
}

// ─── Tools that run on the model YOU chose ───────────────────────────────────
//
// The first eight tools in this catalogue are standalone — a CRM is a CRM whether or not there is a
// model behind it. The ones below are different: they are AI-native, and a chat UI or a workflow
// builder with no model behind it is an empty box.
//
// So they take their model from the SAME title-bar choice as everything else in adris. If the user
// picked their own NVIDIA key, the tool runs on that key. If they picked a local model, the tool
// talks to the local engine. One setting, and it reaches into the containers too — otherwise the
// user would be configuring a second AI source inside a third-party app, which is the exact
// competing-control problem the title-bar menu was built to end.

/** Which environment variables a tool reads to find a model. Declared by the tool, never guessed. */
export interface AiAware {
  baseUrlEnv: string;
  apiKeyEnv: string;
  /** Most OpenAI-compatible tools want the base WITHOUT /chat/completions on the end. */
  wantsV1?: boolean;
}

/** The chosen source, reduced to what a container can actually be told. */
export interface AiForTool {
  mode: 'own_key' | 'local' | 'nivara' | 'agent_cli';
  apiKey?: string | null;
  provider?: string | null;
}

export type AiWiring =
  | { ok: true; env: Record<string, string>; describe: string }
  | { ok: false; reason: string; suggest: string };

/**
 * What to tell a container about the user's model — and when to refuse.
 *
 * THE REFUSALS ARE THE IMPORTANT PART, and both are about not handing away something that is not
 * ours to hand away:
 *
 *   adris.tech — the hosted model is reached with the USER'S OWN SESSION TOKEN, which identifies
 *   them to us. Passing that into a third-party container so it can spend their balance would be
 *   giving away a credential that was issued for adris, to software adris does not control. It is
 *   refused, and the user is told to point the tool at their own key or a local model instead.
 *
 *   Claude Code / Codex — a CLI on the host, not an HTTP endpoint. There is nothing a container
 *   could be told. Saying "not supported here" is the honest answer; inventing a bridge to expose a
 *   subscription over a port would also breach the terms that subscription runs under.
 */
export function aiWiringFor(tool: ToolApp, src: AiForTool | null): AiWiring {
  if (!tool.ai) return { ok: false, reason: 'This tool does not use a model.', suggest: '' };
  if (!src) return { ok: false, reason: 'No AI source is set yet.', suggest: 'Pick one from the menu at the top of the window.' };

  const { baseUrlEnv, apiKeyEnv, wantsV1 } = tool.ai;

  if (src.mode === 'nivara') {
    return {
      ok: false,
      reason: 'adris.tech AI cannot be shared with another program.',
      suggest: 'Point this tool at your own key or a local model — switch in the menu at the top of the window. '
             + 'Everything else in adris keeps using adris.tech.',
    };
  }
  if (src.mode === 'agent_cli') {
    return {
      ok: false,
      reason: 'Claude Code and Codex run as programs on this computer, not as something another app can call.',
      suggest: 'Point this tool at your own key or a local model instead.',
    };
  }
  if (src.mode === 'local') {
    // The local engine runs on the HOST, and a container's own localhost is the container. Docker
    // publishes the host under this name for exactly this case; using 127.0.0.1 here is the classic
    // mistake and fails in a way that looks like the model is down.
    return {
      ok: true,
      env: {
        [baseUrlEnv]: `http://host.docker.internal:11434${wantsV1 ? '/v1' : ''}`,
        [apiKeyEnv]: 'local',   // most OpenAI-compatible clients insist on a non-empty key
      },
      describe: 'your local model',
    };
  }
  // own_key. It is the user's own key, on the user's own machine, and the confirm dialog says so
  // before it happens.
  if (!src.apiKey) {
    return { ok: false, reason: 'No key is connected.', suggest: 'Connect one in Connect Apps — NVIDIA and Groq are free.' };
  }
  const base = OPENAI_COMPATIBLE_BASE[src.provider ?? ''] ?? null;
  if (!base) {
    return {
      ok: false,
      reason: `A ${src.provider} key cannot be handed to this tool — it does not speak the OpenAI format these tools expect.`,
      suggest: 'NVIDIA, Groq, OpenAI or a local model all work here.',
    };
  }
  return {
    ok: true,
    env: { [baseUrlEnv]: base, [apiKeyEnv]: src.apiKey },
    describe: `your ${src.provider} key`,
  };
}

/** Only providers that genuinely speak the OpenAI format. Gemini and Claude do not, and pretending
 *  otherwise produces a tool that installs cleanly and fails on its first message. */
const OPENAI_COMPATIBLE_BASE: Record<string, string> = {
  nvidia: 'https://integrate.api.nvidia.com/v1',
  groq:   'https://api.groq.com/openai/v1',
  openai: 'https://api.openai.com/v1',
};

/**
 * The env a tool is allowed to be given.
 *
 * A container is only ever handed the two variables IT DECLARED. Nothing else from the user's
 * environment, and nothing a caller made up — the same gate as `isAllowedImage`, applied to
 * configuration rather than to images.
 */
export function allowedEnvKeys(tool: ToolApp): string[] {
  return [
    ...(tool.ai ? [tool.ai.baseUrlEnv, tool.ai.apiKeyEnv] : []),
    ...Object.keys(tool.requiredEnv ?? {}),
  ];
}

/**
 * The configuration a tool cannot start without, with its real address filled in.
 *
 * The address is only knowable at install time — the port is chosen then — so the catalogue holds a
 * placeholder and this fills it. Kept separate from the AI wiring because these two fail for
 * completely different reasons and a user needs to be told which.
 */
export function requiredEnvFor(tool: ToolApp, hostPort: number): Record<string, string> {
  const url = `http://127.0.0.1:${hostPort}/`;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tool.requiredEnv ?? {})) out[k] = v.replace('{{url}}', url);
  return out;
}

// ─── T1c: the tools that need a database ─────────────────────────────────────
//
// THE REAL CEILING, and it is not Docker. Every ERP and CRM a business actually wants — ERPNext,
// Odoo, EspoCRM, Zammad — needs a database running beside it, and `docker run` starts ONE
// container. So the limit was never "the user does not have Docker"; it was that one container
// cannot be a database-backed application.
//
// ── THE SAME GATE, APPLIED TO A HARDER SURFACE ──────────────────────────────
//
// A compose file is a far more dangerous thing to accept from a caller than an image name: it names
// several images, mounts, ports, environment and networks at once. So it is never accepted — it is
// GENERATED here, from this catalogue, out of a fixed vocabulary. There is no path by which a model,
// an agent, or a future careless caller can hand adris a compose file to run.

/** Support services adris knows how to run. A fixed vocabulary, not a free field. */
export type SupportKind = 'postgres' | 'mariadb' | 'mysql' | 'redis';

/** The images allowed for those roles — pinned to a major version so an upstream change cannot
 *  silently alter what a user's data lives in. */
export const SUPPORT_IMAGE: Record<SupportKind, string> = {
  postgres: 'postgres:16',
  mariadb: 'mariadb:11',
  mysql: 'mysql:8',
  redis: 'redis:7',
};

export interface ComposeSpec {
  /** Which support services this tool needs beside it. */
  needs: SupportKind[];
  /** Environment for the APP container. `{{db}}` etc. are filled in with the service names. */
  appEnv?: Record<string, string>;
  /** Environment for the database, when the image wants specific names. */
  dbEnv?: Record<string, string>;
  /** Where the app keeps its data inside its own container. */
  appData?: string;
}

/** The database credentials adris generates. Fixed rather than random because the two sides of the
 *  compose file have to agree, and this all lives inside one private Docker network that nothing
 *  outside the machine can reach. */
export const DB_USER = 'adris';
export const DB_PASS = 'adris-local';
export const DB_NAME = 'adris';

/** Where a support service keeps its data, per kind. */
const SUPPORT_DATA: Record<SupportKind, string> = {
  postgres: '/var/lib/postgresql/data',
  mariadb: '/var/lib/mysql',
  mysql: '/var/lib/mysql',
  redis: '/data',
};

/** The env a support service needs to come up with a usable database already created. */
function supportEnv(kind: SupportKind): Record<string, string> {
  switch (kind) {
    case 'postgres':
      return { POSTGRES_USER: DB_USER, POSTGRES_PASSWORD: DB_PASS, POSTGRES_DB: DB_NAME };
    case 'mariadb':
    case 'mysql':
      return {
        MYSQL_ROOT_PASSWORD: DB_PASS, MYSQL_USER: DB_USER,
        MYSQL_PASSWORD: DB_PASS, MYSQL_DATABASE: DB_NAME,
      };
    case 'redis':
      return {};
  }
}

/**
 * Build the compose file for one tool.
 *
 * Pure, and returns a string rather than writing one — so the exact YAML that will run can be
 * asserted in a test without Docker, which is the only way to be sure a generator like this is not
 * quietly producing something different from what was intended.
 *
 * The app is always `app`, and support services are named by their kind, so `{{db}}` in a tool's
 * env resolves to a hostname that exists on the compose network.
 */
export function composeFileFor(tool: ToolApp, hostPort: number): string {
  const spec = tool.compose;
  if (!spec) return '';
  const id = tool.id;
  const lines: string[] = ['services:'];

  // The app.
  lines.push('  app:');
  lines.push(`    image: ${tool.image}`);
  lines.push(`    container_name: adris-tool-${id}`);
  lines.push('    restart: unless-stopped');
  lines.push('    ports:');
  lines.push(`      - "${hostPort}:${tool.port}"`);
  if (spec.needs.length) {
    lines.push('    depends_on:');
    for (const k of spec.needs) lines.push(`      - ${k}`);
  }
  const appEnv = { ...(spec.appEnv ?? {}) };
  if (Object.keys(appEnv).length) {
    lines.push('    environment:');
    for (const [k, v] of Object.entries(appEnv)) {
      // Only the placeholders adris defines. Anything else is passed through as written.
      const filled = v
        .replace('{{url}}', `http://127.0.0.1:${hostPort}/`)
        .replace('{{dbUser}}', DB_USER)
        .replace('{{dbPass}}', DB_PASS)
        .replace('{{dbName}}', DB_NAME);
      lines.push(`      ${k}: "${filled.replace(/"/g, '\\"')}"`);
    }
  }
  if (spec.appData) {
    lines.push('    volumes:');
    lines.push(`      - adris-tool-${id}-data:${spec.appData}`);
  }

  // The support services.
  for (const kind of spec.needs) {
    lines.push(`  ${kind}:`);
    lines.push(`    image: ${SUPPORT_IMAGE[kind]}`);
    lines.push(`    container_name: adris-tool-${id}-${kind}`);
    lines.push('    restart: unless-stopped');
    // dbEnv OVERRIDES the defaults rather than merely adding to them: Odoo needs POSTGRES_DB left
    // at its default, and a merge that could not override would silently keep pre-creating the
    // empty database that makes Odoo 500.
    const env = { ...supportEnv(kind), ...(kind !== 'redis' ? (spec.dbEnv ?? {}) : {}) };
    if (Object.keys(env).length) {
      lines.push('    environment:');
      for (const [k, v] of Object.entries(env)) lines.push(`      ${k}: "${v}"`);
    }
    lines.push('    volumes:');
    lines.push(`      - adris-tool-${id}-${kind}:${SUPPORT_DATA[kind]}`);
  }

  // Named volumes, so removing the tool takes its data with it rather than leaving it on a machine
  // nobody is auditing.
  lines.push('volumes:');
  if (spec.appData) lines.push(`  adris-tool-${id}-data:`);
  for (const kind of spec.needs) lines.push(`  adris-tool-${id}-${kind}:`);

  return lines.join('\n') + '\n';
}

/**
 * Every image a compose file would pull, so the catalogue gate can cover ALL of them.
 *
 * `isAllowedImage` protects the single-container path. A compose file names several images, and a
 * support image is exactly the sort of thing that would be added later without anyone thinking to
 * re-check it — so the check is over the generated set, not over the app image alone.
 */
export function composeImages(tool: ToolApp): string[] {
  return [tool.image, ...(tool.compose?.needs ?? []).map((k) => SUPPORT_IMAGE[k])];
}

/** True when every image a tool would pull is one adris knows about. */
export function composeAllowed(tool: ToolApp): boolean {
  const support = new Set(Object.values(SUPPORT_IMAGE));
  return composeImages(tool).every((img) => img === tool.image ? isAllowedImage(img) : support.has(img));
}
