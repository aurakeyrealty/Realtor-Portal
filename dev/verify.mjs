/* Pre-push verification: load the four server files the way Apps Script does —
   concatenated into ONE global scope — with stubbed platform globals. */
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const DIR = '/Users/sarathkumar/Projects/2Creative/Realtor-Portal/';
const SERVER = ['Core.js', 'Sheets.js', 'Team.js', 'External.js'];
let fail = 0;
const ok = (c, m) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) fail++; };

// ---- 1. load all four as one scope, like Apps Script ----
const combined = SERVER.map(f => readFileSync(DIR + f, 'utf8')).join('\n');
const htmlReads = [];
const ctx = {
  SpreadsheetApp: { openById: () => { throw new Error('not exercised'); } },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, getAll: () => ({}), putAll: () => {} }) },
  HtmlService: {
    createHtmlOutputFromFile: (n) => { htmlReads.push(n); return { getContent: () => readFileSync(DIR + n + '.html', 'utf8') }; },
    createTemplateFromFile: (n) => { htmlReads.push(n); return { evaluate: () => ({ setTitle: () => ({ addMetaTag: () => ({ setXFrameOptionsMode: () => 'PAGE' }) }) }) }; },
    XFrameOptionsMode: { DEFAULT: 1 },
  },
  ContentService: { createTextOutput: (t) => ({ setMimeType: () => ({ json: t }) }), MimeType: { JSON: 'json' } },
  UrlFetchApp: { fetch: () => { throw new Error('not exercised'); } },
  Utilities: { base64EncodeWebSafe: () => 'x', computeHmacSha256Signature: () => [1], formatDate: () => '', sleep: () => {}, newBlob: () => ({ getDataAsString: () => '' }), base64DecodeWebSafe: () => [] },
  Logger: { log: () => {} }, console,
};
vm.createContext(ctx);
try { vm.runInContext(combined, ctx); ok(true, 'all four server files load together in one global scope'); }
catch (e) { ok(false, 'load failed: ' + e.message); process.exit(1); }

// ---- 2. every action in the dispatch table resolves to a real function ----
const core = readFileSync(DIR + 'Core.js', 'utf8');
const appBody = core.slice(core.indexOf('function app(action, p)'));
const targets = [...appBody.matchAll(/case '([a-zA-Z]+)':\s*(?:return|)\s*([a-zA-Z_0-9]+)\(/g)];
const missing = targets.filter(m => typeof ctx[m[2]] !== 'function').map(m => `${m[1]} -> ${m[2]}`);
ok(missing.length === 0, `all ${targets.length} app() dispatch targets are defined${missing.length ? ': MISSING ' + missing.join(', ') : ''}`);

// ---- 3. entry points exist ----
['doGet', 'doPost', 'app', 'include'].forEach(f => ok(typeof ctx[f] === 'function', `entry point ${f}() defined`));

// ---- 4. every helper_ called anywhere is defined somewhere ----
const defined = new Set([...combined.matchAll(/^\s*function ([A-Za-z_0-9]+)/gm)].map(m => m[1]));   // incl. nested fns
const called = new Set([...combined.matchAll(/\b([a-zA-Z][A-Za-z_0-9]*_)\(/g)].map(m => m[1]));
const undef = [...called].filter(n => !defined.has(n));
ok(undef.length === 0, `every private helper called is defined${undef.length ? ': MISSING ' + undef.join(', ') : ''} (${defined.size} functions total)`);

// ---- 5. include() targets exist on disk with exact-case names ----
const appHtml = readFileSync(DIR + 'App.html', 'utf8');
const incs = [...appHtml.matchAll(/include\('([^']+)'\)/g)].map(m => m[1]);
ok(incs.length === 2, `App.html declares ${incs.length} includes: ${incs.join(', ')}`);
incs.forEach(n => ok(existsSync(DIR + n + '.html'), `include('${n}') resolves to ${n}.html on disk (case-exact)`));

// ---- 6. include() actually returns the partial content through the real code path ----
incs.forEach(n => {
  const out = ctx.include(n);
  ok(out.length > 100 && out === readFileSync(DIR + n + '.html', 'utf8'), `include('${n}') returns ${n}.html verbatim (${out.length} bytes)`);
});

// ---- 7. doGet with no action takes the template path and names the right file ----
htmlReads.length = 0;
ctx.doGet({ parameter: {} });
ok(htmlReads.includes('App'), `doGet() with no action renders template 'App' (read: ${htmlReads.join(', ')})`);

console.log(fail ? `\n${fail} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(fail ? 1 : 0);
