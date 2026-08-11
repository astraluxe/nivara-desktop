// ─── "search for non tech companies in bangalore … put them in the list" ─────
//
// That sentence is a complete, unambiguous instruction. It names the thing (non-tech companies),
// the place (Bangalore), the number (200) and the destination (the attached list). The app has a
// deterministic lead-generation run that does exactly this — real searches, real pages, verified
// rows, saved to the Brain — and the only way to reach it was to type /leads and fill in a form.
//
// Typed as a sentence it fell through to the boss, which handed it to a model, which answered from
// memory: "As an AI, I cannot perform live web searches… based on established business presence up
// to my knowledge cutoff", followed by a hundred and fifty companies nobody had looked up. The
// tools to do it properly were attached to that agent the whole time.
//
// The user's point, and it is the right one: a slash command is a shortcut, not a requirement.
// Understanding the sentence is the app's job.
//
// So this reads the sentence. Deterministic and synchronous — no model call, so it behaves the
// same on a free key — and deliberately narrow: it either understands the request completely
// enough to run it, or it returns null and the message goes to the boss as before. A wrong parse
// launches a long browser job against the wrong query, so "not sure" must mean "don't".

export interface LeadRequest {
  /** Companies, or people in their own right. */
  find: 'companies' | 'people';
  /** What to look for, in the user's own words. */
  what: string;
  city: string;
  /** How many to find. Absent when the sentence never said — the card's default then applies. */
  count?: number;
  /** Employee bands the sentence named: "50-200 employees" -> ['51-200']. */
  sizes: string[];
  /** Local businesses are found on Maps, not LinkedIn. */
  useMaps: boolean;
  /** What the sentence actually said, for showing back before the run starts. */
  echo: string;
}

/** Words that follow "in" but are not places. */
const NOT_A_PLACE = new Set([
  'the', 'a', 'an', 'my', 'our', 'their', 'this', 'that', 'these', 'those',
  'brain', 'list', 'lists', 'file', 'note', 'notes', 'sheet', 'india', 'total', 'order',
  'general', 'particular', 'detail', 'depth', 'touch', 'charge', 'fact', 'short', 'bulk',
]);

/** Kinds of request that are emphatically NOT a lead search, however many keywords they share. */
function isExcluded(text: string): boolean {
  const t = text.toLowerCase();
  // Reading an inbox, scanning existing connections, or working an existing campaign.
  if (/\b(inbox|messages?|repl(y|ies)|dms?)\b/.test(t) && /\blinked\s?in\b/.test(t)) return true;
  if (/^\s*scan\b/.test(t)) return true;
  if (/\boutreach\b/.test(t)) return true;
  // Producing a document ABOUT finding leads is not finding leads.
  if (/\b(blog|article|essay|deck|presentation|slides?|ppt|outline|script|report|newsletter|whitepaper|case study|caption|strategy|plan)\b/.test(t)) return true;
  // A question, not an instruction.
  if (/^\s*(how|what|why|when|which|who|where|can|could|should|would|is|are|do|does)\b/.test(t)) return true;
  // Searching the user's OWN data is query_table / recall_from_brain, not a web lead run.
  if (/\b(in|from|on)\s+(my|the)\s+(brain|sheet|spreadsheet|vendor|file|note)/.test(t)) return true;
  return false;
}

/**
 * An employee-size band, if the sentence names one, mapped onto the card's own bands.
 *
 * This MUST be read before the count, because "50-200 employee" is two numbers that look exactly
 * like a quantity — and were read as one. "find more non tech companies … mainly targeting 50-200
 * employee" became "Find 50 leads": a number the user never asked for, taken from the size filter
 * they did ask for, which was then thrown away.
 */
const SIZE_BANDS: Array<{ lo: number; hi: number; key: string }> = [
  { lo: 1, hi: 10, key: '1-10' },
  { lo: 11, hi: 50, key: '11-50' },
  { lo: 51, hi: 200, key: '51-200' },
  { lo: 201, hi: 1000, key: '201-1000' },
  { lo: 1001, hi: Infinity, key: '1000+' },
];

function readSizes(text: string): { sizes: string[]; span: string } {
  const range = text.match(/\b(\d{1,5})\s*(?:[-\u2013\u2014]|to)\s*(\d{1,5})\s*\+?\s*(?:employees?|people|staff|headcount|emp\b)/i);
  const single = text.match(/\b(\d{1,5})\s*\+\s*(?:employees?|people|staff|headcount)/i);
  const m = range ?? single;
  if (!m) return { sizes: [], span: '' };
  const lo = Number(m[1]);
  const hi = range ? Number(m[2]) : Infinity;
  // Strict at the lower edge: "50-200" must not drag in the 11-50 band just because the two touch
  // at exactly 50. Overlapping on a single value is not what the user meant by a range.
  const keys = SIZE_BANDS.filter((b) => b.hi > lo && b.lo <= hi).map((b) => b.key);
  return { sizes: keys, span: m[0] };
}

/**
 * How many to find. Honours an explicit number; refuses to invent one.
 *
 * The size band is cut out of the text first, so a headcount can never be mistaken for a quantity.
 * A number also has to READ as a quantity of things — after a fetch word ("get me 200") or before
 * a noun the search is for ("50 companies") — so a year, a pincode or a price cannot become the
 * size of the run.
 */
