// ─── The Shelf: the rules that keep a one-click installer from owning the machine ───
//
// Every one of these comes from ADRIS-OS §12e, which worked this out for Linux. The rules did not
// change when the runtime did, and the two most important ones — the catalogue gate and the
// positive architecture match — are here because breaking either is silent.

import {
  TOOLS, toolById, isAllowedImage, dockerAdvice, phaseLabel, toolUrl,
  pickHostPort, containerName, assetMatchesArch, aiWiringFor, allowedEnvKeys,
  composeFileFor, composeImages, composeAllowed, installableNow, SUPPORT_IMAGE, DB_USER, DB_PASS,
} from './toolShelf.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

console.log('\n=== THE GATE: nothing outside the catalogue is ever pulled ===');
{
  // Rule 3 from §12e. An agent can suggest a tool; a model can produce a string that looks exactly
  // like an image name. Neither may cause a pull while there is no sandbox story.
  ok('a catalogue image is allowed', isAllowedImage('metabase/metabase'));
  ok('an arbitrary image is refused', !isAllowedImage('evil/backdoor'));
  ok('a plausible-looking near-miss is refused', !isAllowedImage('metabase/metabase-pro'));
  ok('a tag-smuggled variant is refused', !isAllowedImage('metabase/metabase:evil'));
  ok('an empty string is refused', !isAllowedImage(''));
  // The classic: a registry prefix that changes WHERE it is pulled from while looking familiar.
  ok('a re-hosted copy is refused', !isAllowedImage('ghcr.io/metabase/metabase'));
}

console.log('\n=== the catalogue is defensible ===');
{
  ok('there are tools to show', TOOLS.length >= 6);
  const ids = TOOLS.map((t) => t.id);
  ok('ids are unique', new Set(ids).size === ids.length);
  const images = TOOLS.map((t) => t.image);
  ok('images are unique', new Set(images).size === images.length);
  // The sentence that means something to a buyer is what it REPLACES, not what it is.
  ok('every tool names the paid thing it stands in for', TOOLS.every((t) => t.replaces.length > 3));
  ok('every tool names its licence — several are AGPL and that must not be hidden',
    TOOLS.every((t) => t.licence.length > 2));
  ok('every tool names its repo, so provenance can be checked',
    TOOLS.every((t) => /^[\w.-]+\/[\w.-]+$/.test(t.repo)));
  ok('every tool has a real port', TOOLS.every((t) => t.port > 0 && t.port < 65536));
  ok('lookup by id works', toolById('metabase')?.name === 'Metabase');
  ok('an unknown id is undefined, not a crash', toolById('nope') === undefined);
}

console.log('\n=== Docker missing and Docker not running are DIFFERENT SENTENCES ===');
{
  // This machine is currently installed-but-not-running, which is how the distinction got written
  // down rather than assumed. Collapsing them into "Docker unavailable" leaves someone who already
  // has it installed with no idea they simply need to start it.
  const missing = dockerAdvice({ installed: false, running: false });
  const stopped = dockerAdvice({ installed: true, running: false });
  const fine = dockerAdvice({ installed: true, running: true });

  ok('missing is not ok', !missing.ok);
  ok('...and the action is to install', missing.action === 'install');
  ok('stopped is not ok either', !stopped.ok);
  ok('...but the action is to START, not to install again', stopped.action === 'start');
  ok('the two say different things', missing.headline !== stopped.headline);
  // The headline is what a user skimming a red box actually reads — two or three words — so it must
  // not contain the wrong instruction. "Already installed" is fine in the DETAIL, where it reads as
  // reassurance; in the headline it reads as something to go and do.
  ok('a stopped daemon never puts "install" in the headline',
    !/install/i.test(stopped.headline));
  ok('...but the detail may reassure them it is already there',
    /already/i.test(stopped.detail));
  ok('...and tells them what to actually do', /start/i.test(stopped.detail));
  ok('running is ok', fine.ok);
  ok('no answer at all is treated as missing, not as fine', !dockerAdvice(null).ok);
}

