// ─── Which model should run this? ────────────────────────────────────────────
// IMPORTANT CORRECTION TO AN EARLIER ASSUMPTION:
// The browser, web search, Google Maps, LinkedIn scanning and file tools belong to THE APP, not to
// the hosted AI. getActiveTools() never looks at the connection mode, so a local model already has
// every one of them. "A local model can't reach the internet" is simply wrong — the app reaches the
// internet and hands the model the results.
//
// The real constraint is narrower and worth being precise about: can the model reliably emit the
// <tool_call> block and keep its place across a multi-step chain? Small models (≈3B) drift out of
// the format and loop. Mid models (7–8B) manage one or two steps. Larger local models (14B+) handle
// tool-driven work properly. So capability, not connectivity, decides — which means almost anything
// adris.tech does CAN run locally, given a model big enough for the job and a machine to hold it.

export type TaskKind =
  | 'writing'       // DMs, emails, posts, rewriting, tone
  | 'summarising'   // condense a file/page
  | 'sorting'       // classify, tag, name, pick best-fit rows
  | 'live_data'     // web search, Maps, opening sites, scanning LinkedIn — tool-driven
  | 'multi_step'    // browse → verify → save chains
  | 'long_research' // multi-source reports
  | 'structured';   // decks, strict JSON

/** How much model this task actually needs. */
export type Demand = 'light' | 'medium' | 'heavy';

export interface TaskVerdict {
  kind: TaskKind;
  demand: Demand;
  /** True when the task drives the app's tools (browser/search/Maps/files). */
  usesTools: boolean;
  /** Plain-language explanation, written for a non-technical reader. */
  why: string;
}

/**
 * Classify the request. Keyword-based on purpose: this runs before every suggestion, and spending
 * hosted tokens to decide whether to save hosted tokens would defeat the point.
 */
export function classifyTask(text: string): TaskVerdict {
  const t = (text || '').toLowerCase();

  if (/\b(google ?maps?|\bmaps\b|search the web|web search|look ?up online|find (me )?(hotels?|restaurants?|places?|companies|shops?|clinics?|vendors?|suppliers?)|nearby|near me|directions|reviews on|scan my linkedin|open (the )?(website|site|page|link)|browse|current price|latest news|who is hiring)\b/.test(t)) {
    return {
      kind: 'live_data', demand: 'heavy', usesTools: true,
      why: 'This one looks things up online. adris.tech does the looking up either way — the model just has to drive it, which needs a capable model rather than a small one.',
    };
  }
  if (/\b(verify|enrich|scan|then save|and save it|fill in the|check each|open each)\b/.test(t) && /\b(list|leads?|contacts?|profiles?|rows?)\b/.test(t)) {
    return {
      kind: 'multi_step', demand: 'heavy', usesTools: true,
      why: 'This is a chain — open, check, save, repeat. Smaller models lose their place partway through; a larger one holds the thread.',
    };
  }
  if (/\b(deck|presentation|slides?|pptx?)\b/.test(t)) {
    return {
      kind: 'structured', demand: 'heavy', usesTools: false,
      why: 'Slides need an exact format behind the scenes. Small models break it; a larger one keeps it intact.',
    };
  }
  if (/\b(research|competitor|market (size|analysis)|gtm|go[- ]to[- ]market|strategy|report on)\b/.test(t)) {
    return {
      kind: 'long_research', demand: 'heavy', usesTools: true,
      why: 'A research write-up holds a lot of sources in mind at once. That needs a bigger model to come out well.',
    };
  }
  if (/\b(summari[sz]e|tl;?dr|key points|shorten|condense)\b/.test(t)) {
    return { kind: 'summarising', demand: 'light', usesTools: false, why: 'Summarising is comfortable work for a model running on your own machine.' };
  }
  if (/\b(rewrite|reword|rephrase|make it (shorter|longer|friendlier|formal)|tone|proofread|fix the wording)\b/.test(t)) {
    return { kind: 'writing', demand: 'light', usesTools: false, why: 'Rewriting is comfortable work for a model running on your own machine.' };
  }
  if (/\b(write|draft|compose)\b/.test(t) && /\b(dm|dms|message|messages|email|emails|post|caption|reply|outreach)\b/.test(t)) {
    return { kind: 'writing', demand: 'light', usesTools: false, why: 'Writing messages is comfortable work for a model on your own machine — and it is the biggest slice of most people’s usage.' };
  }
  if (/\b(classif|categor|tag|label|group|sort|pick the best|which of these)\b/.test(t)) {
    return { kind: 'sorting', demand: 'medium', usesTools: false, why: 'Sorting and labelling runs well on your own machine.' };
  }
  return { kind: 'writing', demand: 'light', usesTools: false, why: 'Everyday writing runs well on your own machine.' };
}

