#!/usr/bin/env node
/**
 * Compiles exo-node.exe and copies it into src-tauri/resources/mesh/
 * so it gets bundled into the NSIS installer automatically.
 *
 * Run via: npm run bundle-exo
 * Called automatically by: npm run tauri:build
 */

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT     = path.resolve(__dirname, '..');
const TAURI    = path.join(ROOT, 'src-tauri');
const SRC      = path.join(TAURI, 'target', 'release', 'exo-node.exe');
const DEST_DIR = path.join(TAURI, 'resources', 'mesh');
const DEST     = path.join(DEST_DIR, 'exo-node.exe');

console.log('▶ Building exo-node.exe…');

try {
  execSync(
    'cargo build --release --bin exo-node',
    { cwd: TAURI, stdio: 'inherit' }
  );
} catch (e) {
  console.error('✗ exo-node build failed:', e.message);
  process.exit(1);
}

if (!fs.existsSync(SRC)) {
  console.error(`✗ Expected binary not found at: ${SRC}`);
  process.exit(1);
}

fs.mkdirSync(DEST_DIR, { recursive: true });
fs.copyFileSync(SRC, DEST);

const sizeKB = Math.round(fs.statSync(DEST).size / 1024);
console.log(`✓ exo-node.exe → resources/mesh/ (${sizeKB} KB)`);
