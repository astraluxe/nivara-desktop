#!/usr/bin/env node
// adris.tech agent-browser — Playwright wrapper using system Chrome.
// Techniques from: browser-use (CDP element detection, post-click nav wait),
//   firecrawl (Markdown conversion preserving structure), crawl4ai (multi-metric scoring).

const path = require('path');
const os   = require('os');
const fs   = require('fs');
const http = require('http');

const PROFILE_DIR = process.env.AGENT_BROWSER_PROFILE || (
  process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'adris.tech', 'browser-session')
    : path.join(os.homedir(), '.local', 'share', 'adris-tech', 'browser-session')
);

const CDP_PORT  = 9223;
const CDP_URL   = 'http://localhost:' + CDP_PORT;
const STATE_FILE = path.join(PROFILE_DIR, '.agent-state.json');

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { url: null }; }
}
function writeState(data) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(data)); } catch {}
}

async function isBrowserRunning() {
  return new Promise(function(resolve) {
    http.get(CDP_URL + '/json/version', function(res) {
      resolve(res.statusCode === 200);
      res.resume();
    }).on('error', function() { resolve(false); }).setTimeout(1500, function() { resolve(false); });
  });
}

async function main() {
  var argv = process.argv.slice(2);
  var cmd  = argv[0] || '';

  if (cmd === 'install') {
    try {
      require('playwright-core');
      process.stdout.write('agent-browser ready (playwright-core + system Chrome)\n');
    } catch (_) {
      process.stderr.write('playwright-core not installed\n');
      process.exit(1);
    }
    return;
  }

  var chromium = require('playwright-core').chromium;
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  // ── Interactive commands ───────────────────────────────────────────────────
  if (cmd !== 'open' && cmd !== 'close') {
    var running = await isBrowserRunning();
    var state   = readState();
    var context, browser;

    if (running) {
      try {
        browser = await chromium.connectOverCDP(CDP_URL, { timeout: 3000 });
        var ctxs = browser.contexts();
        context = ctxs.length > 0 ? ctxs[0] : null;
      } catch (_) { browser = null; }
    }

    if (!context) {
      context = await chromium.launchPersistentContext(PROFILE_DIR, {
        channel: 'chrome', headless: false,
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled',
               '--disable-infobars', '--remote-debugging-port=' + CDP_PORT],
        ignoreDefaultArgs: ['--enable-automation'],
      });
    }

    var page = context.pages().at(-1) || await context.newPage();

    if ((page.url() === 'about:blank' || page.url() === '') && state.url) {
      await page.goto(state.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(function() {});
      try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch (_) {}
    }

    // ── snapshot ─────────────────────────────────────────────────────────────
    // browser-use technique: check tabindex, onclick, broader ARIA roles,
    // aria-label — catches React/Vue/custom components that plain tag checks miss.
    if (cmd === 'snapshot') {
      var tree = await page.evaluate(function() {
        var idx = 0;
        var INTERACTIVE_ROLES = [
          'button','link','checkbox','radio','option','menuitem','menuitemcheckbox',
          'menuitemradio','tab','switch','treeitem','listitem','row','combobox',
          'spinbutton','slider','textbox','searchbox','gridcell',
        ];
        var INTERACTIVE_TAGS = ['a','button','input','select','textarea','summary'];

        function isInteractive(el) {
          if (!el || !el.tagName) return false;
          var tag = el.tagName.toLowerCase();
          if (INTERACTIVE_TAGS.includes(tag)) return true;
          var role = el.getAttribute('role') || '';
          if (role && INTERACTIVE_ROLES.includes(role)) return true;
          // tabindex="0" = developer intentionally made it keyboard-focusable
          if (el.getAttribute('tabindex') === '0') return true;
          // onclick attr — catches legacy React / jQuery handlers
          if (el.getAttribute('onclick')) return true;
          if (el.getAttribute('contenteditable') === 'true') return true;
          return false;
        }

        function getLabel(el) {
          return (
            el.getAttribute('aria-label') ||
            el.innerText || el.textContent ||
            el.getAttribute('placeholder') ||
            el.getAttribute('title') || ''
          ).trim().replace(/\n/g, ' ').slice(0, 100);
        }

        function walk(el, depth) {
          if (!el || !el.tagName) return '';
          var tag = el.tagName.toLowerCase();
          if (['script','style','noscript','svg','head'].includes(tag)) return '';
          var line = '';
          if (isInteractive(el)) {
            var label = getLabel(el);
            if (label || el.getAttribute('placeholder')) {
              el.setAttribute('data-aref', 'e' + (++idx));
              var indent = '  '.repeat(Math.min(depth, 6));
              var type  = el.getAttribute('type')        ? ' type='         + el.getAttribute('type')         : '';
              var ph    = el.getAttribute('placeholder') ? ' placeholder="' + el.getAttribute('placeholder') + '"' : '';
              var href  = el.getAttribute('href')        ? ' href="'        + (el.getAttribute('href')||'').slice(0,60) + '"' : '';
              var role  = el.getAttribute('role')        ? ' role='         + el.getAttribute('role')         : '';
              var chk   = el.checked !== undefined && el.checked ? ' checked' : '';
              line = indent + '[@' + el.getAttribute('data-aref') + '] <' + tag + type + ph + href + role + chk + '> ' + label + '\n';
            }
          }
          return line + Array.from(el.children).map(function(c) { return walk(c, depth + 1); }).join('');
        }
        return walk(document.body, 0);
      });
      process.stdout.write((tree || '').trim() || '(no interactive elements found)');
      return;
    }

    // ── click ─────────────────────────────────────────────────────────────────
    // browser-use technique: wait for networkidle post-click to detect navigation.
    if (cmd === 'click') {
      var sel = (argv[1] || '').replace(/^"|"$/g, '').trim();
      if (!sel) { process.stdout.write('click: missing selector'); return; }

      if (sel.startsWith('@')) {
        var ref = sel.slice(1);
        await page.evaluate(function(r) {
          var el = document.querySelector('[data-aref="' + r + '"]');
          if (!el) throw new Error('ref @' + r + ' not found — call snapshot first');
          el.click();
        }, ref);
      } else {
        await page.click(sel, { timeout: 10000 });
      }

      try { await page.waitForLoadState('networkidle', { timeout: 3000 }); } catch (_) {}
      var newUrl = page.url();
      writeState({ url: newUrl });
      process.stdout.write('Clicked "' + sel + '". Page: ' + newUrl);
      return;
    }

    // ── fill ───────────────────────────────────────────────────────────────────
    if (cmd === 'fill') {
      var fillSel  = argv[1] || '';
      var fillText = argv.slice(2).join(' ');
      if (!fillSel) { process.stdout.write('fill: missing selector'); return; }

      if (fillSel.startsWith('@')) {
        var fillRef = fillSel.slice(1);
        await page.evaluate(function(args) {
          var el = document.querySelector('[data-aref="' + args.r + '"]');
          if (!el) throw new Error('ref @' + args.r + ' not found');
          el.focus();
          el.value = args.t;
          el.dispatchEvent(new Event('input',  { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, { r: fillRef, t: fillText });
      } else {
        await page.fill(fillSel, fillText, { timeout: 10000 });
      }
      writeState({ url: page.url() });
      process.stdout.write('Filled "' + fillSel + '" with the provided text.');
      return;
    }

    // ── screenshot ─────────────────────────────────────────────────────────────
    if (cmd === 'screenshot') {
      var buf = await page.screenshot({ type: 'jpeg', quality: 72 });
      process.stdout.write('data:image/jpeg;base64,' + buf.toString('base64'));
      return;
    }

    // ── get text ───────────────────────────────────────────────────────────────
    if (cmd === 'get') {
      var rest     = argv.slice(1).join(' ').replace(/^"|"$/g, '').trim();
      var bodyOnly = rest.startsWith('text') ? rest.slice(4).trim() : rest;
      var gtSel    = bodyOnly || 'body';
      var txt = await page.evaluate(function(s) {
        var el = document.querySelector(s);
        return el ? (el.innerText || el.textContent || '').trim() : '(element not found)';
      }, gtSel);
      process.stdout.write(txt);
      return;
    }

    process.stdout.write('(done)');
    return;
  }

  // ── close ─────────────────────────────────────────────────────────────────
  if (cmd === 'close') {
    var isRunning = await isBrowserRunning();
    if (isRunning) {
      try {
        var closeBrowser = await chromium.connectOverCDP(CDP_URL, { timeout: 2000 });
        await closeBrowser.close();
      } catch (_) {}
    }
    writeState({ url: null });
    process.stdout.write('Browser closed.');
    return;
  }

  // ── open <url> ────────────────────────────────────────────────────────────
  var rawUrl = argv.slice(1).join(' ').replace(/^"|"$/g, '').trim();
  var url    = rawUrl.startsWith('http') ? rawUrl : 'https://' + rawUrl;

  var openCtx;
  var openRunning = await isBrowserRunning();
  if (openRunning) {
    try {
      var openBrowser = await chromium.connectOverCDP(CDP_URL, { timeout: 3000 });
      var openCtxs = openBrowser.contexts();
      openCtx = openCtxs.length > 0 ? openCtxs[0] : null;
    } catch (_) {}
  }

  if (!openCtx) {
    openCtx = await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: 'chrome', headless: false,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--remote-debugging-port=' + CDP_PORT,
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });
  }

  var openPage = openCtx.pages()[0] || await openCtx.newPage();
  await openPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
  try { await openPage.waitForLoadState('networkidle', { timeout: 6000 }); } catch (_) {}
  await openPage.evaluate(function() { window.scrollTo(0, Math.floor(document.body.scrollHeight / 3)); });
  await new Promise(function(r) { setTimeout(r, 2000); });

  // Extract content as Markdown — firecrawl selector removal + crawl4ai multi-metric scoring
  // + markdown conversion preserving links, tables, lists, code blocks.
  var markdown = await openPage.evaluate(function() {
    // ── 1. Remove known noise selectors (firecrawl approach) ─────────────────
    var REMOVE_TAGS = ['script','style','noscript','iframe','svg','canvas','template'];
    var REMOVE_SELECTORS = [
      'header', 'footer', 'nav', 'aside',
      '[class*="header"]', '[class*="footer"]', '[class*="navbar"]',
      '[class*="nav-"]', '[class*="-nav"]', '[class*="sidebar"]',
      '[class*="cookie"]', '[id*="cookie"]', '[class*="gdpr"]',
      '[class*="banner"]', '[class*="popup"]', '[class*="modal"]',
      '[class*="overlay"]', '[class*="toast"]',
      '[class*="advertisement"]', '[id*="advertisement"]', '[class*="ads-"]',
      '[class*="ad-"]', '[id*="ad-"]',
      '[class*="social-"]', '[class*="share-"]', '[class*="breadcrumb"]',
      '[class*="subscribe"]', '[class*="newsletter"]', '[class*="signup"]',
      '[class*="promo"]', '[class*="widget"]',
      '[aria-label*="advertisement"]',
      '[role="banner"]', '[role="navigation"]', '[role="complementary"]',
      '.sr-only', '.visually-hidden', '[hidden]', '[aria-hidden="true"]',
    ];
    var clone = document.body.cloneNode(true);
    REMOVE_TAGS.forEach(function(t) {
      clone.querySelectorAll(t).forEach(function(el) { el.remove(); });
    });
    REMOVE_SELECTORS.forEach(function(s) {
      try { clone.querySelectorAll(s).forEach(function(el) { el.remove(); }); } catch (_) {}
    });

    // ── 2. Multi-metric block scoring (crawl4ai approach) ────────────────────
    function scoreBlock(el) {
      var text    = el.innerText || el.textContent || '';
      var textLen = text.trim().length;
      if (textLen < 30) return 0;

      var htmlLen     = el.innerHTML.length;
      var textDensity = htmlLen > 0 ? textLen / htmlLen : 0;

      var linkText = Array.from(el.querySelectorAll('a')).reduce(function(s, a) {
        return s + (a.innerText || a.textContent || '').length;
      }, 0);
      var linkDensity = textLen > 0 ? Math.max(0, 1 - linkText / textLen) : 0.5;

      var TAG_W = { article: 1.5, main: 1.4, section: 1.1, p: 1.2, div: 0.8, span: 0.5 };
      var tagWeight = TAG_W[el.tagName.toLowerCase()] || 0.8;

      var classStr = ((el.className || '') + ' ' + (el.id || '')).toLowerCase();
      var BAD = ['nav','footer','sidebar','header','menu','ad','promo','widget','banner','cookie','social','share'];
      var classWeight = BAD.some(function(w) { return classStr.indexOf(w) !== -1; }) ? 0.2 : 1.0;

      return 0.35 * textDensity + 0.25 * linkDensity + 0.2 * tagWeight + 0.1 * classWeight + 0.1 * (Math.log(textLen + 1) / 10);
    }

    // ── 3. DOM → Markdown (firecrawl approach) ───────────────────────────────
    // Converts HTML to Markdown-ish text preserving links, lists, tables, code.
    function domToMd(el, depth) {
      if (!el) return '';
      // Text node
      if (el.nodeType === 3) return (el.textContent || '').replace(/\s+/g, ' ');
      if (el.nodeType !== 1) return '';
      var tag = el.tagName.toLowerCase();
      if (['script','style','noscript','iframe','svg','canvas','template'].includes(tag)) return '';

      function kids() {
        return Array.from(el.childNodes).map(function(c) { return domToMd(c, depth + 1); }).join('').trim();
      }

      switch (tag) {
        case 'h1': return '\n# '    + (el.textContent || '').trim() + '\n';
        case 'h2': return '\n## '   + (el.textContent || '').trim() + '\n';
        case 'h3': return '\n### '  + (el.textContent || '').trim() + '\n';
        case 'h4': return '\n#### ' + (el.textContent || '').trim() + '\n';
        case 'h5': return '\n##### '+ (el.textContent || '').trim() + '\n';
        case 'br': return '\n';
        case 'hr': return '\n---\n';
        case 'p':  { var pt = kids(); return pt ? '\n' + pt + '\n' : ''; }
        case 'li': return '\n- ' + (el.textContent || '').trim();
        case 'ul':
        case 'ol': return '\n' + kids() + '\n';
        case 'a': {
          var href = el.getAttribute('href') || '';
          var lt   = (el.textContent || '').trim();
          if (!lt) return '';
          if (!href || href.startsWith('#') || href.startsWith('javascript')) return lt;
          return '[' + lt + '](' + href + ')';
        }
        case 'strong':
        case 'b': { var bt = kids(); return bt ? '**' + bt + '**' : ''; }
        case 'em':
        case 'i':  { var it = kids(); return it ? '_' + it + '_' : ''; }
        case 'code': {
          var ct = (el.textContent || '').trim();
          return ct ? ('`' + ct + '`') : '';
        }
        case 'pre': {
          var pret = (el.textContent || '').trim();
          return pret ? ('\n```\n' + pret + '\n```\n') : '';
        }
        case 'blockquote': return '\n> ' + kids().replace(/\n/g, '\n> ') + '\n';
        case 'table': {
          var rows = Array.from(el.querySelectorAll('tr'));
          if (!rows.length) return '';
          var tdata = rows.map(function(r) {
            return Array.from(r.querySelectorAll('td,th')).map(function(c) {
              return (c.textContent || '').trim().replace(/\|/g, '\\|');
            });
          });
          var maxC = Math.max.apply(null, tdata.map(function(r) { return r.length; }));
          var tlines = tdata.map(function(r) {
            while (r.length < maxC) r.push('');
            return '| ' + r.join(' | ') + ' |';
          });
          if (tlines.length > 1) tlines.splice(1, 0, '| ' + Array(maxC).fill('---').join(' | ') + ' |');
          return '\n' + tlines.join('\n') + '\n';
        }
        case 'img': {
          var alt = el.getAttribute('alt') || '';
          return alt ? '[Image: ' + alt + ']' : '';
        }
        default: return kids();
      }
    }

    // ── 4. Pick best content area ─────────────────────────────────────────────
    var preferred = clone.querySelector('article') || clone.querySelector('main')
      || clone.querySelector('[role="main"]') || clone.querySelector('#content')
      || clone.querySelector('.content') || clone.querySelector('#main');
    var container = preferred || clone;

    // Score top-level blocks to find best content areas
    var blocks = Array.from(container.children).filter(function(el) {
      return ['div','article','section','main','p'].includes(el.tagName.toLowerCase());
    });
    var scored = blocks
      .map(function(el) { return { el: el, s: scoreBlock(el) }; })
      .filter(function(b) { return b.s > 0.15; })
      .sort(function(a, b) { return b.s - a.s; });

    var topN    = scored.slice(0, Math.max(3, Math.ceil(scored.length * 0.6)));
    var topText = topN.reduce(function(s, b) { return s + (b.el.innerText || b.el.textContent || ''); }, '').trim();
    var useBlocks = topText.length > 200 && topN.length > 0;

    var md = useBlocks
      ? topN.map(function(b) { return domToMd(b.el, 0); }).join('\n')
      : domToMd(container, 0);

    return md.replace(/\n{3,}/g, '\n\n').trim();
  });

  writeState({ url: url });
  // DON'T close context — Chrome stays open so click/fill/snapshot work on this page
  process.stdout.write(markdown || '(page loaded — no readable text)');
}

main().catch(function(e) {
  process.stderr.write(String(e && e.message ? e.message : e));
  process.exit(1);
});
