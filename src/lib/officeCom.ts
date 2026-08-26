// ─── Driving the user's own Microsoft Office ─────────────────────────────────
//
// The app can already GENERATE documents (docgen.ts). This is a different thing, and better where
// it applies: it drives the real Word, Excel and PowerPoint that are already on the machine, so the
// user's own template, fonts, styles and branding come out right — because it genuinely is Word.
// The output is a real .docx, not an approximation of one.
//
// ── HOW THE SCRIPT IS BUILT, and why it is not built from the content ────────
//
// The content comes from a language model and ends up inside a PowerShell script. Interpolating it
// directly would mean escaping every value correctly every time, forever, and one missed quote
// turns a document into arbitrary code execution on the user's computer.
//
// So the script is CONSTANT. Per document kind there is one fixed script that never varies, and the
// content travels beside it as JSON inside a single-quoted here-string, which PowerShell parses
// with ConvertFrom-Json. A single-quoted here-string interpolates nothing — no $variables, no
// subexpressions, no backtick escapes — and can only be terminated by '@ at the START of a line.
// JSON.stringify never emits a raw newline, so the payload is always one line and that can never
// happen. assertSafePayload() enforces the invariant rather than trusting it.
//
// ── STYLES ARE REFERRED TO BY NUMBER, NOT BY NAME ───────────────────────────
//
// $doc.Styles.Item("Heading 1") works on an English install and throws on a German or French one,
// where the style is called "Überschrift 1" or "Titre 1". The built-in style ENUM is the same
// everywhere, so headings are wdStyleHeading1 (-2) and so on. This is the kind of bug that would
// only ever appear on someone else's machine.
//
// ── CLEANING UP ──────────────────────────────────────────────────────────────
//
// Office COM is notorious for leaving an invisible WINWORD.EXE running after Quit(). Left alone
// those accumulate silently until the machine is out of memory. The scripts below record which
// process IDs existed BEFORE starting, and at the end terminate only IDs that were not there
// before and are still alive.
//
// That "only ours, by PID" rule is not fussiness. Killing by name — taskkill /IM WINWORD.EXE —
// would close the document the user has open, unsaved, in front of them.

import type { AutomationSupport } from './installedApps';

export type DocKind = 'word' | 'excel' | 'powerpoint';
export type Engine = 'office' | 'builtin';

export interface WordBlock {
  style: 'title' | 'heading' | 'subheading' | 'body' | 'bullet';
  text: string;
}

export interface DocSpec {
  kind: DocKind;
  /** Where to write it. Must end in .docx / .xlsx / .pptx. */
  savePath: string;
  /** The user's own template (.dotx, .xltx, .potx) — the entire point of this path. */
  template?: string;
  /** Word */
  blocks?: WordBlock[];
  /** Excel — first row is treated as the header. */
  rows?: string[][];
  sheetName?: string;
  /** PowerPoint */
  slides?: { title: string; bullets: string[] }[];
  /**
   * Do the work where the user can SEE it — Word opens, text appears, the file is saved, and the
   * document stays on screen in front of them.
   *
   * Defaults to true, and that default is the point. Watching a document being written is the
   * difference between "the computer produced a file somewhere" and "I saw it happen" — which for
   * someone who has never trusted software to do their work is the whole difference.
   *
   * It also changes the cleanup rules completely; see the note on the scripts below.
   */
  visible?: boolean;
  /** Milliseconds between blocks when visible, so it reads as typing rather than a paste. */
  typeDelayMs?: number;
}

export interface DocResult {
  ok: boolean;
  path?: string;
  bytes?: number;
  error?: string;
}

// ── Choosing an engine, and saying so ────────────────────────────────────────

/**
 * Which engine can actually produce this.
 *
 * Deliberately not clever: real Office if its COM server is registered, otherwise the built-in
 * generator. There is no "probably fine" branch — see engineNote for why that matters.
 */
export function chooseEngine(automation: AutomationSupport | null | undefined, kind: DocKind): Engine {
  if (!automation) return 'builtin';
  const registered = kind === 'word' ? automation.word
    : kind === 'excel' ? automation.excel
      : automation.powerpoint;
  return registered ? 'office' : 'builtin';
}

/**
 * The sentence the user is owed about how their file was made.
 *
 * "Never imply Office when it wasn't" is the rule this exists to enforce. A document made by the
 * built-in generator will not carry the user's template, and someone who believes it did will send
 * an unbranded proposal to a client. The difference has to be stated, not left to be discovered.
 */
