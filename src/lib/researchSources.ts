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

export async function wikidataIndianCompanies(limit = 100): Promise<CompanyRecord[]> {
  const sparql = `
    SELECT DISTINCT ?company ?companyLabel ?industryLabel ?sitelink WHERE {
      ?company wdt:P31 wd:Q783794.
      ?company wdt:P17 wd:Q668.
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
      country: 'India',
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

export async function runParallelResearch(
  queries: string[],
  planLimit: number,
): Promise<{ results: CompanyRecord[]; sourcesCovered: string[]; total: number }> {
  // Cap queries to plan limit
  const cappedQueries = queries.slice(0, Math.min(queries.length, Math.ceil(planLimit / 10)));

  // Build a set of fetch tasks
  const tasks: Promise<CompanyRecord[]>[] = [];

  // Always run Wikidata once
  tasks.push(wikidataIndianCompanies(Math.min(planLimit, 100)).catch(() => []));

  // Wikipedia categories for common Indian company categories
  const wikiCategories = [
    'Indian_software_companies',
    'Companies_listed_on_the_National_Stock_Exchange_of_India',
    'Indian_technology_companies',
  ];
  for (const cat of wikiCategories.slice(0, Math.ceil(planLimit / 30))) {
    tasks.push(wikipediaCategoryCompanies(cat).catch(() => []));
  }

  // Yahoo Finance + GitHub per query
  for (const q of cappedQueries) {
    tasks.push(yahooFinanceSearch(q).catch(() => []));
    if (planLimit >= 40) {
      tasks.push(githubTechCompanies('India', q).catch(() => []));
    }
  }

  const settled = await Promise.allSettled(tasks);
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
