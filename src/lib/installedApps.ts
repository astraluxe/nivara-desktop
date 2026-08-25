// ─── What is actually on this computer ───────────────────────────────────────
//
// Everything the agents are meant to do next — drive Word with the user's own template, open their
// accounting package, show a cursor moving through their design tool — starts with knowing what
// exists. Guessing is not an option: an agent that says "opening Excel" on a machine with no Excel
// has done the one thing this product cannot afford to do.
//
// WHERE THE DATA COMES FROM, and why it is not the registry.
//
// The obvious source is the uninstall registry, and it is the wrong one. Measured on a real machine:
//
//     registry Uninstall keys   182 entries → 160 named → 51 after filtering out system parts
//     Start Menu shortcuts      182 files   →  99 with a real .exe target
//
// and more importantly the registry's names are not the names people use. It calls Word
// "Microsoft Office Home and Student 2021 - en-gb" — twice, once per language pack — while the
// Start Menu calls it "Word". The Start Menu is, by definition, the list of things a person can
// click, labelled the way they would say it out loud. So shortcuts are the source, and the registry
// is demoted to what it is genuinely good at: version and publisher.
//
// A THIRD QUESTION, which is the one that actually matters for driving Office: "is Word installed"
// and "can Word be automated" are not the same fact. The answer lives in HKEY_CLASSES_ROOT — a
// registered COM server has a LocalServer32 path and an unregistered one has nothing. On the
// machine this was built against, Word/Excel/PowerPoint answer and Outlook does not, because Home
// and Student does not ship Outlook. An installed-apps list alone would have got that wrong.
//
// The Windows-specific collection lives in the PowerShell below, because it cannot be tested off
// Windows. Everything after it — filtering, dedupe, classification — is pure and lives here, where
// node can test it against real captured output.

export type AppKind =
  | 'office' | 'browser' | 'communication' | 'design'
  | 'development' | 'media' | 'utility' | 'other';

export interface InstalledApp {
  name: string;
  path: string;
  kind: AppKind;
  publisher?: string;
  version?: string;
}

export interface AutomationSupport {
  word: boolean;
  excel: boolean;
  powerpoint: boolean;
  outlook: boolean;
  libreoffice: boolean;
}

export interface AppScan {
  apps: InstalledApp[];
  automation: AutomationSupport;
  scannedAt: number;
}

export interface RawScan {
  shortcuts?: { name?: string; target?: string }[];
  registry?: { name?: string; version?: string; publisher?: string; location?: string; systemPart?: boolean }[];
  automation?: Record<string, string>;
}

// ── What is not an application ───────────────────────────────────────────────
// Every installer drops these next to the real thing, and a list where "Uninstall Wireshark" sits
// beside "Wireshark" is a list an agent can pick the wrong entry out of.
const JUNK_NAME = /(^|\b)(uninstall|uninstaller|remove|setup|repair|modify|readme|read me|release notes?|documentation|help|manual|user guide|licen[cs]e|changelog|website|home ?page|visit |report a |check for updates?|feedback)(\b|$)/i;
const JUNK_TARGET = /\\(unins[^\\]*|setup|install|uninstall|uninst|vc_redist|dotnetfx|updater|helper|crashpad_handler|repair)[^\\]*\.exe$/i;

// Start Menu entries pointing into System32 are real, but they are Windows' own administration
// tools rather than the business software this list exists to describe. A short allowlist keeps the
// few a person would actually name.
// Helper entries that installers scatter through the Start Menu. They are not applications and a
// person would never name them: "About Java", "Reload Configuration", "Office Language Preferences",
// "Application Stack Builder" — all four came out of a real scan.
const JUNK_HELPER = /^(about|reload|configure|configuration|manage|launch|register|activate)\b|\b(language preferences|stack builder|command prompt)\b/i;