export function engineNote(engine: Engine, kind: DocKind, usedTemplate: boolean): string {
  const app = kind === 'word' ? 'Microsoft Word' : kind === 'excel' ? 'Microsoft Excel' : 'Microsoft PowerPoint';
  if (engine === 'office') {
    return usedTemplate
      ? `Made in ${app} on this computer, using your own template — your styles, fonts and branding are intact.`
      : `Made in ${app} on this computer, from its default blank document.`;
  }
  return `${app} is not available for automation on this computer, so this was generated directly rather than made in ${app}. `
    + `That means it does NOT carry your template, fonts or branding — say so if it matters.`;
}

// ── The payload ──────────────────────────────────────────────────────────────

/**
 * Guard the one property the here-string relies on.
 *
 * Everything above is safe *because* the payload is a single line. Rather than trusting
 * JSON.stringify to keep being true to that, this checks — cheaply, on every call.
 */
export function assertSafePayload(json: string): void {
  // The real invariant, and the only one: ONE LINE. A single-quoted here-string is closed only by
  // '@ at the start of a line, so with no newline in the payload there is no line for it to start.
  if (/[\r\n]/.test(json)) throw new Error('payload must be a single line');
  // Belt and braces for the one position that would matter if it somehow were at a line start.
  if (json.startsWith("'@")) throw new Error('payload must not begin with a here-string terminator');
  // NOT checked: whether "'@" appears anywhere inside. An earlier version rejected that, which was
  // both unnecessary — it cannot terminate anything mid-line — and wrong, because it would have
  // refused to write a perfectly ordinary document that happened to contain those two characters.
}

export function buildPayload(spec: DocSpec): string {
  const json = JSON.stringify({
    savePath: spec.savePath,
    template: spec.template ?? '',
    blocks: spec.blocks ?? [],
    rows: spec.rows ?? [],
    sheetName: spec.sheetName ?? '',
    slides: spec.slides ?? [],
    // Visible unless explicitly turned off — a document the user watched being written is worth
    // more than one that appeared.
    visible: spec.visible !== false,
    typeDelayMs: Math.max(0, Math.min(400, spec.typeDelayMs ?? 90)),
  });
  assertSafePayload(json);
  return json;
}

/** Extensions the caller must have got right, since Office decides format from the save constant. */
export const EXPECTED_EXT: Record<DocKind, string> = {
  word: '.docx', excel: '.xlsx', powerpoint: '.pptx',
};

export function checkSpec(spec: DocSpec): string | null {
  const path = String(spec.savePath || '').trim();
  if (!path) return 'No save path was given.';
  if (!/^[a-zA-Z]:\\/.test(path) && !path.startsWith('\\\\')) {
    return `"${path}" is not an absolute Windows path. Give a full path such as C:\\Users\\you\\Documents\\proposal.docx.`;
  }
  const want = EXPECTED_EXT[spec.kind];
  if (!path.toLowerCase().endsWith(want)) return `A ${spec.kind} file must be saved as ${want} — got "${path}".`;
  if (spec.kind === 'word' && !(spec.blocks ?? []).length) return 'No content was given for the document.';
  if (spec.kind === 'excel' && !(spec.rows ?? []).length) return 'No rows were given for the spreadsheet.';
  if (spec.kind === 'powerpoint' && !(spec.slides ?? []).length) return 'No slides were given for the presentation.';
  return null;
}

// ── The fixed scripts ────────────────────────────────────────────────────────
//
// Shared preamble and postamble. `$payload` is the only thing that changes between calls, and it is
// data, never code.