console.log('\n=== "Starting up…" until the port genuinely answers ===');
{
  // §12a's exact failure: a container that has been CREATED is not a working app, and opening a
  // window at a port nothing is listening on looks broken in a way the user cannot diagnose.
  ok('a pulling tool has no URL', toolUrl({ id: 'x', phase: 'pulling', hostPort: 21001 }) === null);
  ok('a STARTING tool has no URL even though the port is known',
    toolUrl({ id: 'x', phase: 'starting', hostPort: 21001 }) === null);
  ok('a failed tool has no URL', toolUrl({ id: 'x', phase: 'failed', hostPort: 21001 }) === null);
  ok('only a ready tool has one', toolUrl({ id: 'x', phase: 'ready', hostPort: 21001 }) === 'http://127.0.0.1:21001');
  ok('ready without a port is still nothing', toolUrl({ id: 'x', phase: 'ready' }) === null);
  ok('nothing at all is nothing', toolUrl(undefined) === null);

  ok('every phase has words a person can read', ['absent','pulling','starting','ready','stopped','failed']
    .every((p) => phaseLabel(p).length > 2));
  ok('"starting" does not claim to be running', !/running/i.test(phaseLabel('starting')));
}

console.log('\n=== ports are stable, so a link keeps working ===');
{
  // Deterministic rather than random: a bookmark, a webhook, or a link pasted into an email keeps
  // working across restarts.
  ok('the same tool gets the same port every time',
    pickHostPort('metabase') === pickHostPort('metabase'));
  ok('two tools do not collide', pickHostPort('metabase') !== pickHostPort('baserow'));
  ok('ports are in a sane high range',
    TOOLS.every((t) => { const p = pickHostPort(t.id); return p >= 21000 && p < 21500; }));

  // Every catalogue tool at once, which is the case that would actually collide.
  const used = [];
  for (const t of TOOLS) used.push(pickHostPort(t.id, used));
  ok('no two catalogue tools end up on the same port', new Set(used).size === used.length);

  const taken = pickHostPort('metabase');
  ok('a taken port is stepped over, not failed on', pickHostPort('metabase', [taken]) !== taken);
}

console.log('\n=== containers cannot collide with the user\'s own ===');
{
  ok('names are namespaced to adris', containerName('metabase') === 'adris-tool-metabase');
  ok('...so a user container called "metabase" is untouched',
    containerName('metabase') !== 'metabase');
}

console.log('\n=== §12e\'s REAL BUG, kept fixed ===');
{
  // It chose `LocalSend-1.18.2-linux-arm-64.deb` on an x86-64 machine, because the obvious pattern
  // /arm64/ does not match `arm-64`. Installing it produces something that cannot run. The rule is
  // POSITIVE: an asset must look like THIS machine, not merely fail to look like another.
  ok('arm-64 with a hyphen is recognised as arm', assetMatchesArch('LocalSend-1.18.2-linux-arm-64.deb', 'arm64'));
  ok('...and is NOT offered to an x86-64 machine', !assetMatchesArch('LocalSend-1.18.2-linux-arm-64.deb', 'x64'));
  ok('aarch64 is arm too', assetMatchesArch('app-linux-aarch64.tar.gz', 'arm64'));
  ok('x86_64 matches x64', assetMatchesArch('app-linux-x86_64.zip', 'x64'));
  ok('amd64 matches x64', assetMatchesArch('app_amd64.msi', 'x64'));
  ok('win64 matches x64', assetMatchesArch('Setup-win64.exe', 'x64'));
  // The whole point of a positive test: something that names no architecture is not assumed to be
  // this one.
  ok('an asset naming no architecture is NOT assumed to fit', !assetMatchesArch('app-setup.exe', 'x64'));
  ok('...and not for arm either', !assetMatchesArch('app-setup.exe', 'arm64'));
}

// ─── A tool runs on the model the USER chose, or it says why it cannot ───────
//
// Without this, someone would configure a second AI source inside a third-party app — the exact
// competing-control problem the title-bar menu was built to end, reintroduced one container at a
// time. The two REFUSALS matter more than the successes: both are about not handing away a
// credential that was not ours to hand away.

console.log('\n=== the model reaches into the container ===');
{
  const tool = TOOLS.find((t) => t.id === 'openwebui');
  ok('an AI-native tool declares which variables it reads', !!tool.ai);
  ok('a plain tool declares none', !TOOLS.find((t) => t.id === 'metabase').ai);

  const own = aiWiringFor(tool, { mode: 'own_key', provider: 'nvidia', apiKey: 'nvapi-abc' });
  ok('an own key is passed through', own.ok);
  ok('...as the key the user actually holds', own.env.OPENAI_API_KEY === 'nvapi-abc');
  ok('...pointed at that provider', own.env.OPENAI_API_BASE_URL.includes('nvidia'));
  ok('...and the user is told which one in their own words', /nvidia/i.test(own.describe));

  const local = aiWiringFor(tool, { mode: 'local' });
  ok('a local model is reachable', local.ok);
  // THE CLASSIC MISTAKE: a container's own localhost is the container, not the machine. Using
  // 127.0.0.1 here fails in a way that looks exactly like the model being down.
  ok('...via host.docker.internal, not 127.0.0.1',
    local.env.OPENAI_API_BASE_URL.includes('host.docker.internal'));
  ok('...and never via localhost', !/127\.0\.0\.1|localhost/.test(local.env.OPENAI_API_BASE_URL));
  ok('...with a non-empty key, which OpenAI clients insist on', !!local.env.OPENAI_API_KEY);
}