// Builds for a processor this machine does not have. A real scan of an x64 laptop offered
// "WinDbg (ARM)", "WinDbg (ARM64)", "Global Flags (ARM)" and "Global Flags (ARM64)" — four entries
// that cannot run here. Offering software that cannot execute is the same failure as offering
// software that is not installed.
const OTHER_ARCH = /\((arm|arm-?64)\)\s*$/i;

const SYSTEM_DIR = /\\Windows\\(System32|SysWOW64|SysNative)\\/i;
const SYSTEM_KEEP = /\\(notepad|mspaint|calc|write|wordpad|snippingtool|charmap|magnify)\.exe$/i;

/** Classify by the executable first — a file name is far more stable than a display name. */
const BY_EXE: [RegExp, AppKind][] = [
  [/\\(winword|excel|powerpnt|onenote|outlook|msaccess|mspub|soffice|swriter|scalc|simpress|wps|wpp)\.exe$/i, 'office'],
  [/\\(chrome|msedge|firefox|brave|opera|vivaldi|iexplore|arc)\.exe$/i, 'browser'],
  [/\\(teams|ms-teams|slack|discord|zoom|skype|whatsapp|telegram|thunderbird|signal)\.exe$/i, 'communication'],
  [/\\(photoshop|illustrator|indesign|figma|canva|gimp|inkscape|blender|coreldrw|afphoto|afdesign|krita)\.exe$/i, 'design'],
  // SDK debugging and profiling tools. Real developer software, so classified honestly rather than
  // deleted — but they belong under development, not in the "other" bucket where they drown the
  // things a person would actually name.
  [/\\Windows Kits\\/i, 'development'],
  [/\\(code|devenv|studio64|idea64|pycharm64|webstorm64|clion64|sublime_text|wireshark|matlab|uv4|packettracer|eclipse|arduino|postman)\.exe$/i, 'development'],
  [/\\(vlc|wmplayer|spotify|itunes|potplayermini|mpc-hc|audacity|obs64)\.exe$/i, 'media'],
  [/\\(notepad|mspaint|calc|write|wordpad|snippingtool|charmap|magnify|regedit|cmd|powershell)\.exe$/i, 'utility'],
];

const BY_NAME: [RegExp, AppKind][] = [
  [/\b(word|excel|powerpoint|onenote|outlook|access|publisher|libreoffice|openoffice|tally|zoho|quickbooks|busy)\b/i, 'office'],
  [/\b(chrome|edge|firefox|brave|opera|safari|browser)\b/i, 'browser'],
  [/\b(teams|slack|discord|zoom|skype|whatsapp|telegram|meet)\b/i, 'communication'],
  [/\b(photoshop|illustrator|figma|canva|gimp|inkscape|blender|corel|affinity)\b/i, 'design'],
  [/\b(visual studio|vs code|android studio|intellij|pycharm|git|docker|matlab|xampp|wireshark)\b/i, 'development'],
  [/\b(vlc|spotify|itunes|media player|audacity|obs)\b/i, 'media'],
];

export function classify(name: string, path: string): AppKind {
  for (const [re, kind] of BY_EXE) if (re.test(path)) return kind;
  for (const [re, kind] of BY_NAME) if (re.test(name)) return kind;
  return 'other';
}