const PREAMBLE = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$spec = $payload | ConvertFrom-Json
$visible = [bool]$spec.visible
$pause = [int]$spec.typeDelayMs
# Whose processes were already running. Anything in here is the user's and is never touched.
$theirs = @(Get-Process -Name $procName -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$result = @{ ok = $false }
`;

// THE CLEANUP RULE, AND WHY IT IS CONDITIONAL.
//
// Headless: quit, then terminate only processes that (a) did not exist before this script started
// and (b) are still alive afterwards. Office is notorious for leaving an invisible WINWORD.EXE
// behind, and unchecked those accumulate until the machine is out of memory.
//
// VISIBLE: do none of that. The user is looking at the document. Quitting would close it in front
// of them, and the process-sweep would then kill the very window they were asked to look at — the
// feature would delete its own output. So a visible run leaves everything open, on purpose, and
// hands the document over.
//
// Either way, nothing is ever stopped by name: taskkill /IM WINWORD.EXE would close the file the
// user has open and unsaved in another window.
const POSTAMBLE = String.raw`
if (-not $visible) {
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
  Start-Sleep -Milliseconds 400
  foreach ($p in (Get-Process -Name $procName -ErrorAction SilentlyContinue)) {
    if ($theirs -notcontains $p.Id) { try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { } }
  }
}
$result | ConvertTo-Json -Compress
`;

const WORD_BODY = String.raw`
$procName = 'WINWORD'
` + PREAMBLE + String.raw`
try {
  $app = New-Object -ComObject Word.Application
  $app.Visible = $visible
  $app.DisplayAlerts = 0
  # Bring it to the front so the user is actually looking at the thing being written, rather than
  # at a taskbar button they have to notice.
  if ($visible) { try { $app.Activate() } catch { } }
  # The user's own template, if they named one. Documents.Add(template) is what makes the output
  # genuinely theirs rather than merely a .docx.
  $doc = if ($spec.template -and (Test-Path $spec.template)) { $app.Documents.Add($spec.template) } else { $app.Documents.Add() }
  # Built-in style IDs, not names: names are translated on a localised Office and would throw.
  $STYLE = @{ title = -63; heading = -2; subheading = -3; body = -1; bullet = -180 }

  # TYPED THROUGH THE SELECTION, and not built out of Paragraphs.Add(). Two other approaches were
  # tried against real Word and both were wrong in ways that only reading the saved file revealed:
  #
  #   $para.Range.Text = ...   replaces the paragraph MARK along with the text, so each block
  #                            swallowed the one before it. Five blocks produced one paragraph.
  #   $para.Range.InsertAfter  kept all five, but applied every style to the wrong paragraph — the
  #                            title came back as Heading 1 and the last bullet as Normal.
  #
  # Setting the style first and then typing is what Word itself does when a person types, and it is
  # the only one of the three that produced the right styles on the right paragraphs.
  $sel = $app.Selection
  $sel.EndKey(6) | Out-Null   # wdStory — start at the end of whatever the template already has
  foreach ($b in $spec.blocks) {
    $id = $STYLE[[string]$b.style]
    if ($null -eq $id) { $id = -1 }
    $sel.Style = $id
    $sel.TypeText([string]$b.text)
    $sel.TypeParagraph()
    # A beat between blocks so a visible run READS as writing rather than as a paste appearing all
    # at once. Zero when headless, so nothing is slowed down for a file nobody is watching.
    if ($visible -and $pause -gt 0) {
      try { $app.ScreenRefresh() } catch { }
      Start-Sleep -Milliseconds $pause
    }
  }

  # Bullet glyphs in a second pass. The List Paragraph style supplies the indent but not the bullet
  # itself, and applying it during the loop leaks the list on to the paragraph typed next.
  $n = 0
  foreach ($b in $spec.blocks) {
    $n++
    if ([string]$b.style -eq 'bullet' -and $n -le $doc.Paragraphs.Count) {
      $doc.Paragraphs.Item($n).Range.ListFormat.ApplyBulletDefault()
    }
  }
  $doc.SaveAs2($spec.savePath, 16)
  # Visible: hand the open document to the user and step back. Closing it would be the feature
  # deleting its own output in front of them.
  if (-not $visible) {
    $doc.Close($false)
    $app.Quit()
    [Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null
  }
  $result = @{ ok = $true; path = $spec.savePath; bytes = (Get-Item $spec.savePath).Length; visible = $visible }
} catch {
  $result = @{ ok = $false; error = $_.Exception.Message }
  # Only tidy up after a FAILED visible run — there is no document worth leaving on screen, and a
  # half-written window with an error nobody can see is worse than nothing.
  try { if (-not $visible) { $app.Quit() } } catch { }
}
` + POSTAMBLE;

const EXCEL_BODY = String.raw`
$procName = 'EXCEL'
` + PREAMBLE + String.raw`
try {
  $app = New-Object -ComObject Excel.Application
  $app.Visible = $visible
  $app.DisplayAlerts = $false
  if ($visible) { try { $app.Activate() } catch { } }
  $wb = if ($spec.template -and (Test-Path $spec.template)) { $app.Workbooks.Add($spec.template) } else { $app.Workbooks.Add() }
  $ws = $wb.Worksheets.Item(1)
  if ($spec.sheetName) { $ws.Name = [string]$spec.sheetName }
  $r = 1
  foreach ($row in $spec.rows) {
    $c = 1
    foreach ($cell in $row) {
      # Written as text so an order reference like 00123 or 1-2 is not silently turned into a
      # number or a date. A spreadsheet that quietly rewrites the user's data is worse than none.
      $ws.Cells.Item($r, $c).NumberFormat = '@'
      $ws.Cells.Item($r, $c).Value2 = [string]$cell
      $c++
    }
    # Row by row when visible, so the sheet fills in front of the user instead of appearing.
    if ($visible -and $pause -gt 0) { Start-Sleep -Milliseconds ([Math]::Min($pause, 60)) }
    $r++
  }
  if ($spec.rows.Count -gt 0) {
    # A header that looks like a header. Bold alone reads as a slightly odd first row; the fill,
    # the white text and the frozen pane are what make it a table someone can actually work in.
    $hdr = $ws.Range($ws.Cells.Item(1, 1), $ws.Cells.Item(1, $spec.rows[0].Count))
    $hdr.Font.Bold = $true
    $hdr.Font.Color = 16777215                     # white
    $hdr.Interior.Color = 6963003                  # the adris accent, as BGR
    $hdr.HorizontalAlignment = -4131               # xlLeft
    $ws.Rows.Item(1).RowHeight = 20
    # Freeze the header and turn on filters: on a 200-row lead list these are the difference
    # between a dump and something usable.
    try {
      $ws.Activate()
      $app.ActiveWindow.FreezePanes = $false
      $ws.Range('A2').Select() | Out-Null
      $app.ActiveWindow.FreezePanes = $true
      $hdr.AutoFilter() | Out-Null
    } catch { }
    $ws.Columns.AutoFit() | Out-Null
  }
  $wb.SaveAs($spec.savePath, 51)
  if (-not $visible) {
    $wb.Close($false)
    $app.Quit()
    [Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null
  }
  $result = @{ ok = $true; path = $spec.savePath; bytes = (Get-Item $spec.savePath).Length; visible = $visible }
} catch {
  $result = @{ ok = $false; error = $_.Exception.Message }
  try { if (-not $visible) { $app.Quit() } } catch { }
}
` + POSTAMBLE;

const PPT_BODY = String.raw`
$procName = 'POWERPNT'
` + PREAMBLE + String.raw`
try {
  $app = New-Object -ComObject PowerPoint.Application
  # PowerPoint is unusual: its window is not reliably hideable, and Presentations.Add takes the
  # visibility as its argument rather than it being a property set afterwards. msoTrue = -1.
  $pres = $app.Presentations.Add($(if ($visible) { -1 } else { 0 }))
  if ($visible) { try { $app.Activate() } catch { } }
  if ($spec.template -and (Test-Path $spec.template)) { $pres.ApplyTemplate($spec.template) }
  # 16:9. The default on many installs is still 4:3, which looks a decade old on any modern screen
  # or projector. ppSlideSizeOnScreen16x9 = 15.
  try { $pres.PageSetup.SlideSize = 15 } catch { }
  $i = 1
  foreach ($s in $spec.slides) {
    $slide = $pres.Slides.Add($i, 2)   # ppLayoutText: a title and a body placeholder
    # Show each slide as it is built, so the deck assembles in front of the user.
    if ($visible) { try { $slide.Select(); $app.ActiveWindow.View.GotoSlide($i) } catch { } }
    $slide.Shapes.Item(1).TextFrame.TextRange.Text = [string]$s.title
    if ($s.bullets -and $s.bullets.Count -gt 0) {
      # PowerPoint separates paragraphs with CR, not CRLF: a newline here produces empty bullets.
      # Written as [char]13 rather than PowerShell's backtick-r, because a backtick would terminate
      # the JavaScript template literal this script lives inside.
      $slide.Shapes.Item(2).TextFrame.TextRange.Text = ($s.bullets -join [string][char]13)
    }
    if ($visible -and $pause -gt 0) { Start-Sleep -Milliseconds $pause }
    $i++
  }
  $pres.SaveAs($spec.savePath, 24)
  if (-not $visible) {
    $pres.Close()
    $app.Quit()
    [Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null
  }
  $result = @{ ok = $true; path = $spec.savePath; bytes = (Get-Item $spec.savePath).Length; visible = $visible }
} catch {
  $result = @{ ok = $false; error = $_.Exception.Message }
  try { if (-not $visible) { $app.Quit() } } catch { }
}
` + POSTAMBLE;

const BODIES: Record<DocKind, string> = { word: WORD_BODY, excel: EXCEL_BODY, powerpoint: PPT_BODY };

/** The complete script: the payload as data, then the fixed body. */
export function buildScript(spec: DocSpec): string {
  const payload = buildPayload(spec);
  return `$payload = @'\n${payload}\n'@\n${BODIES[spec.kind]}`;
}

// ── Running it ───────────────────────────────────────────────────────────────

export async function createDocument(spec: DocSpec): Promise<DocResult> {
  const bad = checkSpec(spec);
  if (bad) return { ok: false, error: bad };
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const raw = await invoke<string>('office_automation', { script: buildScript(spec) });
    const parsed = JSON.parse(raw) as DocResult;
    // A script that returned something unparseable has not proved anything, and a document nobody
    // has confirmed exists must never be reported as written.
    if (!parsed || typeof parsed.ok !== 'boolean') return { ok: false, error: 'the automation returned nothing usable' };
    return parsed;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