console.log('\n=== THE REFUSALS ===');
{
  const tool = TOOLS.find((t) => t.id === 'openwebui');

  // adris.tech is reached with the user's own SESSION TOKEN, which identifies them to us. Handing
  // that to a third-party container so it can spend their balance would be giving away a credential
  // issued for adris, to software adris does not control.
  const hosted = aiWiringFor(tool, { mode: 'nivara' });
  ok('adris.tech is REFUSED, not quietly passed on', !hosted.ok);
  ok('...and no env escapes with it', hosted.env === undefined);
  ok('...and the user is told what to do instead', /own key|local/i.test(hosted.suggest));

  // A CLI on the host is not an HTTP endpoint. Inventing a bridge to expose a subscription over a
  // port would also breach the terms that subscription runs under.
  const cli = aiWiringFor(tool, { mode: 'agent_cli' });
  ok('the Claude Code / Codex bridge is refused', !cli.ok);
  ok('...for the real reason, not a vague one', /computer|program/i.test(cli.reason));

  // Gemini and Claude keys do not speak the OpenAI format. Passing one produces a tool that
  // installs cleanly and fails on its first message, which is the worst kind of working.
  const gem = aiWiringFor(tool, { mode: 'own_key', provider: 'gemini', apiKey: 'AIzaFake' });
  ok('a key that cannot speak the format is refused up front', !gem.ok);
  ok('...and names the ones that do', /nvidia|groq|openai|local/i.test(gem.suggest));

  const none = aiWiringFor(tool, { mode: 'own_key', provider: 'nvidia', apiKey: '' });
  ok('own-key with no key is refused', !none.ok);
  ok('nothing chosen at all is refused', !aiWiringFor(tool, null).ok);
  ok('a tool that needs no model says so', !aiWiringFor(TOOLS.find((t) => t.id === 'metabase'), { mode: 'local' }).ok);
}

console.log('\n=== a container is only told what its tool declared ===');
{
  // The same gate as isAllowedImage, applied to configuration rather than images: nothing from the
  // user's environment, and nothing a caller invented.
  const keys = allowedEnvKeys(TOOLS.find((t) => t.id === 'openwebui'));
  ok('exactly the two it declared', keys.length === 2);
  ok('...and they are the ones in its own definition',
    keys.includes('OPENAI_API_BASE_URL') && keys.includes('OPENAI_API_KEY'));
  ok('a plain tool is given nothing', allowedEnvKeys(TOOLS.find((t) => t.id === 'metabase')).length === 0);

  // Whatever wiring is produced can only ever set keys the tool asked for.
  const w = aiWiringFor(TOOLS.find((t) => t.id === 'flowise'), { mode: 'local' });
  const allowed = allowedEnvKeys(TOOLS.find((t) => t.id === 'flowise'));
  ok('every variable produced was declared by the tool',
    Object.keys(w.env).every((k) => allowed.includes(k)));
}

console.log('\n=== the Docker screen tells the truth about what it costs ===');
{
  // "Free, and only has to be installed once" was true and misleading. Someone who presses the
  // button expecting a two-minute job and meets a reboot prompt has been misled by us.
  const missing = dockerAdvice({ installed: false, running: false });
  ok('it warns about the restart', /restart/i.test(missing.detail));
  ok('it says roughly how long', /minutes/i.test(missing.detail));
  ok('it admits the download is large', /large/i.test(missing.detail));
  // A business owner learning the licence terms from Docker rather than from us is a trust problem
  // we created. Docker Desktop is not free above ~250 staff or $10M revenue.
  ok('it states the licence limit rather than hiding it', /licence|license/i.test(missing.detail));
  ok('...and who it is free for', /small business|personal/i.test(missing.detail));
  // The headline scopes it: this is the price of the BIG tools, not of the Shelf.
  ok('the headline says which tools need it, not that everything does',
    /bigger|these/i.test(missing.headline));
}

// ─── T1c: the tools that need a database ─────────────────────────────────────
//
// The real ceiling was never Docker — it was that `docker run` starts ONE container and every ERP
// and CRM a business wants needs a database beside it. A compose file is also a far more dangerous
// thing to accept from a caller than an image name, so it is GENERATED and asserted here: the only
// way to be sure a generator produces what was intended is to read what it produced.

