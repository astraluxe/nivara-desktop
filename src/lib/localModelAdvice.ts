// ─── Which model should run this? ────────────────────────────────────────────
// Two honest questions, kept separate on purpose:
//
//   1. Can a local model actually DO this task well?  → taskFitsLocal()
//   2. Which local model fits THIS machine?           → recommendLocalModel()
//
// Getting (1) wrong is worse than never suggesting anything. Pushing someone onto a local model
// for work it handles badly produces a poor result they blame on the app — and pushing them to
// pay for the hosted AI when their own laptop could have done the job for free is the complaint
// this whole feature exists to prevent. So the rule is: recommend local only where local is
// genuinely good, and say plainly (in non-technical words) when a task needs the hosted AI.

export type TaskKind =
  | 'writing'       // DMs, emails, posts, rewriting, tone — local is genuinely good
  | 'summarising'   // condense a file/page — local is good
  | 'sorting'       // classify, tag, name, pick best-fit rows — local is usually fine
  | 'live_data'     // web search, Maps, opening sites, scanning LinkedIn — needs the internet + tools
  | 'multi_step'    // browse → verify → save chains — small models lose the thread
  | 'long_research' // multi-source reports — context and reasoning limits show
  | 'structured';   // decks, strict JSON — small models produce malformed output

export interface TaskVerdict {
  kind: TaskKind;
  /** True when a local model can do this properly. */
  local: boolean;
  /** Plain-language reason, written for someone non-technical. */
  why: string;
}

/**
 * Classify what the user asked for. Deliberately keyword-based rather than an AI call: this runs
 * before every suggestion, and spending hosted tokens to decide whether to save hosted tokens
 * would be self-defeating.
 */
export function classifyTask(text: string): TaskVerdict {
  const t = (text || '').toLowerCase();

  // Anything needing the live internet or the browser can't be done by a model sitting on the
  // user's disk — it has no way to reach the outside world. This check comes FIRST because these
  // requests often also contain writing words ("find hotels and write to them").
  if (/\b(google ?maps?|\bmaps\b|search the web|web search|look ?up online|find (me )?(hotels?|restaurants?|places?|companies|shops?|clinics?|vendors?|suppliers?)|nearby|near me|directions|reviews on|scan my linkedin|open (the )?(website|site|page|link)|browse|current price|latest news|who is hiring)\b/.test(t)) {
    return {
      kind: 'live_data',
      local: false,
      why: 'This needs live information from the internet. A model on your computer has no way to look things up — it only knows what it was trained on, so it would guess. adris.tech can actually open the pages and read them.',
    };
  }
  if (/\b(verify|enrich|scan|then save|and save it|fill in the|check each|open each)\b/.test(t) && /\b(list|leads?|contacts?|profiles?|rows?)\b/.test(t)) {
    return {
      kind: 'multi_step',
      local: false,
      why: 'This is a chain of steps — open a page, check it, save the result, repeat. Smaller models lose track partway through and start repeating themselves. adris.tech handles the whole run.',
    };
  }
  if (/\b(deck|presentation|slides?|pptx?)\b/.test(t)) {
    return {
      kind: 'structured',
      local: false,
      why: 'Slides need a very exact format behind the scenes. Smaller models tend to break it, and the deck comes out malformed. adris.tech is reliable here.',
    };
  }
  if (/\b(research|competitor|market (size|analysis)|gtm|go[- ]to[- ]market|strategy|report on)\b/.test(t)) {
    return {
      kind: 'long_research',
      local: false,
      why: 'A proper research write-up pulls together a lot of sources at once. That is more than a model on a laptop can hold in its head, so the result gets thin. adris.tech is the better fit.',
    };
  }
  if (/\b(summari[sz]e|tl;?dr|key points|shorten|condense)\b/.test(t)) {
    return { kind: 'summarising', local: true, why: 'Summarising text is something your own computer does well.' };
  }
  if (/\b(rewrite|reword|rephrase|make it (shorter|longer|friendlier|formal)|tone|proofread|fix the wording)\b/.test(t)) {
    return { kind: 'writing', local: true, why: 'Rewriting is something your own computer does well.' };
  }
  if (/\b(write|draft|compose)\b/.test(t) && /\b(dm|dms|message|messages|email|emails|post|caption|reply|outreach)\b/.test(t)) {
    return { kind: 'writing', local: true, why: 'Writing messages is something your own computer does well — this is the biggest chunk of most people’s usage.' };
  }
  if (/\b(classif|categor|tag|label|group|sort|pick the best|which of these)\b/.test(t)) {
    return { kind: 'sorting', local: true, why: 'Sorting and labelling is something your own computer does well.' };
  }
  return { kind: 'writing', local: true, why: 'Everyday writing is something your own computer does well.' };
}

