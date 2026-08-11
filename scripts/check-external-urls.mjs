// EVERY EXTERNAL ADDRESS THIS APP SENDS A USER TO, CHECKED AGAINST REALITY.
//
// Written after two were found stale in one sitting: business.google.com had started landing on a
// support article instead of the profile manager, and ImageFX had been folded into Google Flow.
// Both still returned 200, so nothing complained — the user would simply have been dropped on the
// wrong page and left to work out why.
//
//   node scripts/check-external-urls.mjs
//
// A redirect is NOT automatically a failure — Google forwards several of these deliberately — so
// the final URL is printed and judged, rather than the status code alone. Run it when a studio
// stops behaving, or before a release.
import fs from 'fs';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const src = fs.readFileSync(root + 'src/lib/contentStudios.ts', 'utf8');
const entries = [...src.matchAll(/id: '([a-z]+)',[\s\S]{0,900}?url: '([^']+)'/g)].map(m => ({ id: m[1], url: m[2] }));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
let bad = 0;
console.log(`Checking ${entries.length} studio URLs\n`);
for (const e of entries) {
  const t0 = Date.now();
  try {
    const r = await fetch(e.url, { redirect: 'follow', signal: AbortSignal.timeout(25000),
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' } });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    // Landing on a help centre means the tool moved: the user wanted the thing, not the manual.
    const isHelp = /support\.google\.com|\/answer\/|help\./i.test(r.url);
    const flag = !r.ok ? 'HTTP ' + r.status : isHelp ? 'HELP PAGE' : '';
    if (flag) bad++;
    console.log(`${flag ? 'WARN' : ' ok '}  ${secs.padStart(5)}s  ${e.id.padEnd(13)} ${flag ? '[' + flag + '] ' : ''}-> ${r.url.slice(0, 78)}`);
  } catch (err) {
    bad++;
    console.log(`WARN  ${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s  ${e.id.padEnd(13)} [${err.name}] ${e.url}`);
  }
}
console.log(`\n${bad === 0 ? 'ALL REACHABLE' : bad + ' need a look'}`);
// Rate limits and sign-in walls are normal here, so this reports rather than fails a build.
process.exit(0);