console.log('\n=== the compose file adris generates ===');
{
  const odoo = TOOLS.find((t) => t.id === 'odoo');
  const yaml = composeFileFor(odoo, 21500);

  ok('it is a compose file', yaml.startsWith('services:'));
  ok('the app is named app', yaml.includes('  app:'));
  ok('the app image is the catalogue one', yaml.includes('image: odoo'));
  ok('the container is namespaced to adris', yaml.includes('container_name: adris-tool-odoo'));
  ok('the chosen host port is published', yaml.includes('"21500:8069"'));
  ok('the database is brought up beside it', yaml.includes('  postgres:'));
  ok('...on a pinned major version, so a user\'s data does not move under them',
    yaml.includes(SUPPORT_IMAGE.postgres));
  ok('the app waits for the database', yaml.includes('depends_on:'));

  // The service NAME is the hostname on the compose network, which is why services are named by
  // kind rather than by anything arbitrary.
  ok('the app is told to reach the database by its service name', yaml.includes('HOST: "postgres"'));
  ok('the credentials on both sides are the same', yaml.includes(`USER: "${DB_USER}"`) && yaml.includes(`POSTGRES_USER: "${DB_USER}"`));
  ok('the password matches too', yaml.includes(`PASSWORD: "${DB_PASS}"`) && yaml.includes(`POSTGRES_PASSWORD: "${DB_PASS}"`));

  // Named volumes, so "remove" can genuinely mean removed rather than leaving a customer database
  // on a machine nobody is auditing.
  ok('both sides get named volumes', yaml.includes('adris-tool-odoo-data:') && yaml.includes('adris-tool-odoo-postgres:'));
  ok('the volumes are declared', yaml.includes('volumes:'));
}
{
  // Placeholders are the whole reason a spec can be written before the port is known.
  const dolibarr = TOOLS.find((t) => t.id === 'dolibarr');
  const yaml = composeFileFor(dolibarr, 21600);
  ok('{{url}} becomes the real address', yaml.includes('http://127.0.0.1:21600/'));
  ok('...and no placeholder survives into the file', !yaml.includes('{{'));

  const kimai = TOOLS.find((t) => t.id === 'kimai');
  const k = composeFileFor(kimai, 21700);
  ok('a placeholder inside a URL string is filled too', k.includes(`mysql://${DB_USER}:${DB_PASS}@mysql/`));
}
{
  ok('a tool with no compose spec produces nothing', composeFileFor(TOOLS.find((t) => t.id === 'metabase'), 21000) === '');
}

console.log('\n=== the gate covers EVERY image, not just the app ===');
{
  // isAllowedImage protects the single-container path. A compose file names several images, and a
  // support image is exactly the sort of thing that gets added later without anyone re-checking.
  const odoo = TOOLS.find((t) => t.id === 'odoo');
  const imgs = composeImages(odoo);
  ok('the app image is included', imgs.includes('odoo'));
  ok('the database image is included', imgs.includes(SUPPORT_IMAGE.postgres));
  ok('every image a compose file would pull is allowed', composeAllowed(odoo));

  // The one that matters: an app image outside the catalogue must fail the whole check.
  const forged = { ...odoo, image: 'evil/backdoor' };
  ok('an app image outside the catalogue fails it', !composeAllowed(forged));
  // And a support image outside the fixed vocabulary.
  const forged2 = { ...odoo, compose: { ...odoo.compose, needs: ['postgres'] }, image: odoo.image };
  ok('a legitimate one still passes', composeAllowed(forged2));
}

console.log('\n=== what can actually be installed today ===');
{
  const withCompose = TOOLS.filter((t) => t.compose);
  ok('several database-backed tools now have a spec', withCompose.length >= 4,
    withCompose.map((t) => t.id).join(', '));
  ok('every one of them generates a real file',
    withCompose.every((t) => composeFileFor(t, 21000).includes('services:')));
  ok('and every one of them is allowed', withCompose.every(composeAllowed));

  // ERPNext deliberately has NO spec: it needs a site-creation step and extra processes, and a
  // compose file that starts containers with no usable site would be the Vikunja crash loop again.
  const erp = TOOLS.find((t) => t.id === 'erpnext');
  ok('ERPNext is listed but deliberately not given a half-working spec', !erp.compose);
  ok('...and still reads as not-installable', !installableNow(erp));
  ok('...with a note explaining why rather than an install button', /guided|hardest/i.test(erp.note ?? ''));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