export interface LocalModelPick {
  id: string;            // what the Models tab downloads
  label: string;         // what the user sees
  sizeGb: number;        // download size
  minRamGb: number;
  blurb: string;         // plain-language "what this is good for"
}

// Deliberately conservative sizes. A model that technically fits but leaves the machine thrashing
// is a worse experience than not recommending one at all.
const CATALOGUE: LocalModelPick[] = [
  { id: 'qwen2.5:3b',  label: 'Qwen2.5 3B',  sizeGb: 2.0, minRamGb: 6,  blurb: 'Light and quick. Good for writing messages, rewriting and summaries on a modest laptop.' },
  { id: 'llama3.1:8b', label: 'Llama 3.1 8B', sizeGb: 4.7, minRamGb: 12, blurb: 'The sweet spot for most laptops — noticeably better writing, still comfortable to run.' },
  { id: 'qwen2.5:14b', label: 'Qwen2.5 14B', sizeGb: 9.0, minRamGb: 24, blurb: 'Strongest of the three. Only worth it if you have the memory and disk to spare.' },
];

export interface Hardware { total_ram_gb: number; free_disk_gb: number }

/**
 * The best model this machine can comfortably run, or null if none fits.
 * Requires the model's size PLUS headroom — filling someone's last free gigabyte is not a favour.
 */
export function recommendLocalModel(hw: Hardware): { pick: LocalModelPick | null; reason: string } {
  const ram = Number(hw.total_ram_gb) || 0;
  const disk = Number(hw.free_disk_gb) || 0;
  const HEADROOM_GB = 3;

  const affordable = CATALOGUE.filter((m) => ram >= m.minRamGb && disk >= m.sizeGb + HEADROOM_GB);
  if (!affordable.length) {
    const smallest = CATALOGUE[0];
    if (disk < smallest.sizeGb + HEADROOM_GB) {
      return { pick: null, reason: `You have about ${disk.toFixed(0)} GB free. The smallest model needs roughly ${(smallest.sizeGb + HEADROOM_GB).toFixed(0)} GB including room to run — free up some space and I can set it up.` };
    }
    return { pick: null, reason: `With ${ram.toFixed(0)} GB of memory, running a model locally would slow your machine down more than it helps. adris.tech is the better option here.` };
  }
  const pick = affordable[affordable.length - 1];   // best that comfortably fits
  return { pick, reason: `${pick.label} (${pick.sizeGb} GB) suits your machine — ${ram.toFixed(0)} GB memory, ${disk.toFixed(0)} GB free.` };
}

/** Has this user been told recently? Keeps the nudge from becoming nagging. */
const SEEN_KEY = 'nv-local-advice-shown';
export function shouldSuggestLocal(): boolean {
  try {
    const last = parseInt(localStorage.getItem(SEEN_KEY) || '0', 10);
    return !Number.isFinite(last) || Date.now() - last > 3 * 24 * 60 * 60 * 1000;   // at most every 3 days
  } catch { return true; }
}
export function markLocalAdviceShown(): void {
  try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch { /* ignore */ }
}
