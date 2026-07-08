#!/usr/bin/env node
// Scans HuggingFace's free public API for new GGUF releases from the two quantizer
// accounts our catalogue already trusts (bartowski, unsloth), verifies each candidate
// file actually resolves anonymously, and appends genuinely new entries to
// api/models-registry.json. Costs nothing (HF's model-listing API needs no key) and
// touches nothing live by itself — review the printed summary, then commit + push
// the updated registry.json same as any other change. The desktop app and website
// both read the live registry over the network, so a push is all a release needs.
//
// Usage: node scripts/scan-models.js [--limit 20] [--write]
//   (no --write: dry run, just prints what it WOULD add)

const fs = require('fs');
const path = require('path');

const REGISTRY_PATH = path.join(__dirname, '..', '..', 'api', 'models-registry.json');
const QUANTIZERS = ['bartowski', 'unsloth'];
const MAX_SIZE_GB = 45; // single-file download ceiling — bigger needs Mesh, out of scope for auto-add
const SKIP_NAME = /vision|audio|embed|reranker|guard|moderation|base(?!line)/i; // not chat/instruct-usable as-is

const args = process.argv.slice(2);
const LIMIT = Number(args[args.indexOf('--limit') + 1]) || 25;
const WRITE = args.includes('--write');

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'adris-model-scanner/1.0' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function headOk(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return { ok: res.ok, size: Number(res.headers.get('content-length') || 0) };
  } catch {
    return { ok: false, size: 0 };
  }
}

function guessBestFor(name) {
  const n = name.toLowerCase();
  const tags = [];
  if (/coder|code|coding/.test(n)) tags.push('coding');
  if (/reason|r1|qwq|think/.test(n)) tags.push('reasoning');
  if (/chat|instruct/.test(n)) tags.push('chat');
  if (/write|story/.test(n)) tags.push('writing');
  return tags.length ? tags : ['chat'];
}

function estimateRam(sizeGb) {
  const min = Math.ceil(sizeGb * 1.15);
  return { min, recommended: Math.ceil(sizeGb * 1.4) };
}

async function main() {
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const knownRepos = new Set(registry.models.filter(m => m.hf_repo).map(m => m.hf_repo.toLowerCase()));
  const knownIds = new Set(registry.models.map(m => m.id));

  const candidates = [];
  for (const author of QUANTIZERS) {
    let list;
    try {
      list = await fetchJson(`https://huggingface.co/api/models?author=${author}&sort=createdAt&direction=-1&limit=${LIMIT}`);
    } catch (e) {
      console.error(`Could not list ${author}'s repos:`, e.message, e.cause || '');
      continue;
    }
    for (const repo of list) {
      if (!/-GGUF$/i.test(repo.id)) continue;
      if (knownRepos.has(repo.id.toLowerCase())) continue;
      if (SKIP_NAME.test(repo.id)) continue;
      candidates.push(repo.id);
    }
  }

  console.log(`Checked ${QUANTIZERS.join(', ')} — ${candidates.length} unfamiliar GGUF repo(s) to inspect.\n`);

  const added = [];
  for (const repoId of candidates) {
    const shortName = repoId.split('/')[1].replace(/-GGUF$/i, '');
    const file = `${shortName}-Q4_K_M.gguf`;
    const url = `https://huggingface.co/${repoId}/resolve/main/${file}`;
    const { ok, size } = await headOk(url);
    if (!ok) continue; // wrong filename convention or actually gated — skip, don't guess

    const sizeGb = Math.round((size / 1_073_741_824) * 10) / 10;
    if (sizeGb === 0 || sizeGb > MAX_SIZE_GB) continue;

    const id = shortName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-q4';
    if (knownIds.has(id)) continue;

    const ram = estimateRam(sizeGb);
    const entry = {
      id, name: shortName.replace(/[-_]/g, ' '), creator: repoId.split('/')[0] === 'bartowski' || repoId.split('/')[0] === 'unsloth' ? 'Community' : repoId.split('/')[0],
      params: 'unknown', quantization: 'Q4_K_M', size_gb: sizeGb,
      ram_min_gb: ram.min, ram_recommended_gb: ram.recommended, context_length: 8192,
      best_for: guessBestFor(shortName), license: 'Check HF repo', gated: false,
      description: `Auto-discovered from ${repoId}. Verify details before promoting out of the "new" list.`,
      hf_repo: repoId, hf_filename: file, discovered_at: new Date().toISOString().slice(0, 10),
    };
    added.push(entry);
    console.log(`+ ${entry.name}  (${sizeGb} GB)  ${repoId}`);
  }

  if (added.length === 0) {
    console.log('\nNothing new to add.');
    return;
  }

  console.log(`\n${added.length} new model(s) found.`);
  if (!WRITE) {
    console.log('Dry run — re-run with --write to append these to api/models-registry.json.');
    return;
  }

  registry.models.push(...added);
  registry.updated_at = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
  console.log(`\nWrote ${added.length} new entries to ${REGISTRY_PATH}.`);
  console.log('Review them, then commit + push — no app update needed, the live registry updates instantly.');
}

main().catch(e => { console.error(e); process.exit(1); });
