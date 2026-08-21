/**
 * Local dev harness for the Realtor Portal Apps Script web app.
 *
 * Serves App.html from disk and shims google.script.run so that
 * app(action, params) is proxied to the deployed @HEAD web app's
 * ?action= JSON API. Lets us edit the UI locally against live data.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const PORT = 4599;
const EXEC = 'https://script.google.com/macros/s/AKfycbwDuEBNjOtMhRro9ug_Zc1DvvbfHu-Jc8sEQSPuCe8pU7fePEyhwBs_MLkLxXORN5tYpQ/exec';

const SHIM = `<script>
// dev-only: stand in for the Apps Script client bridge
window.google = window.google || {}; window.google.script = window.google.script || {};
Object.defineProperty(window.google.script, 'run', { get: function () {
  var ok = null, bad = null;
  var chain = {
    withSuccessHandler: function (f) { ok = f; return chain; },
    withFailureHandler: function (f) { bad = f; return chain; },
    app: function (action, p) {
      // V1 deployment predates doGet->app() delegation; alias until the new server code ships
      if (action === 'schools') action = 'getSchools';
      var q = new URLSearchParams(Object.assign({ action: action }, p || {}));
      fetch('/api?' + q.toString())
        .then(function (r) { return r.json(); })
        .then(function (d) { console.log('[api]', action, d); if (ok) ok(d); })
        .catch(function (e) { console.error('[api:fail]', action, e); if (bad) bad(e); });
    }
  };
  return chain;
} });
</script>`;

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api') {
    try {
      const upstream = await fetch(EXEC + '?' + url.searchParams.toString(), { redirect: 'follow' });
      const body = await upstream.text();
      console.log(url.searchParams.get('action'), '->', upstream.status, body.length + 'b');
      res.writeHead(upstream.status, { 'content-type': 'application/json' });
      res.end(body);
    } catch (err) {
      console.error('proxy error', err.message);
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(err.message) }));
    }
    return;
  }

  try {
    const html = await readFile(new URL('../App.html', import.meta.url), 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html.replace('</head>', SHIM + '</head>'));
  } catch (err) {
    res.writeHead(500).end(String(err.message));
  }
}).listen(PORT, () => console.log('Realtor Portal dev harness on http://localhost:' + PORT));