function readCount(text: string, sizeSpan: string): number | null {
  const t = sizeSpan ? text.split(sizeSpan).join(' ') : text;
  const m = t.match(/\b(?:top|first|around|about|roughly|approx(?:imately)?|up ?to|at least|for|get(?: me)?|find(?: me)?|need|want|give me)\s+(\d{1,4})\b/i)
    ?? t.match(/\b(\d{1,4})\s+(?:\w+\s+)?(?:of them\b|more\b|compan|business|firm|startup|brand|vendor|supplier|manufactur|founder|ceo|owner|people\b|person\b|prospect|lead|contact|creator|client|customer|shop|store|restaurant|hotel|clinic|school|college|agenc|distributor|dealer)/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 3 || n > 2000) return null;
  return n;
}

/** The place, if the sentence names one. */
function readCity(text: string): string {
  const m = text.match(/\bin\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2})/i);
  if (!m) return '';
  let city = m[1].trim();
  // Trim trailing verbs the greedy capture swallowed: "in bangalore try to get" -> "bangalore".
  city = city.replace(/\s+\b(try|and|then|also|with|for|to|get|find|who|that|which|make|put|so|please|thanks|thank)\b.*$/i, '').trim();
  city = city.replace(/\s+\b(please|thanks|thank you|now|today|asap)\b\.?$/i, '').trim();
  const head = city.split(/\s+/)[0].toLowerCase();
  if (NOT_A_PLACE.has(head)) return '';
  if (city.length < 3 || city.length > 40) return '';
  return city;
}

/**
 * Read a lead-search instruction, or return null.
 *
 * Needs an action verb and a thing to find. A COUNT is no longer required: "find more non-tech
 * companies for my list" is a real, complete instruction, and demanding a number meant it fell
 * through to the boss and was answered from memory. Since this now opens the setup card rather
 * than launching a run, an unstated count is simply the card's default, which the user can see
 * and change — nothing is spent on a guess.
 */
export function parseLeadRequest(text: string): LeadRequest | null {
  const raw = String(text || '').trim();
  if (!raw || raw.length > 400) return null;                 // a brief is not a command
  if (raw.split('\n').filter((l) => l.trim()).length > 4) return null;
  if (isExcluded(raw)) return null;

  // An action verb aimed at finding things.
  if (!/\b(search|find|get|pull|gather|collect|source|look up|scrape|build|make|give|add)\b/i.test(raw)) return null;
  // The thing being found has to be nameable as an organisation or a person.
  const targetsCompanies = /\b(compan(y|ies)|business(es)?|firms?|startups?|brands?|vendors?|suppliers?|manufacturers?|agencies|agency|shops?|stores?|restaurants?|hotels?|clinics?|schools?|colleges?)\b/i.test(raw);
  const targetsPeople = /\b(founders?|ceos?|cto|cxo|directors?|managers?|heads?|owners?|people|persons?|prospects?|leads?|creators?|influencers?|consultants?|freelancers?|recruiters?)\b/i.test(raw);
  if (!targetsCompanies && !targetsPeople) return null;

  const { sizes, span: sizeSpan } = readSizes(raw);
  const count = readCount(raw, sizeSpan);
  const city = readCity(raw);

  // It has to read as a JOB, not a musing. A number, a size filter, a place, or an explicit "more
  // / another / add to the list" all say the user wants a run; none of them and it is conversation.
  const soundsLikeAJob = count !== null || sizes.length > 0 || !!city
    || /\b(more|another|add|extend|expand|top up|build (me )?a list|to the list)\b/i.test(raw);
  if (!soundsLikeAJob) return null;

  // WHAT to look for, in the user's words. Strip the scaffolding — the verb, the place, the size
  // band, the count, and the trailing "to be added to the list / who I can sell to" clauses that
  // describe the PURPOSE rather than the target. Left in, they became the search query itself:
  // "more non tech companies to be added whom i can sell my product to... mainly targeting -
  // employee" is what actually went out, and it is not a description of anybody.
  let what = raw
    .replace(/^[^a-zA-Z]*/, '')
    .replace(/\b(search|find|get|pull|gather|collect|source|look up|scrape|build|make|give|add)\b\s*(?:me\s+|for\s+|out\s+|up\s+|together\s+)?/i, '')
    .split(sizeSpan || '\u0000').join(' ')
    .replace(/\b(?:and\s+)?(?:put|add|save|store)\s+(?:them|these|it)\b.*$/i, ' ')
    .replace(/\bin\s+[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2}\b/i, ' ')
    // Purpose clauses — why they want them, not who they are.
    .replace(/\b(to|who|whom|which|that)\b[^.]{0,60}\b(sell|pitch|approach|target|reach out|contact|offer)\b.*$/i, ' ')
    .replace(/\bto be added\b.*$/i, ' ')
    .replace(/\bmainly targeting\b/gi, ' ')
    .replace(/\band\s+put\s+them.*$/i, ' ')
    .replace(/\b(?:try(?:ing)?\s+to\s+)?(?:get|find|reach)\s+\d+.*$/i, ' ')
    .replace(/\b\d{1,4}\b/g, ' ')
    .replace(/\b(of them|them|please|thanks|ok|okay|more|for my list|to the list|in the list)\b/gi, ' ')
    .replace(/[.,;:]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (what.length < 3) what = targetsPeople && !targetsCompanies ? 'decision makers' : 'companies';

  // Local, physical businesses live on Maps; everything else is LinkedIn + the web.
  const useMaps = /\b(local|near ?by|near me|shops?|stores?|restaurants?|cafes?|clinics?|salons?|gyms?|dealers?|showrooms?)\b/i.test(raw);

  return {
    find: targetsPeople && !targetsCompanies ? 'people' : 'companies',
    what,
    city,
    ...(count !== null ? { count } : {}),
    sizes,
    useMaps,
    echo: raw,
  };
}