export interface LocalModelPick {
  id: string;
  label: string;
  sizeGb: number;
  minRamGb: number;
  /** The heaviest work this size handles dependably. */
  handles: Demand;
  blurb: string;
  /** Only downloadable on a paid plan — do not offer this as the answer to a free user. */
  paid?: boolean;
}

// ids/sizes/ram MUST match DESKTOP_MODELS in ModelsModule.tsx, otherwise we send people to the
// Models tab looking for a model that isn't there. These were previously invented ids
// ('qwen2.5:3b' and friends) that matched nothing in the catalogue.
const CATALOGUE: LocalModelPick[] = [
  { id: 'qwen25-3b-q4',  label: 'Qwen 2.5 3B',  sizeGb: 2.0, minRamGb: 4,  handles: 'light',
    blurb: 'Light and quick. Writing, rewriting and summaries.' },
  { id: 'llama31-8b-q4', label: 'Llama 3.1 8B', sizeGb: 4.9, minRamGb: 6,  handles: 'medium',
    blurb: 'The sweet spot for most laptops — better writing, and it can follow simple tool steps.' },
  { id: 'qwen25-14b-q4', label: 'Qwen 2.5 14B', sizeGb: 8.5, minRamGb: 12, handles: 'heavy', paid: true,
    blurb: 'Handles the full job — web lookups, multi-step runs and research — entirely on your machine.' },
];

const RANK: Record<Demand, number> = { light: 0, medium: 1, heavy: 2 };

export interface Hardware { total_ram_gb: number; free_disk_gb: number }

export interface Recommendation {
  /** Best model that fits AND is strong enough for the task, if any. */
  pick: LocalModelPick | null;
  /** Best model the machine can run at all, even if not strong enough for this task. */
  bestFit: LocalModelPick | null;
  /** True when the machine simply cannot run something capable enough for this task. */
  needsHosted: boolean;
  reason: string;
}

/**
 * Pick a local model for THIS task on THIS machine.
 * Requires the model's size plus headroom — filling someone's last free gigabyte is not a favour.
 */
export function recommendLocalModel(hw: Hardware, demand: Demand = 'light'): Recommendation {
  const ram = Number(hw.total_ram_gb) || 0;
  const disk = Number(hw.free_disk_gb) || 0;
  const HEADROOM_GB = 3;

  const runnable = CATALOGUE.filter((m) => ram >= m.minRamGb && disk >= m.sizeGb + HEADROOM_GB);
  const bestFit = runnable.length ? runnable[runnable.length - 1] : null;

  if (!bestFit) {
    const smallest = CATALOGUE[0];
    const reason = disk < smallest.sizeGb + HEADROOM_GB
      ? `You have about ${disk.toFixed(0)} GB free. The smallest model needs roughly ${(smallest.sizeGb + HEADROOM_GB).toFixed(0)} GB including room to run — free up some space and this becomes an option.`
      : `With ${ram.toFixed(0)} GB of memory, running a model on this machine would slow it down more than it helps.`;
    return { pick: null, bestFit: null, needsHosted: true, reason };
  }

  const strongEnough = runnable.filter((m) => RANK[m.handles] >= RANK[demand]);
  if (strongEnough.length) {
    const pick = strongEnough[0];   // smallest that is strong enough — no need to over-download
    return { pick, bestFit, needsHosted: false, reason: `${pick.label} (${pick.sizeGb} GB) suits your machine — ${ram.toFixed(0)} GB memory, ${disk.toFixed(0)} GB free.` };
  }

  // The machine can run something, just not something strong enough for this particular job.
  const needed = CATALOGUE.find((m) => RANK[m.handles] >= RANK[demand]);
  return {
    pick: null,
    bestFit,
    needsHosted: true,
    reason: needed
      ? `Work like this needs ${needed.label} (${needed.sizeGb} GB, ${needed.minRamGb} GB memory) to run properly on your own machine. Yours has ${ram.toFixed(0)} GB memory and ${disk.toFixed(0)} GB free, so adris.tech is the better choice for this one — ${bestFit.label} still covers your writing and summaries.`
      : `adris.tech is the better choice for this one; ${bestFit.label} still covers your writing and summaries.`,
  };
}

/** Keeps the nudge from becoming nagging. */
const SEEN_KEY = 'nv-local-advice-shown';
export function shouldSuggestLocal(): boolean {
  try {
    const last = parseInt(localStorage.getItem(SEEN_KEY) || '0', 10);
    return !Number.isFinite(last) || Date.now() - last > 3 * 24 * 60 * 60 * 1000;
  } catch { return true; }
}
export function markLocalAdviceShown(): void {
  try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch { /* ignore */ }
}
