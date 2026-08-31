// ─── "What did the agent change to my project?" ──────────────────────────────
//
// The only reason Coder exists, and until 1.69.0 it was unanswerable inside the app. The fixtures
// below are the real shapes this repo produces.

import {
  normPath, changeKind, statusMap, folderHasChanges, changeCount, parseDiff, diffTotals,
  KIND_LETTER,
} from './gitStatus.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

console.log('\n=== THE FAILURE THAT LOOKS LIKE SUCCESS: path shapes ===');
{
  // Git says absolute forward-slash. list_dir says absolute Windows backslash. Windows does not
  // care about case. Compare those raw and the tree lights up NOTHING while every file is really
  // modified — and "no changes" is the most misleading possible output for a changes feature.
  const fromGit = 'C:/Users/amogh/Desktop/NIVARA/src/lib/x.ts';
  const fromTree = 'C:\\Users\\amogh\\Desktop\\NIVARA\\src\\lib\\x.ts';
  ok('backslashes and forward slashes match', normPath(fromGit) === normPath(fromTree));
  ok('drive letter case does not matter', normPath('C:/a/b') === normPath('c:/a/b'));
  ok('a trailing slash does not matter', normPath('C:/a/b/') === normPath('C:/a/b'));
  ok('different files still differ', normPath('C:/a/b') !== normPath('C:/a/c'));
}

console.log('\n=== porcelain codes → what happened ===');
{
  const k = (index, worktree) => changeKind({ index, worktree });
  // ' M' is the overwhelmingly common one — edited, not staged. Every file in this repo right now.
  ok('edited but not staged is modified', k(' ', 'M') === 'modified');
  ok('staged edit is also modified', k('M', ' ') === 'modified');
  ok('staged AND edited is still modified', k('M', 'M') === 'modified');
  ok('untracked is new', k('?', '?') === 'new');
  ok('staged add is new', k('A', ' ') === 'new');
  ok('deleted in the worktree', k(' ', 'D') === 'deleted');
  ok('renamed', k('R', ' ') === 'renamed');
  ok('copied reads as renamed — same thing to a person', k('C', ' ') === 'renamed');
  ok('nothing is none', k(' ', ' ') === 'none');

  // Conflict is checked FIRST because it is the only state that stops everything until a human
  // decides, and both its columns also look like ordinary changes.
  ok('unmerged is a conflict', k('U', 'U') === 'conflict');
  ok('both added is a conflict', k('A', 'A') === 'conflict');
  ok('both deleted is a conflict', k('D', 'D') === 'conflict');
  ok('a conflict is never reported as a plain edit', k('U', 'U') !== 'modified');

  ok('the letters are the ones developers already read',
    KIND_LETTER.new === 'A' && KIND_LETTER.modified === 'M' && KIND_LETTER.deleted === 'D');
}

console.log('\n=== the map the tree looks things up in ===');
{
  const status = {
    ok: true, root: 'C:/repo', branch: 'master',
    files: [
      { path: 'C:/repo/src/a.ts', rel: 'src/a.ts', index: ' ', worktree: 'M' },
      { path: 'C:/repo/src/deep/b.ts', rel: 'src/deep/b.ts', index: '?', worktree: '?' },
      { path: 'C:/repo/README.md', rel: 'README.md', index: ' ', worktree: ' ' },
    ],
  };
  const m = statusMap(status);
  ok('changed files are in the map', m.get(normPath('C:/repo/src/a.ts')) === 'modified');
  ok('a tree path with backslashes finds its entry',
    m.get(normPath('C:\\repo\\src\\a.ts')) === 'modified');
  ok('unchanged files are left out, not stored as "none"', m.size === 2);

  // Without this, a change three folders down is invisible until you happen to expand the right
  // ones — which for files an agent chose is most of the time.
  ok('a folder shows a mark when something inside it changed',
    folderHasChanges('C:/repo/src', m));
  ok('...however deep it is', folderHasChanges('C:/repo/src/deep', m));
  ok('a folder with nothing changed stays quiet', !folderHasChanges('C:/repo/docs', m));
  // 'C:/repo/s' must not match 'C:/repo/src' by raw prefix.
  ok('a folder is not confused with one whose name it prefixes',
    !folderHasChanges('C:/repo/s', m));

  ok('the count is what the header shows', changeCount(status) === 2);
  ok('not a repo counts as nothing rather than throwing',
    changeCount({ ok: false, reason: 'not_a_repo' }) === 0);
  ok('null is safe too', changeCount(null) === 0);
}

console.log('\n=== reading a real diff ===');
{
  // Taken verbatim from `git diff` on this repo.
  const real = [
    'diff --git a/src/lib/agentActivity.ts b/src/lib/agentActivity.ts',
    'index 37a9e48..a61c332 100644',
    '--- a/src/lib/agentActivity.ts',
    '+++ b/src/lib/agentActivity.ts',
    '@@ -37,7 +37,22 @@ export interface AgentActivity {',
    '   phase: thinking | tool | writing | idle;',
    ' }',
    ' ',
    '-let current: AgentActivity | null = null;',
    '+// ─── ONE SLOT WAS THE BUG ───',
    '+const live = new Map();',
    '',
  ].join('\n');
  const lines = parseDiff(real);

  // THE BUG THIS ORDER PREVENTS: '+++ b/file' and '--- a/file' start with + and -, so checking the
  // content markers first paints two header lines as a real addition and a real deletion in EVERY
  // diff — and the +/− counts are wrong by one each, forever.
  const headers = lines.filter((l) => l.text.startsWith('+++') || l.text.startsWith('--- '));
  ok('the file headers are metadata, not changes', headers.every((l) => l.kind === 'meta'));

  const { added, removed } = diffTotals(lines);
  ok('added lines counted correctly', added === 2, `got ${added}`);
  ok('removed lines counted correctly', removed === 1, `got ${removed}`);
  ok('the hunk header is its own kind', lines.some((l) => l.kind === 'hunk'));
  ok('the "diff --git" line is metadata', lines[0].kind === 'meta');
  ok('the "index" line is metadata', lines[1].kind === 'meta');
  ok('context lines keep their content', lines.some((l) => l.kind === 'ctx' && l.text.includes('phase:')));
  const firstAdd = lines.find((l) => l.kind === 'add');
  ok('the leading marker is stripped from content', !firstAdd.text.startsWith('+'));
  // git ends its output with a newline; drawing the split's trailing '' adds a blank row to every diff.
  ok('no phantom blank row at the end', lines[lines.length - 1].text !== '');
}
{
  ok('an empty diff is an empty list, not a crash', parseDiff('').length === 0);
  ok('...and totals zero', diffTotals(parseDiff('')).added === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
