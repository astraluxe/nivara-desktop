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
  count: number;
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

/** How many to find. Honours an explicit number; refuses to invent one. */
function readCount(text: string): number | null {
  // "200 of them", "200 companies", "get me 200", "top 50", "around 100"
  const m = text.match(/\b(?:top|first|around|about|roughly|approx(?:imately)?|up to|at least|get(?: me)?|find(?: me)?|need)?\s*(\d{2,4})\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 5 || n > 2000) return null;
  return n;
}

/** The place, if the sentence names one. */
function readCity(text: string): string {
  const m = text.match(/\bin\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2})/i);
  if (!m) return '';
  let city = m[1].trim();
  // Trim trailing verbs the greedy capture swallowed: "in bangalore try to get" -> "bangalore".
  city = city.replace(/\s+\b(try|and|then|also|with|for|to|get|find|who|that|which|make|put|so)\b.*$/i, '').trim();
  const head = city.split(/\s+/)[0].toLowerCase();
  if (NOT_A_PLACE.has(head)) return '';
  if (city.length < 3 || city.length > 40) return '';
  return city;
}

/**
 * Read a lead-search instruction, or return null.
 *
 * Requires all three of: an action verb, a thing to find, and a number. The number is what makes
 * this safe to run without asking — "find some companies in Bangalore" is a conversation, "find
 * 200 non-tech companies in Bangalore" is a job with a defined end.
 */
export function parseLeadRequest(text: string): LeadRequest | null {
  const raw = String(text || '').trim();
  if (!raw || raw.length > 400) return null;                 // a brief is not a command
  if (raw.split('\n').filter((l) => l.trim()).length > 4) return null;
  if (isExcluded(raw)) return null;

  // An action verb aimed at finding things.
  if (!/\b(search|find|get|pull|gather|collect|source|look up|scrape|build|make|give)\b/i.test(raw)) return null;
  // The thing being found has to be nameable as an organisation or a person.
  const targetsCompanies = /\b(compan(y|ies)|business(es)?|firms?|startups?|brands?|vendors?|suppliers?|manufacturers?|agencies|agency|shops?|stores?|restaurants?|hotels?|clinics?|schools?|colleges?)\b/i.test(raw);
  const targetsPeople = /\b(founders?|ceos?|cto|cxo|directors?|managers?|heads?|owners?|people|persons?|prospects?|leads?|creators?|influencers?|consultants?|freelancers?|recruiters?)\b/i.test(raw);
  if (!targetsCompanies && !targetsPeople) return null;

  const count = readCount(raw);
  if (count === null) return null;   // no number => not a job, just a conversation

  const city = readCity(raw);

  // WHAT to look for, in the user's words: everything between the verb and the place/count, with
  // the scaffolding stripped. "search for non tech companies in bangalore try to get 200 of them
  // and put them in the list" -> "non tech companies".
  let what = raw
    .replace(/^[^a-z]*/i, '')
    .replace(/\b(search|find|get|pull|gather|collect|source|look up|scrape|build|make|give)\b\s*(?:me\s+|for\s+|out\s+)?/i, '')
    .replace(/\bin\s+[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2}\b/i, ' ')
    .replace(/\b(?:try(?:ing)?\s+to\s+)?(?:get|find|reach|make it)\b.*$/i, ' ')
    .replace(/\band\s+put\s+them.*$/i, ' ')
    .replace(/\b\d{1,4}\b/g, ' ')
    .replace(/\b(of them|them|please|thanks|ok|okay)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[.,;:]+$/, '')
    .trim();
  if (what.length < 3) what = targetsPeople ? 'decision makers' : 'companies';

  // Local, physical businesses live on Maps; everything else is LinkedIn + the web.
  const useMaps = /\b(local|near ?by|near me|shops?|stores?|restaurants?|cafes?|clinics?|salons?|gyms?|dealers?|showrooms?)\b/i.test(raw);

  return {
    find: targetsPeople && !targetsCompanies ? 'people' : 'companies',
    what,
    city,
    count,
    useMaps,
    echo: raw,
  };
}