/** Strip a shortcut label down to what a person would call it. */
export function tidyName(raw: string): string {
  return String(raw || '')
    .replace(/\s*\((x?64|x86|32[- ]bit|64[- ]bit|desktop|new)\)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Fold the raw sources into one list.
 *
 * Deduplicated by executable, keeping the SHORTEST name for each. Two shortcuts pointing at the
 * same binary is normal — Office alone ships several — and the shortest label is reliably the
 * plainest one ("Word", not "Word (Desktop)").
 */
export function normaliseScan(raw: RawScan, now = Date.now()): AppScan {
  const byPath = new Map<string, InstalledApp>();

  for (const s of raw.shortcuts ?? []) {
    const target = String(s.target || '').trim();
    const name = tidyName(String(s.name || ''));
    if (!name || !/\.exe$/i.test(target)) continue;
    if (JUNK_NAME.test(name) || JUNK_HELPER.test(name) || JUNK_TARGET.test(target)) continue;
    if (OTHER_ARCH.test(String(s.name || ''))) continue;
    if (SYSTEM_DIR.test(target) && !SYSTEM_KEEP.test(target)) continue;

    const key = target.toLowerCase();
    const existing = byPath.get(key);
    if (existing && existing.name.length <= name.length) continue;
    byPath.set(key, { name, path: target, kind: classify(name, target) });
  }

  // Enrich from the registry, matched on the INSTALL FOLDER rather than on the name — the two
  // sources name the same product differently, which is the whole reason the Start Menu is primary.
  for (const r of raw.registry ?? []) {
    if (r.systemPart) continue;
    const loc = String(r.location || '').trim().toLowerCase().replace(/\\+$/, '');
    if (!loc) continue;
    for (const [key, app] of byPath) {
      if (!key.startsWith(loc + '\\')) continue;
      if (!app.version && r.version) app.version = String(r.version);
      if (!app.publisher && r.publisher) app.publisher = String(r.publisher);
    }
  }

  // SECOND PASS: the same name at two different paths. An SDK ships "WinDbg" as both x64 and x86
  // and the Start Menu lists both, which reads as two different programs. One name, one entry —
  // keeping the shortest path, which is reliably the primary install rather than a nested variant.
  const byName = new Map<string, InstalledApp>();
  for (const app of byPath.values()) {
    const key = app.name.toLowerCase();
    const existing = byName.get(key);
    if (existing && existing.path.length <= app.path.length) continue;
    byName.set(key, app);
  }
  for (const [key, app] of byPath) if (byName.get(app.name.toLowerCase()) !== app) byPath.delete(key);

  const apps = [...byPath.values()].sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind.localeCompare(b.kind));

  const auto = raw.automation ?? {};
  const has = (k: string) => typeof auto[k] === 'string' && auto[k].trim().length > 0;
  return {
    apps,
    automation: {
      word:        has('Word.Application'),
      excel:       has('Excel.Application'),
      powerpoint:  has('PowerPoint.Application'),
      outlook:     has('Outlook.Application'),
      libreoffice: has('com.sun.star.ServiceManager'),
    },
    scannedAt: now,
  };
}

/** Search the scan the way a person would ask for it. */
export function findApps(scan: AppScan, query: string): InstalledApp[] {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return scan.apps;
  const words = q.split(/\s+/).filter(Boolean);
  return scan.apps.filter((a) => {
    const hay = `${a.name} ${a.path} ${a.publisher ?? ''} ${a.kind}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/**
 * The scan as a few lines of text, which is what an agent reads.
 *
 * Grouped by kind and capped, because handing a model a hundred rows to answer "do they have Excel"
 * spends context on ninety-nine answers nobody asked for.
 */
export function describeScan(scan: AppScan, opts: { query?: string; limit?: number } = {}): string {
  const limit = opts.limit ?? 60;
  const list = opts.query ? findApps(scan, opts.query) : scan.apps;
  if (!list.length) {
    return opts.query
      ? `Nothing matching "${opts.query}" is installed on this computer. Say so plainly — do not offer to open it.`
      : 'No installed applications could be read from this computer.';
  }

  const groups = new Map<AppKind, InstalledApp[]>();
  for (const a of list.slice(0, limit)) {
    const g = groups.get(a.kind);
    if (g) g.push(a); else groups.set(a.kind, [a]);
  }

  const lines: string[] = [];
  for (const [kind, items] of groups) {
    lines.push(`${kind}: ${items.map((a) => (a.version ? `${a.name} ${a.version}` : a.name)).join(', ')}`);
  }
  if (list.length > limit) lines.push(`…and ${list.length - limit} more (narrow the query to see them).`);

  const a = scan.automation;
  const drivable = (['word', 'excel', 'powerpoint', 'outlook'] as const).filter((k) => a[k]);
  lines.push('');
  lines.push(drivable.length
    ? `Can be driven directly (real Microsoft Office automation): ${drivable.join(', ')}.`
    : a.libreoffice
      ? 'Microsoft Office is NOT available for automation, but LibreOffice is — use that, and say which was used.'
      : 'Neither Microsoft Office nor LibreOffice can be driven on this machine. Generate the file instead, and say how it was made.');
  return lines.join('\n');
}

// ── The Windows half ─────────────────────────────────────────────────────────
// Handed to PowerShell as ONE argument by the Rust side, which passes it to CreateProcess directly.
// That is deliberate: routing it through cmd.exe would mean quoting it, and cmd's 8191-character
// command line is shorter than this script.
export const SCAN_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$roots = @("$env:ProgramData\Microsoft\Windows\Start Menu\Programs",
           "$env:APPDATA\Microsoft\Windows\Start Menu\Programs")
$sh = New-Object -ComObject WScript.Shell
$shortcuts = @()
foreach ($r in $roots) {
  if (-not (Test-Path $r)) { continue }
  foreach ($l in (Get-ChildItem $r -Recurse -Filter *.lnk)) {
    $t = ''
    try { $t = $sh.CreateShortcut($l.FullName).TargetPath } catch { }
    $shortcuts += [pscustomobject]@{ name = $l.BaseName; target = $t }
  }
}
$keys = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
          'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
          'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*')
$registry = @()
foreach ($k in $keys) {
  foreach ($e in (Get-ItemProperty $k)) {
    if (-not $e.DisplayName) { continue }
    $registry += [pscustomobject]@{
      name = $e.DisplayName; version = [string]$e.DisplayVersion
      publisher = [string]$e.Publisher; location = [string]$e.InstallLocation
      systemPart = [bool]($e.SystemComponent -eq 1 -or $e.ParentKeyName)
    }
  }
}
$automation = @{}
foreach ($p in 'Word.Application','Excel.Application','PowerPoint.Application','Outlook.Application','com.sun.star.ServiceManager') {
  $clsid = (Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\$p\CLSID").'(default)'
  if ($clsid) {
    $srv = (Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\CLSID\$clsid\LocalServer32").'(default)'
    if ($srv) { $automation[$p] = [string]$srv }
  }
}
@{ shortcuts = $shortcuts; registry = $registry; automation = $automation } | ConvertTo-Json -Depth 4 -Compress
`;

// ── Cache ────────────────────────────────────────────────────────────────────
// The scan walks a few hundred files and spawns PowerShell, so it is not something to do on every
// question. A day is the right staleness: software gets installed occasionally, not hourly.
const CACHE_KEY = 'nv-installed-apps';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function loadCachedScan(): AppScan | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppScan;
    if (!parsed || !Array.isArray(parsed.apps) || !parsed.automation) return null;
    if (Date.now() - (parsed.scannedAt || 0) > MAX_AGE_MS) return null;
    return parsed;
  } catch { return null; }
}

export function saveCachedScan(scan: AppScan): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(scan)); } catch { /* quota, private mode */ }
}

/**
 * Scan, or return what was scanned recently.
 *
 * Never throws: a machine that cannot be scanned should degrade to "I do not know what you have
 * installed", which an agent can say honestly, rather than to an error the chat has to render.
 */
export async function getInstalledApps(opts: { force?: boolean } = {}): Promise<AppScan | null> {
  if (!opts.force) {
    const cached = loadCachedScan();
    if (cached) return cached;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const raw = await invoke<string>('scan_installed_apps', { script: SCAN_SCRIPT });
    const scan = normaliseScan(JSON.parse(raw) as RawScan);
    if (!scan.apps.length) return loadCachedScan();
    saveCachedScan(scan);
    return scan;
  } catch {
    return loadCachedScan();
  }
}
