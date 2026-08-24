// Four webmail pages that behave like the real ones, so the `webmail` browser command can be
// tested against something other than the developer's own inbox.
//
// Modelled on what the actual products do, because that is where the difficulty lives:
//   /roundcube — the shape most cPanel and shared-hosting webmail takes. Compose is behind a
//                button, the fields are name="_to" / name="_subject", and the message body is a
//                contenteditable <body> inside an IFRAME, the way TinyMCE renders it.
//   /titan     — the modern shape: no useful name attributes at all, everything found by
//                aria-label, body is a div[role=textbox].
//   /login     — signed out. Must be reported as such, never treated as a broken compose form.
//   /nothing   — a page with no compose anywhere. Must be admitted, not guessed at.
import http from 'node:http';

const PAGE = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui;padding:24px;background:#fff;color:#111}
input,textarea{display:block;width:420px;padding:8px;margin:6px 0;font-size:14px}
button{padding:8px 14px;font-size:14px}iframe{width:420px;height:160px;border:1px solid #ccc}</style>
</head><body>${body}</body></html>`;

const ROUTES = {
  // Compose hidden behind a button, fields named the Roundcube way, body in an iframe.
  '/roundcube': PAGE('Webmail :: Inbox', `
    <h2>Webmail</h2>
    <button id="c" onclick="document.getElementById('f').style.display='block';this.style.display='none'">Compose</button>
    <div id="f" style="display:none">
      <input name="_to" id="_to" placeholder="">
      <input name="_subject" id="_subject" placeholder="">
      <iframe id="ed" srcdoc="&lt;body id='tinymce' contenteditable='true' style='font-family:system-ui;padding:6px'&gt;&lt;/body&gt;"></iframe>
    </div>`),

  // Nothing useful in the name attributes — only aria-labels, like the newer products.
  '/titan': PAGE('Mail', `
    <h2>Mail</h2>
    <button aria-label="Compose new message">New Message</button>
    <div>
      <input aria-label="To" />
      <input aria-label="Subject" />
      <div role="textbox" contenteditable="true" aria-label="Message body"
           style="width:420px;min-height:120px;border:1px solid #ccc;padding:8px"></div>
    </div>`),

  '/login': PAGE('Sign in', `
    <h2>Sign in to your mailbox</h2>
    <input type="email" placeholder="Email">
    <input type="password" placeholder="Password">
    <button>Log in</button>`),

  '/nothing': PAGE('Mailbox', `<h2>Mailbox</h2><p>You have no new messages.</p>`),
};

const port = Number(process.argv[2] || 5196);
const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  const html = ROUTES[p];
  if (!html) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
});
server.listen(port, () => console.log('fake webmail on ' + port));
