// ─── Where the user actually is ───────────────────────────────────────────────
// One source of truth for the user's market, read by the agents' system prompt, the lead-list
// enrichment fallbacks, and the open-data research sources.
//
// Why this exists: the whole lead-gen path used to assume India. The research agent was ordered
// "every row MUST be an Indian company/person", a blank city cell silently became "Bangalore",
// and the company databases queried India by construction. Someone in Chicago asking for leads in
// Chicago got Indian companies enriched with Bangalore map searches — and it looked like a normal
// answer, not an error, so they'd never know to distrust it.
//
// Precision matters more than coverage here. "London" is not a location: London UK and London
// Ontario are different markets, and so are Birmingham UK/Alabama, Cambridge UK/Massachusetts and
// Perth Australia/Scotland. So a city on its own is never enough — country is required, and the
// agent is told to ask which one rather than pick the famous one.

export interface UserLocation {
  city: string;        // "London", "Chicago", "Bengaluru"
  region?: string;     // state / province / county — "Illinois", "Ontario", "Karnataka"
  country: string;     // "United Kingdom", "United States", "India"
  countryCode?: string; // ISO-3166 alpha-2, uppercase — "GB", "US", "IN". Picks the data sources.
}

const LS_KEY = 'nv-user-location';

/** The saved location, or null when the user has never told us. Null means ASK — never assume. */
export function loadUserLocation(): UserLocation | null {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return null;
    const city = String(raw.city || '').trim();
    const country = String(raw.country || '').trim();
    // A half-saved location is worse than none: it would be injected as fact and silently narrow
    // every search. Both parts are required or we treat it as unset and ask again.
    if (!city || !country) return null;
    return {
      city,
      region: String(raw.region || '').trim() || undefined,
      country,
      countryCode: String(raw.countryCode || '').trim().toUpperCase() || countryCodeFor(country),
    };
  } catch {
    return null;
  }
}

export function saveUserLocation(loc: UserLocation): void {
  const clean: UserLocation = {
    city: (loc.city || '').trim(),
    region: (loc.region || '').trim() || undefined,
    country: (loc.country || '').trim(),
    countryCode: (loc.countryCode || '').trim().toUpperCase() || countryCodeFor(loc.country || ''),
  };
  try { localStorage.setItem(LS_KEY, JSON.stringify(clean)); } catch { /* quota — non-fatal */ }
  // Let any open view (Settings, a running chat) pick the change up without a reload.
  try { window.dispatchEvent(new CustomEvent('nv-location-changed', { detail: clean })); } catch { /* no window */ }
}

export function clearUserLocation(): void {
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent('nv-location-changed', { detail: null })); } catch { /* ignore */ }
}

/** "Chicago, Illinois, United States" — what we show the user and put in the prompt. */
export function locationLabel(loc: UserLocation | null): string {
  if (!loc) return '';
  return [loc.city, loc.region, loc.country].filter(Boolean).join(', ');
}

/** "Chicago, United States" — tighter form for search queries (region is usually noise there). */
export function locationSearchSuffix(loc: UserLocation | null): string {
  if (!loc) return '';
  return [loc.city, loc.country].filter(Boolean).join(', ');
}

/** The saved city, or '' when unset. Used where code previously hardcoded "Bangalore". */
export function userCity(): string {
  return loadUserLocation()?.city || '';
}

// ─── Country lookup ───────────────────────────────────────────────────────────
// Covers the markets a user is realistically in, by ISO code, Wikidata entity (for the company
// SPARQL) and demonym (for Wikipedia's company categories). A country that isn't listed is NOT an
// error — it just means the country-scoped databases sit out and research falls back to the
// global sources (Yahoo Finance, GitHub, web search), which is correct behaviour rather than
// quietly substituting a different country's data.

// `wiki` is the country as Wikipedia spells it inside a category title, definite article and all
// ("Software companies of THE United Kingdom"). It is not cosmetic: the previous code asked for
// "Indian_software_companies", which is not a real category — it returned zero rows on every
// call, so that entire source had been silently contributing nothing. Verified live against the
// Wikipedia API: "Software_companies_of_India" → 50 members, "Indian_software_companies" → 0.
interface CountryInfo { code: string; names: string[]; qid: string; wiki: string }

const COUNTRIES: CountryInfo[] = [
  { code: 'IN', names: ['india'], qid: 'Q668', wiki: 'India' },
  { code: 'US', names: ['united states', 'usa', 'us', 'u.s.', 'u.s.a.', 'america'], qid: 'Q30', wiki: 'the_United_States' },
  { code: 'GB', names: ['united kingdom', 'uk', 'u.k.', 'great britain', 'britain', 'england', 'scotland', 'wales'], qid: 'Q145', wiki: 'the_United_Kingdom' },
  { code: 'CA', names: ['canada'], qid: 'Q16', wiki: 'Canada' },
  { code: 'AU', names: ['australia'], qid: 'Q408', wiki: 'Australia' },
  { code: 'DE', names: ['germany', 'deutschland'], qid: 'Q183', wiki: 'Germany' },
  { code: 'FR', names: ['france'], qid: 'Q142', wiki: 'France' },
  { code: 'NL', names: ['netherlands', 'holland'], qid: 'Q55', wiki: 'the_Netherlands' },
  { code: 'ES', names: ['spain', 'españa'], qid: 'Q29', wiki: 'Spain' },
  { code: 'IT', names: ['italy', 'italia'], qid: 'Q38', wiki: 'Italy' },
  { code: 'IE', names: ['ireland'], qid: 'Q27', wiki: 'Ireland' },
  { code: 'SG', names: ['singapore'], qid: 'Q334', wiki: 'Singapore' },
  { code: 'AE', names: ['united arab emirates', 'uae', 'dubai'], qid: 'Q878', wiki: 'the_United_Arab_Emirates' },
  { code: 'JP', names: ['japan'], qid: 'Q17', wiki: 'Japan' },
  { code: 'BR', names: ['brazil', 'brasil'], qid: 'Q155', wiki: 'Brazil' },
  { code: 'ZA', names: ['south africa'], qid: 'Q258', wiki: 'South_Africa' },
  { code: 'NZ', names: ['new zealand'], qid: 'Q664', wiki: 'New_Zealand' },
];

function findCountry(country: string): CountryInfo | null {
  const c = (country || '').trim().toLowerCase().replace(/\.$/, '');
  if (!c) return null;
  return COUNTRIES.find((x) => x.code.toLowerCase() === c || x.names.includes(c)) || null;
}

export function countryCodeFor(country: string): string | undefined {
  return findCountry(country)?.code;
}

/** Wikidata entity id for the country, or '' when we don't have one (→ skip the country query). */
export function countryQid(country: string): string {
  return findCountry(country)?.qid || '';
}

/** Wikipedia company categories for the country, or [] when we have none for it. */
export function countryCompanyCategories(country: string): string[] {
  const info = findCountry(country);
  if (!info) return [];
  return [`Software_companies_of_${info.wiki}`, `Technology_companies_of_${info.wiki}`];
}

/** What GitHub's `location:` search qualifier should be for this user. */
export function githubLocation(loc: UserLocation | null): string {
  if (!loc) return '';
  return loc.country || loc.city || '';
}
