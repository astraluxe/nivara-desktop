import { loadUserLocation, countryQid, countryCompanyCategories, githubLocation } from './userLocation';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CompanyRecord {
  name: string;
  description?: string;
  sector?: string;
  type?: string;
  source: string;
  url?: string;
  country?: string;
}

// ─── Wikidata SPARQL ──────────────────────────────────────────────────────────

/** Companies registered in ONE country, by Wikidata entity id (P17 = country).
 *  Was hardwired to Q668 (India) — the caller now passes the user's own country, and skips this
 *  source entirely when we don't know where they are, rather than returning Indian companies to
 *  someone in Ohio. */
export async function wikidataCompaniesInCountry(countryQid: string, countryName: string, limit = 100): Promise<CompanyRecord[]> {
  if (!/^Q\d+$/.test(countryQid)) return [];
  const sparql = `
    SELECT DISTINCT ?company ?companyLabel ?industryLabel ?sitelink WHERE {
      ?company wdt:P31 wd:Q783794.
      ?company wdt:P17 wd:${countryQid}.
      OPTIONAL { ?company wdt:P452 ?industry. }
      OPTIONAL { ?sitelink schema:about ?company; schema:isPartOf <https://en.wikipedia.org/>. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT ${limit}
  `.trim();

  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'adris.tech Krew/1.0', 'Accept': 'application/sparql-results+json' },
  });
  if (!res.ok) throw new Error(`Wikidata SPARQL failed: ${res.status}`);
  const data = await res.json() as {
    results: { bindings: Array<{ companyLabel?: { value: string }; industryLabel?: { value: string }; sitelink?: { value: string } }> };
  };
  return data.results.bindings
    .map((b) => ({
      name:    b.companyLabel?.value ?? '',
      sector:  b.industryLabel?.value,
      url:     b.sitelink?.value,
      source:  'Wikidata',
      country: countryName,
    }))
    .filter((r) => r.name && !r.name.startsWith('Q'));
}

// ─── Wikipedia category search ────────────────────────────────────────────────

export async function wikipediaCategoryCompanies(category: string): Promise<CompanyRecord[]> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtitle=Category:${encodeURIComponent(category)}&cmlimit=50&origin=*`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Wikipedia category failed: ${res.status}`);
  const data = await res.json() as { query: { categorymembers: Array<{ title: string; pageid: number }> } };
  return (data.query?.categorymembers ?? []).map((m) => ({
    name:   m.title,
    source: 'Wikipedia',
    url:    `https://en.wikipedia.org/wiki/${encodeURIComponent(m.title.replace(/ /g, '_'))}`,
  }));
}

// ─── Yahoo Finance search ──────────────────────────────────────────────────────

export async function yahooFinanceSearch(query: string): Promise<CompanyRecord[]> {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=15&newsCount=0`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Yahoo Finance failed: ${res.status}`);
  const data = await res.json() as { quotes?: Array<{ shortname?: string; longname?: string; exchange?: string; sector?: string; symbol?: string }> };
  return (data.quotes ?? [])
    .filter((q) => q.shortname || q.longname)
    .map((q) => ({
      name:   q.longname ?? q.shortname ?? '',
      sector: q.sector,
      source: 'Yahoo Finance',
      type:   'listed',
      url:    q.symbol ? `https://finance.yahoo.com/quote/${q.symbol}` : undefined,
    }));
}

// ─── GitHub org search ────────────────────────────────────────────────────────

export async function githubTechCompanies(location: string, query: string): Promise<CompanyRecord[]> {
  const q = `${query}+type:org+location:${encodeURIComponent(location)}`;
  const url = `https://api.github.com/search/users?q=${encodeURIComponent(q)}&per_page=20`;
  const res = await fetch(url, { headers: { 'User-Agent': 'adris.tech Krew/1.0', Accept: 'application/vnd.github.v3+json' } });
  if (!res.ok) throw new Error(`GitHub search failed: ${res.status}`);
  const data = await res.json() as { items?: Array<{ login: string; html_url: string }> };
  return (data.items ?? []).map((i) => ({
    name:   i.login,
    source: 'GitHub',
    type:   'tech',
    url:    i.html_url,
  }));
}

// ─── DuckDuckGo instant answers ───────────────────────────────────────────────

export async function duckduckgoCompanyInfo(query: string): Promise<{ abstract: string; related: string[] }> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'adris.tech Krew/1.0' } });
  if (!res.ok) throw new Error(`DuckDuckGo failed: ${res.status}`);
  const data = await res.json() as { Abstract?: string; RelatedTopics?: Array<{ Text?: string }> };
  return {
    abstract: data.Abstract ?? '',
    related:  (data.RelatedTopics ?? []).map((t) => t.Text ?? '').filter(Boolean).slice(0, 5),
  };
}

// ─── Deduplication helper ─────────────────────────────────────────────────────

function deduplicateByName(records: CompanyRecord[]): CompanyRecord[] {
  const seen = new Set<string>();
  return records.filter((r) => {
    const key = r.name.toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Master parallel research function ───────────────────────────────────────

// Bound any source fetch so a single slow/hanging endpoint can't stall the whole
// research call (this was causing 100s+ hangs). Each source resolves to [] on timeout.
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export async function runParallelResearch(
  queries: string[],
  planLimit: number,
): Promise<{ results: CompanyRecord[]; sourcesCovered: string[]; total: number }> {
  // Cap queries to plan limit
  const cappedQueries = queries.slice(0, Math.min(queries.length, Math.ceil(planLimit / 10)));

  const SRC_TIMEOUT = 7000; // per source
  // Build a set of fetch tasks, each individually time-boxed
  const tasks: Promise<CompanyRecord[]>[] = [];

  // Country-scoped sources use the USER'S country, not a hardcoded one. When we don't know where
  // they are, these sit out entirely and only the global sources run — an honest smaller result
  // beats a confident list from the wrong continent.
  const loc = loadUserLocation();
  const qid = loc ? countryQid(loc.country) : '';
  if (qid) tasks.push(withTimeout(wikidataCompaniesInCountry(qid, loc!.country, Math.min(planLimit, 100)), SRC_TIMEOUT, []));

  const wikiCategories = loc ? countryCompanyCategories(loc.country) : [];
  for (const cat of wikiCategories.slice(0, Math.max(1, Math.ceil(planLimit / 30)))) {
    tasks.push(withTimeout(wikipediaCategoryCompanies(cat), SRC_TIMEOUT, []));
  }

  // Yahoo Finance is global. GitHub is filtered by the user's own country when known.
  const ghLoc = githubLocation(loc);
  for (const q of cappedQueries) {
    tasks.push(withTimeout(yahooFinanceSearch(q), SRC_TIMEOUT, []));
    if (planLimit >= 40 && ghLoc) {
      tasks.push(withTimeout(githubTechCompanies(ghLoc, q), SRC_TIMEOUT, []));
    }
  }

  // Hard overall cap so research_companies always returns within ~10s.
  const settled = await withTimeout(
    Promise.allSettled(tasks),
    10000,
    tasks.map(() => ({ status: 'fulfilled', value: [] as CompanyRecord[] }) as PromiseSettledResult<CompanyRecord[]>),
  );
  const allRecords: CompanyRecord[] = [];
  const sourcesCovered = new Set<string>();

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      allRecords.push(...result.value);
      for (const r of result.value) sourcesCovered.add(r.source);
    }
  }

  const deduped = deduplicateByName(allRecords);

  return {
    results:       deduped,
    sourcesCovered: Array.from(sourcesCovered),
    total:         deduped.length,
  };
}
