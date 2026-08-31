import {
  normaliseScan, classify, tidyName, findApps, describeScan,
  officeApp,
  officeApps,} from './installedApps.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), `got : ${JSON.stringify(g)}\n        want: ${JSON.stringify(w)}`);

// Every shape below was observed in a real 182-shortcut / 160-registry-entry scan of a working
// Windows machine. The real capture is deliberately NOT committed — a list of someone's installed
// software is their business, not the repository's — so this reproduces its shapes instead.
const OFFICE = 'C:\\Program Files\\Microsoft Office\\root\\Office16\\';
const RAW = {
  shortcuts: [
    { name: 'Word',                   target: OFFICE + 'WINWORD.EXE' },
    { name: 'Excel',                  target: OFFICE + 'EXCEL.EXE' },
    { name: 'PowerPoint',             target: OFFICE + 'POWERPNT.EXE' },
    // Two labels, one binary — Office really does ship this.
    { name: 'OneNote',                target: OFFICE + 'ONENOTE.EXE' },
    { name: 'Sticky Notes (new)',     target: OFFICE + 'ONENOTE.EXE' },
    { name: 'Google Chrome',          target: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
    { name: 'Android Studio (64-bit)',target: 'C:\\Program Files\\Android\\Android Studio\\bin\\studio64.exe' },
    { name: 'Wireshark',              target: 'C:\\Program Files\\Wireshark\\Wireshark.exe' },
    { name: 'Uninstall Wireshark',    target: 'C:\\Program Files\\Wireshark\\uninstall.exe' },
    { name: 'Visual Studio Installer',target: 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\setup.exe' },
    { name: 'Command Prompt',         target: 'C:\\WINDOWS\\System32\\cmd.exe' },
    { name: 'Notepad',                target: 'C:\\WINDOWS\\System32\\notepad.exe' },
    { name: 'Some Web Link',          target: '' },
    { name: 'Tally.ERP 9',            target: 'C:\\Tally.ERP9\\tally.exe' },
    // Installer-scattered helper entries, all four seen in a real scan.
    { name: 'About Java',                    target: 'C:\\Program Files\\Java\\jre\\bin\\javacpl.exe' },
    { name: 'Reload Configuration',          target: 'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_ctl.exe' },
    { name: 'Office Language Preferences',   target: OFFICE + 'SETLANG.EXE' },
    { name: 'Application Stack Builder',     target: 'C:\\Program Files\\PostgreSQL\\18\\bin\\stackbuilder.exe' },
    // One SDK tool shipped for four architectures, plus a second copy of the x64 build. A real x64
    // laptop offered exactly this, and it read as five different programs.
    { name: 'WinDbg',         target: 'C:\\Program Files (x86)\\Windows Kits\\10\\Debuggers\\x64\\windbg.exe' },
    { name: 'WinDbg',         target: 'C:\\Program Files (x86)\\Windows Kits\\10\\Debuggers\\x86\\windbg.exe' },
    { name: 'WinDbg (ARM)',   target: 'C:\\Program Files (x86)\\Windows Kits\\10\\Debuggers\\arm\\windbg.exe' },
    { name: 'WinDbg (ARM64)', target: 'C:\\Program Files (x86)\\Windows Kits\\10\\Debuggers\\arm64\\windbg.exe' },
  ],
  registry: [
    { name: 'Google Chrome', version: '151.0.7922.174', publisher: 'Google LLC',
      location: 'C:\\Program Files\\Google\\Chrome\\Application', systemPart: false },
    { name: 'Microsoft Office Home and Student 2021 - en-gb', version: '16.0.1',
      publisher: 'Microsoft Corporation', location: 'C:\\Program Files\\Microsoft Office', systemPart: false },
    { name: 'A Windows Update', version: '1.0', publisher: 'Microsoft',
      location: 'C:\\Program Files\\Wireshark', systemPart: true },
  ],
  automation: {
    'Word.Application':       OFFICE + 'WINWORD.EXE /Automation',
    'Excel.Application':      OFFICE + 'EXCEL.EXE /automation',
    'PowerPoint.Application': OFFICE + 'POWERPNT.EXE /AUTOMATION',
    // Outlook deliberately absent: Home and Student does not ship it, and this is the exact case an
    // installed-apps list alone gets wrong.
  },
};

const scan = normaliseScan(RAW, 1000);
const named = (n) => scan.apps.find((a) => a.name === n);

console.log('\n=== what counts as an application ===');
ok('a real app survives', !!named('Word'));
ok('an uninstaller is dropped by name', !scan.apps.some((a) => /uninstall/i.test(a.name)));
ok('an installer is dropped by its target', !scan.apps.some((a) => /\\setup\.exe$/i.test(a.path)));
ok('a shortcut with no target is dropped', !named('Some Web Link'));
ok('a System32 admin tool is dropped', !named('Command Prompt'));
ok('...but an allowlisted System32 app is kept', !!named('Notepad'));

console.log('\n=== the same binary twice ===');
eq('one entry, not two, for the shared executable',
   scan.apps.filter((a) => /ONENOTE\.EXE$/i.test(a.path)).length, 1);
ok('and it keeps the shorter, plainer name', !!named('OneNote') && !named('Sticky Notes'));

console.log('\n=== helper entries installers leave behind ===');
ok('"About Java" is not an application',        !named('About Java'));
ok('"Reload Configuration" is not one either',  !named('Reload Configuration'));
ok('nor is a language-preferences applet',      !named('Office Language Preferences'));
ok('nor a stack builder',                       !named('Application Stack Builder'));

console.log('\n=== builds this machine cannot run ===');
ok('the ARM build is dropped',   !scan.apps.some((a) => /\(ARM\)/i.test(a.name)));
ok('the ARM64 build is dropped', !scan.apps.some((a) => /ARM64/i.test(a.name)));
eq('one WinDbg remains, not four', scan.apps.filter((a) => /^WinDbg/i.test(a.name)).length, 1);
ok('and it is the x64 one, not a nested variant', /\\x64\\/i.test(named('WinDbg')?.path ?? ''),
   named('WinDbg')?.path);
eq('an SDK tool is development, not "other"', named('WinDbg')?.kind, 'development');

console.log('\n=== names as a person says them ===');
eq('a bitness suffix is stripped', tidyName('Android Studio (64-bit)'), 'Android Studio');
eq('"(new)" is stripped', tidyName('Sticky Notes (new)'), 'Sticky Notes');
eq('an ordinary name is left alone', tidyName('Google Chrome'), 'Google Chrome');
ok('the Start Menu name wins over the registry one',
   !!named('Word') && !scan.apps.some((a) => /Home and Student/i.test(a.name)));

console.log('\n=== classification ===');
eq('Word is office',        classify('Word', OFFICE + 'WINWORD.EXE'), 'office');
eq('Chrome is a browser',   classify('Google Chrome', 'C:\\x\\chrome.exe'), 'browser');
eq('Android Studio is dev', classify('Android Studio', 'C:\\x\\studio64.exe'), 'development');
eq('Tally is office, by name when the exe says nothing',
   classify('Tally.ERP 9', 'C:\\Tally.ERP9\\tally.exe'), 'office');
eq('something unknown is not forced into a box', classify('Legion Arena', 'C:\\x\\Legion Arena.exe'), 'other');

console.log('\n=== registry enrichment ===');
eq('a version is attached via the install folder', named('Google Chrome')?.version, '151.0.7922.174');
eq('and the publisher with it', named('Google Chrome')?.publisher, 'Google LLC');
ok('a system component never enriches anything', !named('Wireshark')?.version,
   JSON.stringify(named('Wireshark')));

console.log('\n=== installed is not the same as drivable ===');
eq('Word can be driven',      scan.automation.word, true);
eq('Excel can be driven',     scan.automation.excel, true);
eq('Outlook CANNOT',          scan.automation.outlook, false);
eq('no LibreOffice here',     scan.automation.libreoffice, false);

console.log('\n=== what the agent is told ===');
{
  const text = describeScan(scan);
  ok('Office is named as drivable', /Can be driven directly.*word.*excel/i.test(text), text);
  ok('Outlook is NOT claimed', !/outlook/i.test(text.split('Can be driven')[1] ?? ''), text);
  ok('apps are grouped by kind', /^office: /m.test(text), text);

  const none = describeScan({ ...scan, automation: { word: false, excel: false, powerpoint: false, outlook: false, libreoffice: false } });
  ok('with no Office at all it says to generate the file instead', /Generate the file instead/i.test(none), none);
  const lo = describeScan({ ...scan, automation: { word: false, excel: false, powerpoint: false, outlook: false, libreoffice: true } });
  ok('with only LibreOffice it says so, and to say which was used', /LibreOffice is — use that/i.test(lo), lo);

  const miss = describeScan(scan, { query: 'photoshop' });
  ok('a missing app is a plain no, not an empty list', /Nothing matching "photoshop"/i.test(miss), miss);
  ok('...and it forbids offering to open it', /do not offer to open it/i.test(miss), miss);
}

console.log('\n=== search ===');
eq('finds by name', findApps(scan, 'excel').map((a) => a.name), ['Excel']);
eq('finds by kind', findApps(scan, 'browser').map((a) => a.name), ['Google Chrome']);
eq('an empty query returns everything', findApps(scan, '').length, scan.apps.length);
eq('all words must match', findApps(scan, 'excel chrome').length, 0);

console.log('\n=== it never explodes on rubbish ===');
eq('an empty scan is empty, not an error', normaliseScan({}, 1).apps.length, 0);
eq('...and reports nothing as drivable', normaliseScan({}, 1).automation.word, false);
ok('junk entries are skipped, not thrown on',
   normaliseScan({ shortcuts: [{}, { name: 'x' }, { target: 'y.exe' }] }, 1).apps.length === 0);
ok('a blank automation value does not count as support',
   normaliseScan({ automation: { 'Word.Application': '   ' } }, 1).automation.word === false);


console.log('\n=== the user own Office, found by its executable ===');
{
  // THE BUG. The rail launched these by command name — winword, excel, powerpnt — and
  // launch_application requires a real path. Every click errored, the caller swallowed it, and
  // clicking Word did nothing whatsoever.
  const scan = { scannedAt: 0, automation: { word: true, excel: true, powerpoint: true, outlook: false, libreoffice: false },
    apps: [
      { name: 'WordPad', path: 'C:\\Program Files\\Windows NT\\Accessories\\wordpad.exe', kind: 'utility' },
      { name: 'Word', path: 'C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE', kind: 'office' },
      { name: 'Excel', path: 'C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE', kind: 'office' },
      { name: 'PowerPoint', path: 'C:\\Program Files\\Microsoft Office\\root\\Office16\\POWERPNT.EXE', kind: 'office' },
    ] };

  ok('Word resolves to a real path', /WINWORD\.EXE$/i.test(officeApp(scan, 'word').path));
  // WordPad contains the word "Word". Launching it instead is worse than launching nothing: the
  // user asked for Word and got a different program.
  ok('...and NOT to WordPad', !/wordpad/i.test(officeApp(scan, 'word').path));
  ok('Excel resolves', /EXCEL\.EXE$/i.test(officeApp(scan, 'excel').path));
  ok('PowerPoint resolves', /POWERPNT\.EXE$/i.test(officeApp(scan, 'powerpoint').path));

  const all = officeApps(scan);
  ok('all three are offered', all.length === 3, String(all.length));
  ok('in a fixed order', all.map((a) => a.which).join() === 'word,excel,powerpoint');
  ok('each carries a real path', all.every((a) => /\.exe$/i.test(a.app.path)));
}

console.log('\n=== and nothing is offered that is not there ===');
{
  const onlyPad = { scannedAt: 0, automation: { word: true, excel: false, powerpoint: false, outlook: false, libreoffice: false },
    apps: [{ name: 'WordPad', path: 'C:\\Windows\\write.exe', kind: 'utility' }] };
  // A rail button that cannot work is worse than no button.
  ok('WordPad alone does not pass as Word', officeApp(onlyPad, 'word') === null);
  ok('...so nothing is offered', officeApps(onlyPad).length === 0);

  ok('an empty scan offers nothing', officeApps({ scannedAt: 0, apps: [], automation: {} }).length === 0);
  ok('no scan at all does not crash', officeApps(null).length === 0);
  ok('a missing app is null, not undefined', officeApp(null, 'excel') === null);

  // A free Viewer is not the real thing and cannot be driven.
  const viewer = { scannedAt: 0, automation: {}, apps: [
    { name: 'Excel Viewer', path: 'C:\\Apps\\xlview.exe', kind: 'office' }] };
  ok('a Viewer is not offered as Excel', officeApp(viewer, 'excel') === null);

  // A renamed shortcut still works, because the executable is what is matched first.
  const renamed = { scannedAt: 0, automation: {}, apps: [
    { name: 'My Documents Thing', path: 'D:\\Office\\WINWORD.EXE', kind: 'office' }] };
  ok('a renamed shortcut is still found by its exe', !!officeApp(renamed, 'word'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
