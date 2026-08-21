/**
 * Realtor Portal — Mobile data API
 * ================================
 * SEPARATE project. Deploy: Web app > Execute as: Me > Access: Anyone.
 *
 * Public (no login):  tab, tabs, getSchools, getRankings, contacts, resources,
 *                     contractors, websites, cities
 * Login required:     city, builders, listings   (they carry logins / deal codes)
 *   -> pass &auth=<token from login> on those.
 */

var SHEETS = {
  main:       '1DSaHocXEpfCBoJgE8JUxKsoqrR-H8D08kTLP3hI9-l0',
  deals:      '1FHi7550lIG4oQOWCt9HdLwLM84PxD_sgdEqeoiPsEWI',
  onboarding: '1DtIWnqR6LKN5AqlqwCNfoSk1FFsjEaPu'
};
var DEFAULT_SHEET = 'main';
var API_TOKEN = '';                       // app-level secret; '' = off

var ADMIN_ID = 'admin';
var ADMIN_PASSCODE = 'aurakey2026';
var TOKEN_SECRET = 'CHANGE_ME_to_a_long_random_string_2f8b1';

var LOGIN_HEADER_ROW = 2, LOGIN_FIRST_COL = 1, LOGIN_NUM_COLS = 5;   // A..E, row 2
var HEADER_ROW = 2, DATA_START = 3;       // city / school tabs: headers row 2, data row 3
var HEADER_ROWS = { 'main:School Rankings': 2 };

// City-tab column keywords (from the portal's FIELD_KEYS)
var FIELD_KEYS = {
  project:['PROJECT'], builder:['BUILDER'], type:['TYPE'], occupancy:['OCCUPANCY','OCCUPAN'],
  broker:['BROKER'], drive:['UNBRANDED'], login:['LOGIN'], office:['OFFICE'], contact:['CONTACT'], fub:['FUB'],
  status:['STATUS'], live:['LIVE ON','ON WEBSITE'], website:['LIVE LINK','LINK']
};

var ALLOW = {
  main: [
    'School', 'School Rankings',
    'BUILDERS', 'Contractors', 'Resources', "FAQ's", 'Lawyers', 'CITIES', 'Events',
    'FocusProjects', 'Focus Dxb Projects', 'HotPriceSheet', 'HotDeals', 'RESALE',
    'PRECON', 'Precon Reserch - Prakash', 'Deposit Calculator', 'COMMERCIAL',
    'ONTARIO', 'AJAX', 'Aurora', 'BARRIE', 'BRAMPTON', 'BRANTFORD', 'BOWMANVILLE',
    'BURLINGTON', 'CALEDON', 'CALEDONIA', 'CAMBRIDGE', 'COURTICE', 'ETOBICOKE',
    'ERIN', 'GUELPH', 'KITCHENER', 'HAMILTON', 'KING CITY', 'LINDSAY', 'LONDON',
    'MILTON', 'MISSISSAUGA', 'MARKHAM', 'NEWMARKET', 'OAKVILLE', 'ORANGEVILLE',
    'OSHAWA', 'OTTAWA', 'PARIS', 'PICKERING', 'RICHMOND HILL', 'SCARBOROUGH',
    'STAYNER', 'STOUFFVILLE', 'WELLAND', 'VAUGHAN', 'WHITBY', 'WOODSTOCK',
    'CALGARY', 'DUBAI'
  ],
  deals: ['Active Listings', 'Websites'],
  onboarding: []
};

/* ================= core helpers ================= */
function ssFor_(key) { return SpreadsheetApp.openById(SHEETS[key] || SHEETS[DEFAULT_SHEET]); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function isAllowed_(k, t) { return (ALLOW[k] || []).indexOf(t) !== -1; }
function headerRowFor_(k, t, o) { if (o) return Math.max(1, parseInt(o, 10) || 1); return HEADER_ROWS[k + ':' + t] || 1; }
var __FRESH = false;
function cacheGet_(k) { if (__FRESH) return null; try { var h = CacheService.getScriptCache().get(k); return h ? JSON.parse(h) : null; } catch (e) { return null; } }
function cachePut_(k, v) { try { var s = JSON.stringify(v); if (s.length < 95000) CacheService.getScriptCache().put(k, s, 900); } catch (e) {} }
function requireAuth_(p) { return !!checkToken_(p.auth || p.authToken || ''); }
function authErr_() { return { error: 'login required' }; }

/* pull a URL from a cell: real hyperlink, run link, =HYPERLINK(), or bare URL */
function cellUrl_(rt, formula, text) {
  try {
    if (rt) {
      var u = rt.getLinkUrl(); if (u) return u;
      var runs = rt.getRuns ? rt.getRuns() : [];
      for (var i = 0; i < runs.length; i++) { var ru = runs[i].getLinkUrl(); if (ru) return ru; }
    }
  } catch (e) {}
  var m = String(formula || '').match(/HYPERLINK\s*\(\s*"([^"]+)"/i);
  if (m) return m[1];
  var t = String(text || '').trim();
  return /^https?:\/\//i.test(t) ? t : '';
}
function headerMap_(hdr, spec) {
  var m = {};
  for (var key in spec) {
    m[key] = -1; var keys = spec[key];
    for (var c = 0; c < hdr.length && m[key] < 0; c++) for (var k = 0; k < keys.length; k++) if (hdr[c] === keys[k]) { m[key] = c; break; }
    for (var c2 = 0; c2 < hdr.length && m[key] < 0; c2++) for (var k2 = 0; k2 < keys.length; k2++) if (hdr[c2].indexOf(keys[k2]) >= 0) { m[key] = c2; break; }
  }
  return m;
}
function catsFromType_(type) {
  var t = String(type || '').toLowerCase(), out = [];
  if (t.indexOf('town') >= 0) out.push('townhome');
  if (t.indexOf('detach') >= 0) out.push('detached');
  if (t.indexOf('semi') >= 0) out.push('semi');
  if (t.indexOf('condo') >= 0) out.push('condo');
  return out;
}
function findMainTab_(match) {
  var sheets = ssFor_('main').getSheets(); match = String(match).toUpperCase();
  for (var i = 0; i < sheets.length; i++) if (sheets[i].getName().toUpperCase().replace(/\s+/g, '').indexOf(match) >= 0) return sheets[i];
  return null;
}
function dealsFind_(match) {
  var sheets = ssFor_('deals').getSheets(); match = String(match).toUpperCase();
  for (var i = 0; i < sheets.length; i++) if (sheets[i].getName().trim().toUpperCase().indexOf(match) >= 0) return sheets[i];
  return null;
}

/* ================= routing ================= */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.fresh) __FRESH = true;
  if (!p.action) {
    return HtmlService.createTemplateFromFile('App').evaluate()
      .setTitle('Aura Key')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
  }
  if (API_TOKEN && p.token !== API_TOKEN) return json_({ error: 'unauthorized' });
  var a = p.action || '';

  // doGet-only actions
  if (a === 'tabs') { var o = {}; Object.keys(ALLOW).forEach(function (k) { o[k] = ALLOW[k].slice(); }); return json_({ sheets: o }); }
  if (a === 'tab')   return json_(readTab_(p.name || '', p.sheet || '', p.headerRow || ''));
  if (a === 'bootcampreview') return json_(bootcampReview_(p));       // admin token only

  // Everything else goes through app()'s switch — ONE dispatch table, no drift.
  // (All reference pages are OPEN, team-only app; login gates My Deals + Bootcamp.)
  return json_(app(a, p));
}

function doPost(e) {
  var b = {};
  try { b = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  if (API_TOKEN && b.token !== API_TOKEN) return json_({ error: 'unauthorized' });
  if (b.action === 'login') return json_(handleLogin_(b));
  return json_({ error: 'unknown action' });
}

/* ================= generic tab reader ================= */
function readTab_(tabName, sheetKey, headerRowOverride) {
  tabName = String(tabName || '').trim();
  if (!tabName) return { error: 'no tab name given' };
  var order = sheetKey && SHEETS[sheetKey] ? [sheetKey]
    : [DEFAULT_SHEET].concat(Object.keys(SHEETS).filter(function (k) { return k !== DEFAULT_SHEET; }));
  var sh = null, foundIn = '';
  for (var i = 0; i < order.length; i++) {
    if (!isAllowed_(order[i], tabName)) continue;
    var c = ssFor_(order[i]).getSheetByName(tabName);
    if (c) { sh = c; foundIn = order[i]; break; }
  }
  if (!sh) return { error: 'not available' };
  var hr = headerRowFor_(foundIn, tabName, headerRowOverride);
  var ck = 'tab_' + foundIn + '_' + tabName + '_h' + hr, hit = cacheGet_(ck);
  if (hit) { hit.cached = true; return hit; }
  var values = sh.getDataRange().getDisplayValues();
  if (values.length < hr) return { sheet: foundIn, tab: tabName, count: 0, rows: [] };
  var headers = values[hr - 1].map(function (h) { return String(h).trim(); });
  var rows = values.slice(hr).filter(function (r) { return r.join('').trim() !== ''; })
    .map(function (r) { var o = {}; headers.forEach(function (h, i) { if (h) o[h] = r[i]; }); return o; });
  var out = { sheet: foundIn, tab: tabName, updated: new Date().toISOString(), count: rows.length, rows: rows };
  cachePut_(ck, out); return out;
}

/* ================= smart table reader (header auto-detect) ================= */
function readTableSmart_(sh) {
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getDataRange().getDisplayValues();
  function norm(h) { return String(h || '').trim().toLowerCase().replace(/\s+/g, '_'); }
  var hdr = vals[0].map(norm);
  var rows = [];
  for (var r = 1; r < vals.length; r++) {
    var o = { _row: r + 1 };
    for (var c = 0; c < hdr.length; c++) { if (hdr[c] && o[hdr[c]] === undefined) o[hdr[c]] = String(vals[r][c] || '').trim(); }
    rows.push(o);
  }
  return rows;
}

/* ================= city projects (getProjects) ================= */
function resolveCity_(city) {
  var want = String(city || '').trim().toUpperCase(), sheets = ssFor_('main').getSheets();
  for (var i = 0; i < sheets.length; i++) if (sheets[i].getName().trim().toUpperCase() === want) return sheets[i];
  return null;
}
function buildColMap_(sh) {
  var headers = sh.getRange(HEADER_ROW, 1, 1, sh.getLastColumn()).getDisplayValues()[0], map = {};
  for (var f in FIELD_KEYS) {
    var keys = FIELD_KEYS[f];
    for (var c = 0; c < headers.length; c++) {
      var h = String(headers[c] || '').trim().toUpperCase(), hit = false;
      for (var k = 0; k < keys.length; k++) if (h.indexOf(keys[k]) >= 0) { hit = true; break; }
      if (hit) { map[f] = c + 1; break; }
    }
  }
  return map;
}
function getProjects_(city) {
  city = String(city || '').trim();
  if (!city) return { error: 'no city name' };
  var key = 'proj_' + city.toUpperCase(), hit = cacheGet_(key);
  if (hit) { hit.cached = true; return hit; }
  var sh = resolveCity_(city);
  if (!sh) return { error: 'city tab "' + city + '" not found' };
  var lastRow = sh.getLastRow();
  if (lastRow < DATA_START) return { city: city, count: 0, rows: [] };
  var map = buildColMap_(sh), lastCol = sh.getLastColumn(), numRows = lastRow - DATA_START + 1;
  var disp = sh.getRange(DATA_START, 1, numRows, lastCol).getDisplayValues();
  var bR = null, bF = null, dR = null, dF = null, wR = null, wF = null;
  if (map.broker)  { var b = sh.getRange(DATA_START, map.broker, numRows, 1); bR = b.getRichTextValues(); bF = b.getFormulas(); }
  if (map.drive)   { var d = sh.getRange(DATA_START, map.drive, numRows, 1); dR = d.getRichTextValues(); dF = d.getFormulas(); }
  if (map.website) { var w = sh.getRange(DATA_START, map.website, numRows, 1); wR = w.getRichTextValues(); wF = w.getFormulas(); }
  function txt(row, f) { var idx = map[f]; return idx ? String(row[idx - 1] || '').trim() : ''; }
  var out = [];
  for (var r = 0; r < numRows; r++) {
    var d2 = disp[r], project = txt(d2, 'project'), builder = txt(d2, 'builder');
    if (!project && !builder) continue;
    var type = txt(d2, 'type'), status = txt(d2, 'status');
    out.push({
      _row: DATA_START + r, project: project, builder: builder, type: type, cats: catsFromType_(type),
      occupancy: txt(d2, 'occupancy'), login: txt(d2, 'login'), office: txt(d2, 'office'),
      contact: txt(d2, 'contact'), fub: txt(d2, 'fub'), status: status, live: txt(d2, 'live'),
      hidden: /not\s*avail|unavailable/i.test(String(status).replace(/[-_]/g, ' ')),
      broker_url:  map.broker  ? cellUrl_(bR[r][0], bF[r][0], d2[map.broker - 1])  : '',
      drive_url:   map.drive   ? cellUrl_(dR[r][0], dF[r][0], d2[map.drive - 1])   : '',
      website_url: map.website ? cellUrl_(wR[r][0], wF[r][0], d2[map.website - 1]) : ''
    });
  }
  var res = { city: city.toUpperCase(), updated: new Date().toISOString(), count: out.length, rows: out };
  cachePut_(key, res); return res;
}

/* ================= builders ================= */
function getBuilders_() {
  var hit = cacheGet_('builders_api'); if (hit) { hit.cached = true; return hit; }
  var sh = findMainTab_('BUILDER');
  if (!sh || sh.getLastRow() < 2) return { count: 0, rows: [] };
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  var hdr = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(function (h) { return String(h || '').trim().toUpperCase(); });
  function colx(incl, excl) {
    for (var c = 0; c < hdr.length; c++) {
      var h = hdr[c], ok = false, k;
      for (k = 0; k < incl.length; k++) if (h.indexOf(incl[k]) >= 0) { ok = true; break; }
      if (ok && excl) for (k = 0; k < excl.length; k++) if (h.indexOf(excl[k]) >= 0) { ok = false; break; }
      if (ok) return c;
    }
    return -1;
  }
  var iName = colx(['BUILDER NAME']); if (iName < 0) iName = colx(['NAME'], ['PROJECT', 'REP']);
  var iProject = colx(['PROJECT']), iRep = colx(['REP', 'CONTACT'], ['PHONE', 'NUMBER']);
  var iPhone = colx(['PHONE', 'NUMBER', 'MOBILE']), iEmail = colx(['EMAIL']);
  var iBroker = colx(['BROKER', 'PORTAL']), iLogin = colx(['LOGIN', 'USER']), iPass = colx(['PASSWORD', 'PASS']), iNotes = colx(['NOTE']);
  var numRows = lastRow - 1, disp = sh.getRange(2, 1, numRows, lastCol).getDisplayValues();
  var bR = null, bF = null;
  if (iBroker >= 0) { var b = sh.getRange(2, iBroker + 1, numRows, 1); bR = b.getRichTextValues(); bF = b.getFormulas(); }
  function g(row, i) { return i >= 0 ? String(row[i] || '').trim() : ''; }
  var out = [];
  for (var r = 0; r < numRows; r++) {
    var row = disp[r], name = g(row, iName), project = g(row, iProject), rep = g(row, iRep), phone = g(row, iPhone);
    if (!name && !rep && !project && !phone) continue;
    out.push({ _row: r + 2, name: name, project: project, rep: rep, phone: phone, email: g(row, iEmail),
      login: g(row, iLogin), password: g(row, iPass), notes: g(row, iNotes),
      broker_url: iBroker >= 0 ? cellUrl_(bR[r][0], bF[r][0], row[iBroker]) : '' });
  }
  var res = { updated: new Date().toISOString(), count: out.length, rows: out };
  cachePut_('builders_api', res); return res;
}

/* ================= contractors ================= */
function getContractors_() {
  var hit = cacheGet_('contractors_api'); if (hit) { hit.cached = true; return hit; }
  var rows = readTableSmart_(findMainTab_('CONTRACTOR')), out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i]; if (!r.name && !r.category) continue;
    out.push({ _row: r._row, category: (r.category || '').trim(), name: (r.company_name || r.name || '').trim(),
      contact: (r.contact_person || r.contact || '').trim(), phone: (r.phone || '').trim(),
      email: (r.email || '').trim(), area: (r.address || r.area || '').trim(),
      website: (r.website || '').trim(), notes: (r.notes || '').trim() });
  }
  var res = { updated: new Date().toISOString(), count: out.length, rows: out };
  cachePut_('contractors_api', res); return res;
}

/* ================= contacts (Home) ================= */
function getContacts_() {
  var hit = cacheGet_('contacts_api'); if (hit) { hit.cached = true; return hit; }
  var sheets = ssFor_('main').getSheets(), sh = null;
  for (var i = 0; i < sheets.length && !sh; i++) { var n = sheets[i].getName().trim().toUpperCase(); if (n === 'CONTACTS' || n === 'CONTACT' || n === 'HOME') sh = sheets[i]; }
  for (var j = 0; j < sheets.length && !sh; j++) { var n2 = sheets[j].getName().toUpperCase(); if (n2.indexOf('CONTACT') >= 0 || n2.indexOf('HOME') >= 0) sh = sheets[j]; }
  if (!sh || sh.getLastRow() < 2) return { count: 0, rows: [] };
  var vals = sh.getDataRange().getDisplayValues();
  var hdr = vals[0].map(function (h) { return String(h || '').trim().toUpperCase(); });
  function col(keys) { for (var c = 0; c < hdr.length; c++) for (var k = 0; k < keys.length; k++) if (hdr[c].indexOf(keys[k]) >= 0) return c; return -1; }
  var m = { category: col(['CATEGORY']), title: col(['TITLE']), name: col(['NAME']), company: col(['COMPANY', 'BANK']),
    direct: col(['DIRECT']), office: col(['OFFICE']), email: col(['EMAIL']), address: col(['ADDRESS']), tag: col(['TAG']), notes: col(['NOTE']) };
  function g(row, k) { return m[k] >= 0 ? String(row[m[k]] || '').trim() : ''; }
  var out = [];
  for (var r = 1; r < vals.length; r++) {
    var cat = g(vals[r], 'category'), name = g(vals[r], 'name');
    if (!cat && !name) continue;
    out.push({ category: cat, title: g(vals[r], 'title'), name: name, company: g(vals[r], 'company'),
      direct: g(vals[r], 'direct'), office: g(vals[r], 'office'), email: g(vals[r], 'email'),
      address: g(vals[r], 'address'), tag: g(vals[r], 'tag'), notes: g(vals[r], 'notes') });
  }
  var res = { updated: new Date().toISOString(), count: out.length, rows: out };
  cachePut_('contacts_api', res); return res;
}

/* ================= resources (grouped) ================= */
function getResources_() {
  var hit = cacheGet_('resources_api'); if (hit) return hit;
  var sheets = ssFor_('main').getSheets(), sh = null;
  for (var i = 0; i < sheets.length; i++) if (sheets[i].getName().toUpperCase().indexOf('RESOURCE') >= 0) { sh = sheets[i]; break; }
  if (!sh || sh.getLastRow() < 2) return { categories: [] };
  var vals = sh.getDataRange().getDisplayValues();
  var hdr = vals[0].map(function (h) { return String(h || '').trim().toUpperCase(); });
  function col(keys) { for (var c = 0; c < hdr.length; c++) for (var k = 0; k < keys.length; k++) if (hdr[c].indexOf(keys[k]) >= 0) return c; return -1; }
  var m = { category: col(['CATEGORY']), label: col(['LABEL']), desc: col(['DESCRIPTION', 'DESC']), type: col(['TYPE']), url: col(['URL', 'LINK']), notes: col(['NOTE']) };
  function g(row, k) { return m[k] >= 0 ? String(row[m[k]] || '').trim() : ''; }
  var cats = [], catIndex = {};
  for (var r = 1; r < vals.length; r++) {
    var category = g(vals[r], 'category'), label = g(vals[r], 'label'), desc = g(vals[r], 'desc'), type = g(vals[r], 'type'), url = g(vals[r], 'url'), notes = g(vals[r], 'notes');
    if (!category && !label && !url && !notes) continue;
    if (!category) category = 'Resources';
    if (catIndex[category] == null) { catIndex[category] = cats.length; cats.push({ category: category, _byLabel: {}, items: [] }); }
    var cat = cats[catIndex[category]], k2 = label || url || type || ('row' + r);
    if (cat._byLabel[k2] == null) { cat._byLabel[k2] = cat.items.length; cat.items.push({ label: label, desc: desc, type: type, url: url, notes: notes, subs: [] }); }
    else { var it = cat.items[cat._byLabel[k2]]; if (!it.subs.length) { it.subs.push({ name: it.type || it.label, url: it.url, notes: it.notes }); it.url = ''; it.notes = ''; } it.subs.push({ name: type || label, url: url, notes: notes }); }
  }
  cats.forEach(function (c) { delete c._byLabel; });
  var res = { updated: new Date().toISOString(), categories: cats };
  cachePut_('resources_api', res); return res;
}

/* ================= listings + websites (deals sheet) ================= */
function getListings_() {
  var hit = cacheGet_('listings_api'); if (hit) { hit.cached = true; return hit; }
  var sh = dealsFind_('ACTIVE LISTING') || dealsFind_('LISTING');
  if (!sh || sh.getLastRow() < 2) return { count: 0, rows: [] };
  var rng = sh.getDataRange(), vals = rng.getDisplayValues(), rts = [], fmls = [];
  try { rts = rng.getRichTextValues(); } catch (e) {}
  try { fmls = rng.getFormulas(); } catch (e) {}
  var hdr = vals[0].map(function (h) { return String(h || '').trim().toUpperCase(); });
  var m = headerMap_(hdr, { section:['SECTION'], property:['PROPERTY NAME','PROPERTY'], price:['PRICE'],
    mls:['MLS NO','MLS'], agents:['LISTING AGENTS','AGENTS'], lbx:['LBX CODE'], instructions:['LBX INSTRUCTIONS'],
    showing:['SHOWING TIME'], notice:['NOTICE PERIOD'], other:['LBX OTHER'], status:['STATUS'], link:['LINK','URL'] });
  function g(row, k) { return m[k] >= 0 ? String(row[m[k]] || '').trim() : ''; }
  function linkAt(r, k) { if (m[k] < 0) return ''; var c = m[k]; return cellUrl_(rts[r] ? rts[r][c] : null, fmls[r] ? fmls[r][c] : '', vals[r][c]); }
  var out = [];
  for (var r = 1; r < vals.length; r++) {
    var prop = g(vals[r], 'property'); if (!prop) continue;
    var section = g(vals[r], 'section') || 'Other';
    var link = linkAt(r, 'link') || linkAt(r, 'property') || linkAt(r, 'mls');
    var mlsText = g(vals[r], 'mls'); if (link && /^(link|view|open)$/i.test(mlsText)) mlsText = '';
    // Only the fields the portal actually shows. commission / staging / invoice / post are intentionally omitted.
    out.push({ section: section, exclusive: /exclusive/i.test(section), link: link, property: prop, price: g(vals[r], 'price'),
      mls: mlsText, agents: g(vals[r], 'agents'), lbx: g(vals[r], 'lbx'), instructions: g(vals[r], 'instructions'),
      showing: g(vals[r], 'showing'), notice: g(vals[r], 'notice'), other: g(vals[r], 'other'), status: g(vals[r], 'status') });
  }
  var res = { updated: new Date().toISOString(), count: out.length, rows: out };
  cachePut_('listings_api', res); return res;
}
function getWebsites_() {
  var hit = cacheGet_('websites_api'); if (hit) return hit;
  var sh = dealsFind_('WEBSITE');
  if (!sh || sh.getLastRow() < 2) return { sections: [] };
  var vals = sh.getDataRange().getDisplayValues();
  var hdr = vals[0].map(function (h) { return String(h || '').trim().toUpperCase(); });
  var m = headerMap_(hdr, { section:['SECTION'], name:['NAME'], url:['URL','LINK'] });
  function g(row, k) { return m[k] >= 0 ? String(row[m[k]] || '').trim() : ''; }
  var groups = {}, order = [];
  for (var r = 1; r < vals.length; r++) {
    var name = g(vals[r], 'name'), url = g(vals[r], 'url'); if (!name && !url) continue;
    var sec = g(vals[r], 'section') || 'Other';
    if (groups[sec] == null) { groups[sec] = { section: sec, items: [] }; order.push(sec); }
    groups[sec].items.push({ name: name, url: url });
  }
  var res = { updated: new Date().toISOString(), sections: order.map(function (k) { return groups[k]; }) };
  cachePut_('websites_api', res); return res;
}

/* ================= cities (tab names that look like project tabs) ================= */
function getCities_() {
  var hit = cacheGet_('cities_api'); if (hit) return hit;
  var sheets = ssFor_('main').getSheets(), cities = [];
  for (var i = 0; i < sheets.length; i++) {
    var sh = sheets[i];
    if (sh.getLastRow() < HEADER_ROW || sh.getLastColumn() < 2) continue;
    var ab = sh.getRange(HEADER_ROW, 1, 1, 2).getValues()[0];
    var a = String(ab[0] || '').trim().toUpperCase(), b = String(ab[1] || '').trim().toUpperCase();
    if (a.indexOf('PROJECT') >= 0 && b.indexOf('BUILDER') >= 0) cities.push(sh.getName().trim());
  }
  cities.sort();
  var res = { updated: new Date().toISOString(), count: cities.length, cities: cities };
  cachePut_('cities_api', res); return res;
}

/* ================= LOGIN ================= */
function loginTab_() {
  var sheets = ssFor_('main').getSheets();
  for (var i = 0; i < sheets.length; i++) { var n = sheets[i].getName().toUpperCase().replace(/\s+/g, ''); if (n.indexOf('LOGIN') >= 0 || n.indexOf('REALTOR') >= 0) return sheets[i]; }
  return null;
}
function loginRows_() {
  var sh = loginTab_(); if (!sh || sh.getLastRow() < LOGIN_HEADER_ROW) return [];
  var last = sh.getLastRow();
  var vals = sh.getRange(LOGIN_HEADER_ROW, LOGIN_FIRST_COL, last - LOGIN_HEADER_ROW + 1, LOGIN_NUM_COLS).getDisplayValues();
  function norm(h) { return String(h || '').trim().toLowerCase().replace(/\s+/g, '_'); }
  function canon(h) {
    if (/^(username|user_?name|user_?id|userid|login|user)$/.test(h)) return 'username';
    if (/^(password|pass|pwd|passcode)$/.test(h)) return 'password';
    if (/^(email|e_?mail|email_?id)$/.test(h)) return 'email';
    if (/^(name|full_?name|realtor_?name|agent_?name|realtor|agent)$/.test(h)) return 'name';
    return h;
  }
  var keys = vals[0].map(norm).map(canon), out = [];
  for (var r = 1; r < vals.length; r++) { var o = {}; keys.forEach(function (k, i) { o[k] = vals[r][i]; }); if (o.username) out.push(o); }
  return out;
}
function handleLogin_(p) {
  var user = String(p.user || p.id || p.username || '').trim(), pass = String(p.pass || p.password || '');
  if (!user || !pass) return { ok: false, error: 'missing id or password' };
  if (user.toLowerCase() === ADMIN_ID && pass === ADMIN_PASSCODE) return { ok: true, admin: true, name: 'Admin', role: 'admin', token: makeToken_('admin', 'admin') };
  if (user.toLowerCase() === 'demo' && pass.toLowerCase() === 'demo') return { ok: true, demo: true, name: 'Demo', role: 'demo', token: makeToken_('demo', 'demo') };
  var rows = loginRows_();
  for (var i = 0; i < rows.length; i++) {
    var u = String(rows[i].username || '').trim(), pw = String(rows[i].password || '');
    if (u && u.toLowerCase() === user.toLowerCase() && pw.toLowerCase() === pass.toLowerCase())
      return { ok: true, name: rows[i].name || u, email: rows[i].email || '', role: 'realtor', token: makeToken_(u, 'realtor') };
  }
  return { ok: false, error: 'invalid id or password' };
}
function makeToken_(user, role) {
  var raw = user + '|' + role + '|' + Date.now();
  var sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(raw, TOKEN_SECRET));
  return Utilities.base64EncodeWebSafe(raw) + '.' + sig;
}
function checkToken_(token) {
  var parts = String(token || '').split('.'); if (parts.length !== 2) return null;
  var raw; try { raw = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString(); } catch (e) { return null; }
  var want = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(raw, TOKEN_SECRET));
  if (want !== parts[1]) return null;
  var b = raw.split('|'); return { user: b[0], role: b[1], issued: Number(b[2]) };
}

/* ================= editor helpers ================= */
function listTabs() {
  Object.keys(SHEETS).forEach(function (key) {
    Logger.log('=== ' + key + ' ===');
    try { ssFor_(key).getSheets().forEach(function (s) { Logger.log('  ' + (isAllowed_(key, s.getName()) ? 'ALLOWED ' : 'blocked ') + '[' + s.getName() + ']'); }); }
    catch (err) { Logger.log('  !! ' + err); }
  });
}
function debugLogin() {
  var rows = loginRows_(); Logger.log('total rows = ' + rows.length);
  for (var i = 0; i < rows.length; i++) Logger.log(i + ' user=[' + rows[i].username + '] name=[' + rows[i].name + '] pass_len=' + String(rows[i].password || '').length);
}

/* ================= BASIC READ-ONLY PAGES (all open) ================= */

/* Leaderboard — reads ONLY the pre-synced "Leaderboard" tab (FUB sync stays in the portal). */
function fubStamp_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) return Utilities.formatDate(v, 'America/Toronto', 'MMM d, h:mm a');
  return String(v == null ? '' : v);
}
// Live current year + month (1..12), from the Toronto clock. Rolls over on its own.
function fubYM_() {
  var n = new Date();
  return { y: Number(Utilities.formatDate(n, 'America/Toronto', 'yyyy')),
           m: Number(Utilities.formatDate(n, 'America/Toronto', 'MM')) };   // m = 1..12
}
function fubMonthKey_(y, m) { return 'y' + y + 'm' + (m < 10 ? '0' : '') + m; }
function fubCurKey_() { var t = fubYM_(); return fubMonthKey_(t.y, t.m); }                 // this month, always current
function fubLastKey_() { var t = fubYM_(), y = t.y, m = t.m - 1; if (m < 1) { m = 12; y--; } return fubMonthKey_(y, m); }  // previous month, year-safe
function lbKey_(p) {
  p = String(p || '').trim();
  if (!p || p === 'month') return fubCurKey_();   // always the ongoing month
  if (p === 'last') return fubLastKey_();          // always the month before
  return p;   // 'week' | 'year' | a specific 'y2026m08' from the month picker
}
function getLeaderboard_(key) {
  key = lbKey_(key);
  try {
    var sh = ssFor_('main').getSheetByName('Leaderboard');
    if (!sh || sh.getLastRow() < 2) return { ok: false, error: 'No leaderboard data yet.' };
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues(), list = [], updated = '';
    if (key === 'year') {
      var yr = String(new Date().getFullYear()), by = {};
      for (var r = 0; r < vals.length; r++) {
        var pk = String(vals[r][0] || ''), mm = pk.match(/^y(\d{4})m\d{2}$/);
        if (!mm || mm[1] !== yr) continue;
        var nm = String(vals[r][1] || ''); if (!nm) continue;
        var a = by[nm] || (by[nm] = { name: nm, calls: 0, conv: 0, talkSec: 0 });
        a.calls += Number(vals[r][2]) || 0; a.conv += Number(vals[r][3]) || 0; a.talkSec += Number(vals[r][4]) || 0;
        updated = fubStamp_(vals[r][5]) || updated;
      }
      for (var nk in by) list.push(by[nk]);
    } else {
      for (var r2 = 0; r2 < vals.length; r2++) {
        if (String(vals[r2][0]) !== key) continue;
        updated = fubStamp_(vals[r2][5]) || updated;
        list.push({ name: String(vals[r2][1] || ''), calls: Number(vals[r2][2]) || 0, conv: Number(vals[r2][3]) || 0, talkSec: Number(vals[r2][4]) || 0 });
      }
    }
    if (!list.length) return { ok: false, error: 'No rows for "' + key + '".' };
    list.sort(function (x, y) { return (y.talkSec - x.talkSec) || (y.calls - x.calls); });
    var team = { calls: 0, conv: 0, talkSec: 0 };
    list.forEach(function (a) { team.calls += a.calls; team.conv += a.conv; team.talkSec += a.talkSec; });
    return { ok: true, period: key, updated: updated, team: team, agents: list };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

/* FAQ */
function getFaqs_() {
  var hit = cacheGet_('faqs_api'); if (hit) return hit;
  var sheets = ssFor_('main').getSheets(), sh = null;
  for (var i = 0; i < sheets.length; i++) if (sheets[i].getName().toUpperCase().indexOf('FAQ') >= 0) { sh = sheets[i]; break; }
  if (!sh || sh.getLastRow() < 2) return { count: 0, rows: [] };
  var rng = sh.getDataRange(), disp = rng.getDisplayValues(), rts = [], fmls = [];
  try { rts = rng.getRichTextValues(); } catch (e) {}
  try { fmls = rng.getFormulas(); } catch (e) {}
  var hr = -1;
  for (var r = 0; r < Math.min(6, disp.length) && hr < 0; r++) { if (disp[r].map(function (c) { return String(c || '').trim().toUpperCase(); }).indexOf('QUESTION') >= 0) hr = r; }
  if (hr < 0) hr = 0;
  var hdr = disp[hr].map(function (c) { return String(c || '').trim().toUpperCase(); });
  function col(keys) { for (var c = 0; c < hdr.length; c++) for (var k = 0; k < keys.length; k++) if (hdr[c] === keys[k]) return c; for (var c2 = 0; c2 < hdr.length; c2++) for (var k2 = 0; k2 < keys.length; k2++) if (hdr[c2].indexOf(keys[k2]) >= 0) return c2; return -1; }
  var m = { category: col(['CATEGORY', 'TYPE', 'SECTION']), question: col(['QUESTION', 'Q']), answer: col(['ANSWER', 'RESPONSE']), source: col(['SOURCE', 'LINK', 'URL', 'REFERENCE']) };
  function g(row, k) { return m[k] >= 0 ? String(row[m[k]] || '').trim() : ''; }
  var out = [], lastCat = '';
  for (var r2 = hr + 1; r2 < disp.length; r2++) {
    var q = g(disp[r2], 'question'), cat = g(disp[r2], 'category');
    if (cat) lastCat = cat;
    if (!q) continue;
    var src = g(disp[r2], 'source'), url = '';
    if (m.source >= 0) url = cellUrl_(rts[r2] ? rts[r2][m.source] : null, fmls[r2] ? fmls[r2][m.source] : '', src);
    out.push({ category: (cat || lastCat || 'General'), question: q, answer: g(disp[r2], 'answer'), source: url, sourceText: (url && /^https?:/i.test(src)) ? '' : src });
  }
  var res = { updated: new Date().toISOString(), count: out.length, rows: out };
  cachePut_('faqs_api', res); return res;
}

/* Vacation Tracker */
function getVacations_() {
  var hit = cacheGet_('vacations_api'); if (hit) return hit;
  var sheets = ssFor_('main').getSheets(), sh = null;
  for (var i = 0; i < sheets.length && !sh; i++) if (sheets[i].getName().trim().toUpperCase().indexOf('VACATION') >= 0) sh = sheets[i];
  if (!sh || sh.getLastRow() < 2) return { count: 0, rows: [] };
  var disp = sh.getDataRange().getDisplayValues(), vals = sh.getDataRange().getValues();
  var hr = -1;
  for (var r = 0; r < Math.min(5, disp.length) && hr < 0; r++) { var row = disp[r].map(function (c) { return String(c || '').trim().toUpperCase(); }); if (row.indexOf('NAME') >= 0 && (row.indexOf('FROM') >= 0 || row.indexOf('TO') >= 0)) hr = r; }
  if (hr < 0) hr = 0;
  var hdr = disp[hr].map(function (c) { return String(c || '').trim().toUpperCase(); });
  function col(keys) { for (var c = 0; c < hdr.length; c++) for (var k = 0; k < keys.length; k++) if (hdr[c] === keys[k]) return c; for (var c2 = 0; c2 < hdr.length; c2++) for (var k2 = 0; k2 < keys.length; k2++) if (hdr[c2].indexOf(keys[k2]) >= 0) return c2; return -1; }
  var m = { name: col(['NAME']), from: col(['FROM', 'START']), to: col(['TO', 'END']), reachable: col(['REACHABLE']), remove: col(['REMOVE FROM LEAD FLOW', 'LEAD FLOW', 'REMOVE']), note: col(['NOTE']) };
  function iso(v, text) { if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd'); var d = new Date(String(text || '').trim()); return isNaN(d) ? '' : Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
  function g(row, k) { return m[k] >= 0 ? String(row[m[k]] || '').trim() : ''; }
  var out = [];
  for (var r2 = hr + 1; r2 < disp.length; r2++) {
    var name = g(disp[r2], 'name'); if (!name) continue;
    out.push({ name: name, from: g(disp[r2], 'from'), to: g(disp[r2], 'to'),
      fromISO: m.from >= 0 ? iso(vals[r2][m.from], disp[r2][m.from]) : '', toISO: m.to >= 0 ? iso(vals[r2][m.to], disp[r2][m.to]) : '',
      reachable: g(disp[r2], 'reachable'), remove: g(disp[r2], 'remove'), note: g(disp[r2], 'note') });
  }
  var res = { updated: new Date().toISOString(), count: out.length, rows: out };
  cachePut_('vacations_api', res); return res;
}

/* Call Night (read-only) — names col H (row 2+), date columns I onward, attendance[iso][name]=true */
var CN_NAME_COL = 8, CN_FIRST_DATE_COL = 9;   // H = names, I = first date column
function cnIso_(v) {
  var TZ = 'America/Toronto';
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  var sv = String(v == null ? '' : v).trim(); if (!sv) return '';
  var m = sv.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + '-' + m[2] + '-' + m[3];
  var d = new Date(sv); return isNaN(d) ? '' : Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}
function cnPresent_(v) {
  if (v === true) return true;
  var sv = String(v == null ? '' : v).trim().toLowerCase();
  return sv === 'present' || sv === 'p' || sv === 'yes' || sv === 'y' || sv === 'true' || sv === '1' || sv === 'x' || sv === '\u2713';
}
function callNightSheet_() {
  var ss = ssFor_('main'), sh = ss.getSheetByName('Call Night');
  if (sh) return sh;
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) if (sheets[i].getName().trim().toUpperCase().indexOf('CALL NIGHT') >= 0) return sheets[i];
  return null;
}
function getCallNight_() {
  try {
    var sh = callNightSheet_();
    if (!sh) return { ok: false, error: 'No "Call Night" sheet found.', realtors: [], dates: [], attendance: {} };
    var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    var names = [], nameRows = {};
    if (lastRow >= 2) {
      var nameVals = sh.getRange(2, CN_NAME_COL, lastRow - 1, 1).getValues();
      for (var i = 0; i < nameVals.length; i++) { var n = String(nameVals[i][0] || '').trim(); if (n) { names.push(n); nameRows[n] = i + 2; } }
    }
    var dates = [], dateCols = {};
    if (lastCol >= CN_FIRST_DATE_COL) {
      var hdr = sh.getRange(1, CN_FIRST_DATE_COL, 1, lastCol - CN_FIRST_DATE_COL + 1).getValues()[0];
      for (var c = 0; c < hdr.length; c++) { var iso = cnIso_(hdr[c]); if (iso) { if (!dateCols[iso]) dates.push(iso); dateCols[iso] = CN_FIRST_DATE_COL + c; } }
    }
    dates.sort().reverse();   // newest first
    var attendance = {};
    if (dates.length && names.length) {
      var block = sh.getRange(2, CN_FIRST_DATE_COL, lastRow - 1, lastCol - CN_FIRST_DATE_COL + 1).getValues();
      dates.forEach(function (iso) {
        var colOffset = dateCols[iso] - CN_FIRST_DATE_COL;
        attendance[iso] = {};
        names.forEach(function (n) { attendance[iso][n] = cnPresent_(block[nameRows[n] - 2][colOffset]); });
      });
    }
    return { ok: true, updated: new Date().toISOString(), realtors: names, dates: dates, attendance: attendance };
  } catch (e) { return { ok: false, error: String((e && e.message) || e), realtors: [], dates: [], attendance: {} }; }
}

/* School Finder — region -> board website link */
function getSchoolFinder_() {
  var hit = cacheGet_('schoolfinder_api'); if (hit) return hit;
  var ss = ssFor_('main'), sh = ss.getSheetByName('School');
  if (!sh) { var sheets = ss.getSheets();   // any tab with SCHOOL but not RANK (matches the portal's finder resolver)
    for (var i = 0; i < sheets.length && !sh; i++) { var n = sheets[i].getName().toUpperCase(); if (n.indexOf('SCHOOL') >= 0 && n.indexOf('RANK') < 0) sh = sheets[i]; } }
  var out = [];
  if (sh && sh.getLastRow() >= 1) {
    var vals = sh.getDataRange().getDisplayValues(), start = 0;
    var h0 = String(vals[0][0] || '').toUpperCase(), h1 = String(vals[0][1] || '').toUpperCase();
    if (/REGION|BOARD|AREA|DISTRICT/.test(h0) || /LINK|URL|WEBSITE|SITE/.test(h1)) start = 1;
    for (var r = start; r < vals.length; r++) {
      var region = String(vals[r][0] || '').trim(), url = String(vals[r][1] || '').trim();
      if (!/^https?:\/\//i.test(url)) { for (var c = 1; c < vals[r].length; c++) { var v = String(vals[r][c] || '').trim(); if (/^https?:\/\//i.test(v)) { url = v; break; } } }
      if (!region && !url) continue;
      out.push({ _row: r + 1, region: region, url: url });
    }
  }
  var res = { updated: new Date().toISOString(), count: out.length, rows: out };
  cachePut_('schoolfinder_api', res); return res;
}

/* ================= MEETINGS LEADERBOARD (deals sheet "Meetings" tab) ================= */
var FUB_TZ = 'America/Toronto';
var FUB_MTG_SOLO = 'mandeep';   // skipped when a meeting has a co-agent

/* period -> {start,end} yyyy-MM-dd (null = all time) */
function fubRange_(key) {
  var now = new Date();
  var y = Number(Utilities.formatDate(now, FUB_TZ, 'yyyy')), start, end;
  var mm = String(key).match(/^y(\d{4})m(\d{2})$/);
  if (mm) { var yy = Number(mm[1]), mo = Number(mm[2]) - 1; start = new Date(yy, mo, 1); end = new Date(yy, mo + 1, 0); if (end > now) end = now; }
  else if (key === 'week') { var dow = Number(Utilities.formatDate(now, FUB_TZ, 'u')) % 7; start = new Date(now); start.setDate(now.getDate() - dow); start.setHours(0, 0, 0, 0); end = now; }
  else if (key === 'year') { start = new Date(y, 0, 1); end = now; }
  else if (String(key).match(/^y(\d{4})$/)) { var yr = Number(RegExp.$1); start = new Date(yr, 0, 1); end = new Date(yr, 11, 31); if (end > now) end = now; }
  else { start = new Date(y, now.getMonth(), 1); end = now; }
  return { start: Utilities.formatDate(start, FUB_TZ, 'yyyy-MM-dd'), end: Utilities.formatDate(end, FUB_TZ, 'yyyy-MM-dd') };
}
function fubMtgSheet_() {
  var sheets = ssFor_('deals').getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var nm = sheets[i].getName().trim().toUpperCase();
    if (nm === 'MEETINGS' || (nm.indexOf('MEETING') >= 0 && nm.indexOf('MONTHLY') < 0 && nm.indexOf('STAGE') < 0)) return sheets[i];
  }
  return null;
}
function fubMtgDateISO_(rawVal, dispVal) {
  if (Object.prototype.toString.call(rawVal) === '[object Date]' && !isNaN(rawVal)) return Utilities.formatDate(rawVal, FUB_TZ, 'yyyy-MM-dd');
  var sv = String(dispVal || '').trim(); if (!sv) return '';
  var d = new Date(sv); return isNaN(d) ? '' : Utilities.formatDate(d, FUB_TZ, 'yyyy-MM-dd');
}
function fubIsInternal_(clientName) { return /realtor|agent/.test(String(clientName || '').toLowerCase()); }
function fubSplitAgents_(cell) {
  return String(cell || '').split(/\s*(?:&|\/|,|\band\b|\+)\s*/i).map(function (s) { return s.trim(); }).filter(function (s) { return s.length; });
}
function fubCreditAgent_(agents) {
  if (!agents.length) return '';
  if (agents.length === 1) return agents[0];
  var others = agents.filter(function (a) { return a.toLowerCase().indexOf(FUB_MTG_SOLO) < 0; });
  return others.length ? others[0] : agents[0];
}
function getMeetingsLeaderboard_(key) {
  try {
    key = lbKey_(key);
    var range = (key && key !== 'all') ? fubRange_(key) : null;
    var sh = fubMtgSheet_();
    if (!sh || sh.getLastRow() < 2) return { ok: false, error: 'Meetings tab not found or empty.', agents: [] };
    var rng0 = sh.getDataRange(), vals = rng0.getDisplayValues(), raw = rng0.getValues();
    var hdr = vals[0].map(function (h) { return String(h || '').trim().toUpperCase(); });
    function col(keys) { for (var c = 0; c < hdr.length; c++) for (var k = 0; k < keys.length; k++) if (hdr[c] === keys[k]) return c; for (var c2 = 0; c2 < hdr.length; c2++) for (var k2 = 0; k2 < keys.length; k2++) if (hdr[c2].indexOf(keys[k2]) >= 0) return c2; return -1; }
    var aCol = col(['AGENT', 'REALTOR']), cCol = col(['LEAD', 'CLIENT', 'NAME']), dCol = col(['DATE']), monthCol = col(['MONTH']);
    if (aCol < 0) return { ok: false, error: 'No Agent column in Meetings tab.', agents: [] };
    var counts = {};
    for (var r = 1; r < vals.length; r++) {
      if (range) {
        var iso = '';
        if (dCol >= 0) iso = fubMtgDateISO_(raw[r] ? raw[r][dCol] : null, vals[r][dCol]);
        if (!iso && monthCol >= 0) { var mk = String(vals[r][monthCol] || '').trim(); if (/^\d{4}-\d{2}$/.test(mk)) iso = mk + '-15'; }
        if (!iso) continue;
        if (iso < range.start || iso > range.end) continue;
      }
      if (fubIsInternal_(cCol >= 0 ? vals[r][cCol] : '')) continue;
      var agents = fubSplitAgents_(vals[r][aCol]); if (!agents.length) continue;
      var who = fubCreditAgent_(agents); if (!who) continue;
      counts[who.trim()] = (counts[who.trim()] || 0) + 1;
    }
    var list = []; for (var nm in counts) list.push({ name: nm, meetings: counts[nm] });
    list.sort(function (x, y) { return y.meetings - x.meetings; });
    return { ok: true, period: key || 'all', agents: list };
  } catch (e) { return { ok: false, error: String((e && e.message) || e), agents: [] }; }
}

/* =====================================================================
   BIG CHUNKS: focus/cities index, My Deals, Home payload, Bootcamp
   ===================================================================== */

/* ---------- search index across all city tabs (focus flag lives here) ---------- */
function getSearchIndex_() {
  var hit = cacheGet_('index_api'); if (hit) return hit.rows;
  var cities = getCities_().cities, out = [];
  for (var i = 0; i < cities.length; i++) {
    var c = cities[i], res;
    try { res = getProjects_(c); } catch (e) { res = { rows: [] }; }
    var ps = res.rows || [];
    for (var j = 0; j < ps.length; j++) {
      var p = ps[j];
      if (p.hidden) continue;                                   // "Not Available" excluded
      out.push({ city: c, project: p.project, builder: p.builder, type: p.type, cats: p.cats,
        broker_url: p.broker_url, drive_url: p.drive_url, website_url: p.website_url, hasFub: !!p.fub, _row: p._row,
        focus: /fo(cu|uc)s/i.test(p.status || ''), occupancy: p.occupancy });
    }
  }
  cachePut_('index_api', { rows: out }); return out;
}
function getFocus_() {
  var idx = getSearchIndex_(), out = [];
  for (var i = 0; i < idx.length; i++) if (idx[i].focus) out.push(idx[i]);
  return { updated: new Date().toISOString(), count: out.length, rows: out };
}
function getCityCounts_() {
  var idx = getSearchIndex_(), counts = {};
  for (var i = 0; i < idx.length; i++) { var c = idx[i].city; counts[c] = (counts[c] || 0) + 1; }
  var cities = getCities_().cities, out = [];
  for (var j = 0; j < cities.length; j++) out.push({ city: cities[j], count: counts[cities[j]] || 0 });
  return { updated: new Date().toISOString(), count: out.length, cities: out };
}

/* ---------- guide links from DASHBOARD/HOME ---------- */
function getGuideLinks_() {
  var sheets = ssFor_('main').getSheets(), sh = null;
  for (var i = 0; i < sheets.length && !sh; i++) { var n = sheets[i].getName().toUpperCase(); if (n.indexOf('DASHBOARD') >= 0 || n.indexOf('HOME') >= 0) sh = sheets[i]; }
  var out = { buyers: '', seller: '' };
  if (!sh) return out;
  var rows = Math.min(sh.getLastRow(), 30), cols = Math.min(sh.getLastColumn(), 12);
  if (rows < 1 || cols < 1) return out;
  var rng = sh.getRange(1, 1, rows, cols), disp = rng.getDisplayValues(), rts = [], fmls = [];
  try { rts = rng.getRichTextValues(); } catch (e) {}
  try { fmls = rng.getFormulas(); } catch (e) {}
  for (var r = 0; r < disp.length; r++) for (var c = 0; c < disp[r].length; c++) {
    var txt = String(disp[r][c] || ''), isB = /buy(er)?s?\s*guide/i.test(txt), isS = /sell(er)?s?\s*guide/i.test(txt);
    if (!isB && !isS) continue;
    var url = cellUrl_(rts[r] ? rts[r][c] : null, fmls[r] ? fmls[r][c] : '', txt);
    if (!url) { var nc = c + 1; if (nc < disp[r].length) url = cellUrl_(rts[r] ? rts[r][nc] : null, fmls[r] ? fmls[r][nc] : '', disp[r][nc]); }
    if (!url) { var mu = txt.match(/https?:\/\/\S+/); if (mu) url = mu[0]; }
    if (isB && url && !out.buyers) out.buyers = url;
    if (isS && url && !out.seller) out.seller = url;
  }
  return out;
}

/* ---------- HOME payload (matches the portal's Home) ----------
   Home shows: upcoming events, recent updates, focus projects, and guide links.
   Resources and Concierge (Contractors) are just nav shortcuts in the app -> not
   embedded here. Cities are NOT shown on Home; only their focus projects are. */
function findMainLoose_(keys) {
  var sheets = ssFor_('main').getSheets();
  for (var i = 0; i < sheets.length; i++) { var n = sheets[i].getName().toUpperCase(); for (var k = 0; k < keys.length; k++) if (n.indexOf(keys[k]) >= 0) return sheets[i]; }
  return null;
}
function readLoose_(sh, spec, requireKey) {
  if (!sh || sh.getLastRow() < 2) return [];
  var rng = sh.getDataRange(), disp = rng.getDisplayValues(), raw = rng.getValues(), rts = [], fmls = [];
  try { rts = rng.getRichTextValues(); } catch (e) {}
  try { fmls = rng.getFormulas(); } catch (e) {}
  var hdr = disp[0].map(function (h) { return String(h || '').trim().toUpperCase(); });
  function col(keys) { for (var c = 0; c < hdr.length; c++) for (var k = 0; k < keys.length; k++) if (hdr[c] === keys[k]) return c; for (var c2 = 0; c2 < hdr.length; c2++) for (var k2 = 0; k2 < keys.length; k2++) if (hdr[c2].indexOf(keys[k2]) >= 0) return c2; return -1; }
  var m = {}; for (var f in spec) m[f] = col(spec[f]);
  var dateIdx = (m.date !== undefined) ? m.date : -1;
  var out = [];
  for (var r = 1; r < disp.length; r++) {
    var o = {}, has = false;
    for (var key in m) { var idx = m[key]; var v = idx >= 0 ? String(disp[r][idx] || '').trim() : ''; o[key] = v; if (key === requireKey && v) has = true; }
    if (requireKey && !has) continue;
    // link column: pull real hyperlink if present
    if (m.link >= 0) { var u = cellUrl_(rts[r] ? rts[r][m.link] : null, fmls[r] ? fmls[r][m.link] : '', disp[r][m.link]); if (u) o.link = u; }
    o.iso = dateIdx >= 0 ? dateISO_(raw[r] ? raw[r][dateIdx] : null, disp[r][dateIdx]) : '';
    out.push(o);
  }
  return out;
}
function getHomeEvents_() {
  var events = readLoose_(findMainLoose_(['EVENT']),
    { date: ['DATE', 'WHEN', 'START'], title: ['TITLE', 'EVENT', 'NAME'], time: ['TIME'],
      location: ['LOCATION', 'WHERE', 'VENUE', 'ADDRESS'], details: ['DETAIL', 'DESCRIPTION', 'NOTE'], link: ['LINK', 'URL', 'RSVP'] }, 'title');
  var today = Utilities.formatDate(new Date(), 'America/Toronto', 'yyyy-MM-dd');
  events = events.filter(function (e) { return !e.iso || e.iso >= today; });
  events.sort(function (a, b) { return (a.iso || '9999') < (b.iso || '9999') ? -1 : 1; });
  return events.slice(0, 40);
}
function getHome_() {
  var hit = cacheGet_('home_api_v2'); if (hit) return hit;
  var res = {
    updated: new Date().toISOString(),
    contacts: getContacts_().rows,   // full list; app groups by category
    events: getHomeEvents_(),        // upcoming events
    focus: getFocus_().rows          // focus projects only (no cities)
    // No guides (own page) and no updates (hardcoded in the app HTML).
  };
  cachePut_('home_api_v2', res); return res;
}

/* ===================== MY DEALS (login-gated) ===================== */
var DEALS_TAB = 'DEALS';
function num_(v) { var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }
function year_(v) { var m = String(v == null ? '' : v).match(/(20\d{2})/); return m ? m[1] : ''; }
function pad2_(n) { n = String(n); return n.length < 2 ? '0' + n : n; }
function dateISO_(rawValue, text) {
  var tz = 'America/Toronto';
  if (rawValue instanceof Date && !isNaN(rawValue)) return Utilities.formatDate(rawValue, tz, 'yyyy-MM-dd');
  var t = String(text == null ? '' : text).trim(); if (!t) return '';
  var m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);
  m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) { var a = parseInt(m[1], 10), b = parseInt(m[2], 10), y = parseInt(m[3], 10); if (y < 100) y += 2000; var mo, da; if (a > 12) { da = a; mo = b; } else { mo = a; da = b; } if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) return y + '-' + pad2_(mo) + '-' + pad2_(da); }
  var d = new Date(t); return isNaN(d) ? '' : Utilities.formatDate(d, tz, 'yyyy-MM-dd');
}
function fuKey_(property, client, closing) {
  return [property, client, closing].map(function (x) { return String(x == null ? '' : x).trim().toLowerCase().replace(/\s+/g, ' '); }).join('|');
}
/* resolve the deal-match name from a username (token carries username) */
function matchNameForUser_(username) {
  username = String(username || '').trim(); if (!username) return '';
  var rows = loginRows_();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].username && rows[i].username.toLowerCase() === username.toLowerCase())
      return String(rows[i].deal_name || rows[i].name || rows[i].username || '').trim();
  }
  return '';
}
function getMyDeals_(matchName) {
  matchName = String(matchName || '').trim(); if (!matchName) return [];
  var sh; try { sh = ssFor_('deals').getSheetByName(DEALS_TAB); } catch (e) { return []; }
  if (!sh || sh.getLastRow() < 2) return [];
  var lastCol = Math.max(sh.getLastColumn(), 18);
  var header = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  function findCol(keys) { for (var c = 0; c < header.length; c++) { var h = String(header[c] || '').toUpperCase(); for (var k = 0; k < keys.length; k++) if (h.indexOf(keys[k]) >= 0) return c; } return -1; }
  var clientCol = findCol(['CLIENT']), notesCol = findCol(['NOTE', 'REMARK']), fubCol = findCol(['FUB', 'FOLLOW UP BOSS']), payCol = findCol(['PAYMENT RECEIVED', 'PAYMENT']);
  var rng2 = sh.getRange(2, 1, sh.getLastRow() - 1, lastCol), vals = rng2.getDisplayValues(), rawv = rng2.getValues();
  var mn = matchName.toLowerCase();
  function eq(x) { return String(x == null ? '' : x).trim().toLowerCase() === mn; }
  var out = [];
  for (var r = 0; r < vals.length; r++) {
    var row = vals[r], commIdx = -1;
    if (eq(row[9])) commIdx = 13; else if (eq(row[10])) commIdx = 14; else if (eq(row[11])) commIdx = 15;
    if (commIdx < 0) continue;
    out.push({
      property: String(row[1] || '').trim(), status: String(row[4] || '').trim(), firm: String(row[5] || '').trim(),
      closing: String(row[6] || '').trim(), price: String(row[7] || '').trim(), priceNum: num_(row[7]),
      commission: String(row[commIdx] || '').trim(), commissionNum: num_(row[commIdx]), trs: String(row[17] || '').trim(),
      payment: payCol >= 0 ? String(row[payCol] || '').trim() : String(row[22] || '').trim(), _row: r + 2,
      client: clientCol >= 0 ? String(row[clientCol] || '').trim() : '', notes: notesCol >= 0 ? String(row[notesCol] || '').trim() : '',
      fub: fubCol >= 0 ? String(row[fubCol] || '').trim() : '',
      closingISO: dateISO_(rawv[r] ? rawv[r][6] : null, row[6]), key: fuKey_(row[1], clientCol >= 0 ? row[clientCol] : '', row[6]), year: year_(row[5])
    });
  }
  return out;
}
function getMyLeads_(matchName) {
  matchName = String(matchName || '').trim(); if (!matchName) return [];
  var ss = ssFor_('deals'), sh = null, sheets = ss.getSheets();
  for (var i = 0; i < sheets.length && !sh; i++) { var nm = sheets[i].getName().trim().toUpperCase(); if (nm.indexOf('LEAD CAPACITY') >= 0 || nm === 'LEADS' || nm.indexOf('LEAD') >= 0) sh = sheets[i]; }
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getDataRange().getDisplayValues(), hdr = vals[0].map(function (h) { return String(h || '').trim().toUpperCase(); });
  function col(keys) { for (var c = 0; c < hdr.length; c++) for (var k = 0; k < keys.length; k++) if (hdr[c].indexOf(keys[k]) >= 0) return c; return -1; }
  var m = { date: col(['DATE']), realtor: col(['REALTOR', 'AGENT']), client: col(['CLIENT', 'NAME']), stage: col(['STAGE']), source: col(['LEAD SOURCE', 'SOURCE']), fub: col(['FUB', 'LINK', 'URL']), notes: col(['NOTE']) };
  function g(row, k) { return m[k] >= 0 ? String(row[m[k]] || '').trim() : ''; }
  var mn = matchName.toLowerCase(), out = [];
  for (var r = 1; r < vals.length; r++) {
    if (String(g(vals[r], 'realtor')).toLowerCase() !== mn) continue;
    var client = g(vals[r], 'client'); if (!client && !g(vals[r], 'stage')) continue;
    out.push({ date: g(vals[r], 'date'), realtor: g(vals[r], 'realtor'), client: client, stage: g(vals[r], 'stage'), source: g(vals[r], 'source'), fub: g(vals[r], 'fub'), notes: g(vals[r], 'notes') });
  }
  return out;
}
function getMyMeetings_(matchName) {
  matchName = String(matchName || '').trim(); if (!matchName) return [];
  var sh = fubMtgSheet_(); if (!sh || sh.getLastRow() < 2) return [];
  var rng = sh.getDataRange(), vals = rng.getDisplayValues(), raw = rng.getValues(), rts = [];
  try { rts = rng.getRichTextValues(); } catch (e) {}
  var hdr = vals[0].map(function (h) { return String(h || '').trim().toUpperCase(); });
  function col(keys) { for (var c = 0; c < hdr.length; c++) for (var k = 0; k < keys.length; k++) if (hdr[c] === keys[k]) return c; for (var c2 = 0; c2 < hdr.length; c2++) for (var k2 = 0; k2 < keys.length; k2++) if (hdr[c2].indexOf(keys[k2]) >= 0) return c2; return -1; }
  var m = { month: col(['MONTH']), date: col(['DATE']), time: col(['TIME']), agent: col(['AGENT', 'REALTOR']), lead: col(['LEAD', 'CLIENT', 'NAME']), url: col(['FUB URL', 'FUB', 'URL', 'LINK']), source: col(['SOURCE']), type: col(['TYPE']), outcome: col(['OUTCOME']), status: col(['STATUS']) };
  if (m.lead === m.url) m.url = -1;
  function g(row, k) { return m[k] >= 0 ? String(row[m[k]] || '').trim() : ''; }
  var mn = matchName.toLowerCase(), out = [];
  for (var r = 1; r < vals.length; r++) {
    if (m.agent >= 0 && String(g(vals[r], 'agent')).toLowerCase() !== mn) continue;
    var lead = g(vals[r], 'lead'), diso = m.date >= 0 ? dateISO_(raw[r] ? raw[r][m.date] : null, vals[r][m.date]) : '';
    if (!lead && !diso) continue;
    var monthKey = g(vals[r], 'month'); if (!monthKey && diso) monthKey = diso.slice(0, 7);
    var url = g(vals[r], 'url');
    if (m.url >= 0 && !/^https?:/i.test(url)) url = cellUrl_(rts[r] ? rts[r][m.url] : null, '', vals[r][m.url]);
    out.push({ month: monthKey, dateISO: diso, date: g(vals[r], 'date'), time: g(vals[r], 'time'), lead: lead, fub: url, source: g(vals[r], 'source'), type: g(vals[r], 'type'), outcome: g(vals[r], 'outcome'), status: g(vals[r], 'status') });
  }
  out.sort(function (a, b) { return (b.dateISO || '') < (a.dateISO || '') ? -1 : 1; });
  return out;
}
/* Followup log (read-only) */
var FOLLOWUP_DAYS = 90, FOLLOWUP_FROM_YEAR = 2026;
function followupLog_() {
  var ss = ssFor_('deals'), sh = ss.getSheetByName('Followup Log'), map = {};
  if (sh && sh.getLastRow() > 1) {
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getDisplayValues();
    for (var r = 0; r < vals.length; r++) {
      var k = String(vals[r][0] || '').trim(); if (!k) continue;
      map[k] = { done: /^(y|yes|true|1|done)$/i.test(String(vals[r][5] || '').trim()), updated: String(vals[r][6] || '').trim(), nextISO: dateISO_(null, vals[r][7]) };
    }
  }
  return map;
}
function friendlyDate_(iso) { if (!iso) return ''; var d = new Date(iso + 'T00:00:00'); return isNaN(d) ? iso : Utilities.formatDate(d, 'America/Toronto', 'MMM d, yyyy'); }
function followupsFor_(deals, realtorName) {
  var log = followupLog_(), tz = 'America/Toronto';
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - FOLLOWUP_DAYS);
  var cutISO = Utilities.formatDate(cutoff, tz, 'yyyy-MM-dd'), current = [], future = [];
  for (var i = 0; i < deals.length; i++) {
    var d = deals[i]; if (!d.closingISO) continue;
    if (d.closingISO < FOLLOWUP_FROM_YEAR + '-01-01') continue;
    if (d.closingISO > cutISO) continue;
    var st = log[d.key] || null, days = Math.round((new Date() - new Date(d.closingISO)) / 864e5);
    var row = { key: d.key, property: d.property, client: d.client, closing: d.closing, closingISO: d.closingISO, price: d.price, fub: d.fub, realtor: realtorName || '', days: days };
    if (st && st.done && st.nextISO && st.nextISO > today) { row.nextISO = st.nextISO; row.nextTxt = friendlyDate_(st.nextISO); row.updated = st.updated || ''; future.push(row); }
    else { row.lastContact = (st && st.updated) ? st.updated : ''; current.push(row); }
  }
  current.sort(function (a, b) { return b.days - a.days; });
  future.sort(function (a, b) { return (a.nextISO || '') < (b.nextISO || '') ? -1 : 1; });
  return { current: current, future: future };
}
function myTickets_(username) {
  var u = String(username || '').toLowerCase(), sh = null, sheets = ssFor_('main').getSheets();
  for (var i = 0; i < sheets.length && !sh; i++) if (sheets[i].getName().toUpperCase().indexOf('TICKET') >= 0) sh = sheets[i];
  var rows = readTableSmart_(sh);
  return rows.filter(function (t) { return (t.username || '').toLowerCase() === u; })
    .map(function (t) { return { ticket_id: t.ticket_id, document: t.document, status: t.status || 'Open', raised: t.raised_date, closed: t.closed_date, notes: t.notes }; });
}
function getMyDealsPayload_(p) {
  var tok = checkToken_(p.auth || ''); if (!tok) return { ok: false, error: 'login required' };
  var username = tok.user;
  var matchName = matchNameForUser_(username);
  if (!matchName) return { ok: false, error: 'no deal profile for this user' };
  var deals = []; try { deals = getMyDeals_(matchName); } catch (e) {}
  var leads = []; try { leads = getMyLeads_(matchName); } catch (e) {}
  var followups = { current: [], future: [] }; try { followups = followupsFor_(deals, matchName); } catch (e) {}
  var meetings = []; try { meetings = getMyMeetings_(matchName); } catch (e) {}
  var tickets = []; try { tickets = myTickets_(username); } catch (e) {}
  return { ok: true, name: matchName, username: username, deals: deals, leads: leads, followups: followups, meetings: meetings, tickets: tickets };
}

/* ===================== BOOTCAMP (login-gated, read-only) ===================== */
function onbSS_() { return ssFor_('onboarding'); }
function onbTab_(week) {
  var ss = onbSS_(); if (!ss) return null;
  if (Number(week) === 0) return ss.getSheetByName('Onboarding') || null;
  var sh = ss.getSheetByName('Week ' + week);
  if (!sh && week === 1) { var all = ss.getSheets(); if (all && all.length) sh = all[0]; }
  return sh || null;
}
function onbLinkUrl_(rt, formula) {
  var link = null;
  try { if (rt) { link = rt.getLinkUrl(); if (!link && rt.getRuns) { var runs = rt.getRuns(); for (var k = 0; k < runs.length; k++) { var u = runs[k].getLinkUrl(); if (u) { link = u; break; } } } } } catch (e) {}
  if (!link && formula) { var mm = String(formula).match(/HYPERLINK\(\s*"([^"]+)"/i); if (mm) link = mm[1]; }
  return link || null;
}
function isFill_(bg) { if (!bg) return false; bg = String(bg).toLowerCase().replace(/\s/g, ''); return !(bg === '' || bg === '#ffffff' || bg === '#fff' || bg === 'white' || bg === 'none'); }
function parseTargets_(s) {
  if (!/call|nurtur|home|builder/i.test(s)) return null;
  function n(re) { var m = s.match(re); return m ? Number(m[1]) : null; }
  var calls = n(/(\d+)\s*calls?/i), nur = n(/(\d+)\s*nurtur/i), homes = n(/(\d+)\s*homes?/i), builders = n(/(\d+)\s*builders?/i);
  if (calls == null && nur == null && homes == null && builders == null) return null;
  return [{ nm: 'Outbound calls', unit: 'calls', total: calls || 500 }, { nm: 'Home visits', unit: 'homes', total: homes || 25 }, { nm: 'Builder visits', unit: 'builders', total: builders || 5 }, { nm: 'Nurture leads', unit: 'nurtures', total: nur || 10 }];
}
function getOnboarding_(week) {
  week = Number(week); if (isNaN(week)) week = 1;
  var ck = 'onb_plan_api_' + week, hit = cacheGet_(ck); if (hit) return hit;
  var sh = onbTab_(week);
  if (!sh || sh.getLastRow() < 3) { var min = { n: week, title: (week === 0 ? 'Onboarding' : 'Week ' + week), empty: true, days: [] }; return min; }
  var lastR = sh.getLastRow(), lastC = Math.min(sh.getLastColumn() || 3, 8);
  var rng = sh.getRange(1, 1, lastR, lastC), vals = rng.getDisplayValues(), rich = null, formulas = null, bgs = null;
  try { rich = rng.getRichTextValues(); } catch (e) {}
  try { formulas = rng.getFormulas(); } catch (e) {}
  try { bgs = sh.getRange(1, 1, lastR, 1).getBackgrounds(); } catch (e) {}
  function linkAt(r, c) { return onbLinkUrl_(rich ? rich[r][c] : null, formulas ? formulas[r][c] : ''); }
  var statusCol = 1, notesCol = 2, shotCol = -1, hdrRow = -1;
  for (var r0 = 0; r0 < Math.min(vals.length, 6); r0++) for (var c0 = 0; c0 < lastC; c0++) {
    var v = String(vals[r0][c0] || '').trim().toUpperCase();
    if (v === 'STATUS') { statusCol = c0; hdrRow = r0; } if (v === 'NOTES') { notesCol = c0; if (hdrRow < 0) hdrRow = r0; }
    if (v.indexOf('SCREENSHOT') >= 0 || v.indexOf('PROOF') >= 0 || v.indexOf('SUBMISSION') >= 0 || v.indexOf('SUBMIT') >= 0 || v.indexOf('ATTACH') >= 0 || v.indexOf('UPLOAD') >= 0 || v === 'FILE' || v.indexOf('DOCUMENT') >= 0) shotCol = c0;
  }
  var title = '', focus = '', targets = null, days = [], dayMap = {}, cur = null, expectGoal = false;
  for (var r = 0; r < vals.length; r++) {
    if (r === hdrRow) continue;
    var a = String(vals[r][0] || '').trim(); if (!a) continue;
    if (/^welcome/i.test(a)) { title = a; continue; }
    if (/focus is/i.test(a)) { focus = a.replace(/^.*focus is\s*:?\s*/i, '').trim(); continue; }
    if (/^(status|notes)$/i.test(a)) continue;
    var dm = a.match(/^Day\s*(\d+)/i);
    if (dm) { var dn = Number(dm[1]); if (dayMap[dn]) cur = dayMap[dn]; else { cur = { n: dn, goal: '', tasks: [] }; days.push(cur); dayMap[dn] = cur; } expectGoal = true; continue; }
    if (/^GOAL\b/i.test(a)) {
      var tt = parseTargets_(a);
      if (tt) { targets = tt; continue; }
      if (!cur) { cur = { n: 1, goal: '', tasks: [] }; days.push(cur); }
      cur.tasks.push({ id: 'w' + week + 'd' + cur.n + 't' + cur.tasks.length, title: a.replace(/^GOAL\s*:?\s*/i, ''), url: '', note: '', noteUrl: '', goal: true });
      expectGoal = false; continue;
    }
    var fill = bgs ? isFill_(bgs[r][0]) : false;
    if (fill) { if (expectGoal && cur) { cur.goal = a; expectGoal = false; } continue; }
    expectGoal = false;
    if (!cur) { cur = { n: 1, goal: '', tasks: [] }; days.push(cur); }
    cur.tasks.push({ id: 'w' + week + 'd' + cur.n + 't' + cur.tasks.length, title: a, url: linkAt(r, 0) || '', note: String(vals[r][notesCol] || '').trim(), noteUrl: linkAt(r, notesCol) || '', needShot: shotCol >= 0 ? /^(y|yes|true|1|required|mandatory|need)/i.test(String(vals[r][shotCol] || '').trim()) : false, goal: false });
  }
  if (!days.length) return { n: week, title: title || ('Week ' + week), empty: true, days: [] };
  if (!targets) targets = [{ nm: 'Outbound calls', unit: 'calls', total: 500 }, { nm: 'Home visits', unit: 'homes', total: 25 }, { nm: 'Builder visits', unit: 'builders', total: 5 }, { nm: 'Nurture leads', unit: 'nurtures', total: 10 }];
  var res = { n: week, title: title || ('Week ' + week), focus: focus, targets: targets, days: days };
  cachePut_(ck, res); return res;
}
function onbProgressSheet_() {
  var ss = onbSS_(), sh = ss.getSheetByName('Bootcamp Progress') || ss.getSheetByName('Onboarding Progress');
  return sh || null;
}
function onbProgMap_() { return { ts: 0, user: 1, week: 2, day: 3, id: 4, status: 5, count: 6, notes: 7, proof: 8, dsub: 9, wsub: 10 }; }
function getOnboardingProgress_(user, week) {
  var sh = onbProgressSheet_(), out = { tasks: {}, daysSubmitted: {}, weeksSubmitted: {} };
  if (!sh || sh.getLastRow() < 2) return out;
  var m = onbProgMap_(), rows = sh.getDataRange().getDisplayValues();
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    if (String(row[m.user] || '').toLowerCase() !== String(user).toLowerCase()) continue;
    var w = Number(row[m.week]) || 0; if (week && w !== Number(week)) continue;
    var id = String(row[m.id] || '').trim();
    if (id && id.indexOf('__') !== 0) out.tasks[id] = { status: row[m.status] || 'not', count: Number(row[m.count]) || 0, notes: row[m.notes] || '', proof: row[m.proof] || '' };
    if (row[m.dsub]) out.daysSubmitted[w + '-' + (Number(row[m.day]) || 0)] = row[m.dsub];
    if (row[m.wsub]) out.weeksSubmitted[w] = row[m.wsub];
  }
  return out;
}
function bootcampWhen_(ms) { if (!ms) return ''; try { return Utilities.formatDate(new Date(ms), 'America/Toronto', "yyyy-MM-dd'T'HH:mm:ss"); } catch (e) { return new Date(ms).toISOString(); } }
function bootcampFullName_(user) {
  var rows = loginRows_();
  for (var i = 0; i < rows.length; i++) if (rows[i].username && String(rows[i].username).toLowerCase() === String(user).toLowerCase()) return rows[i].name || '';
  return '';
}
/* Self bootcamp view: plan for a week + this user's progress */
function getBootcampPayload_(p) {
  var tok = checkToken_(p.auth || ''); if (!tok) return { ok: false, error: 'login required' };
  var week = (p.week === undefined || p.week === '') ? 1 : Number(p.week);
  return { ok: true, week: week, plan: getOnboarding_(week), progress: getOnboardingProgress_(tok.user, week) };
}
/* Admin review across weeks 0..4 (admin token only) */
function bootcampReview_(p) {
  var tok = checkToken_(p.auth || ''); if (!tok || tok.role !== 'admin') return { ok: false, error: 'admin only' };
  var sh = onbProgressSheet_(), m = onbProgMap_();
  var plans = {};
  [0, 1, 2, 3, 4].forEach(function (w) { try { var pl = getOnboarding_(w); if (pl && pl.days && pl.days.length) plans[w] = pl; } catch (e) {} });
  var users = {};
  if (sh && sh.getLastRow() >= 2) {
    var rng = sh.getDataRange(), rows = rng.getDisplayValues(), raw = rng.getValues();
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r], u = String(row[m.user] || '').trim(); if (!u || u.indexOf('__') === 0) continue;
      var rec = users[u] || (users[u] = { user: u, prog: {}, daysSubmitted: {}, weeksSubmitted: {}, dayStart: {}, dayLast: {}, last: null });
      var tsRaw = raw[r][m.ts], tsMs = (Object.prototype.toString.call(tsRaw) === '[object Date]' && !isNaN(tsRaw)) ? tsRaw.getTime() : 0;
      if (tsMs && (rec.last === null || tsMs > rec.last)) rec.last = tsMs;
      if (row[m.wsub]) rec.weeksSubmitted[String(row[m.week])] = row[m.wsub];
      if (row[m.dsub]) rec.daysSubmitted[String(row[m.week]) + '-' + String(row[m.day])] = row[m.dsub];
      var id = String(row[m.id] || '').trim();
      if (tsMs && id.indexOf('__') !== 0) { var dkey = String(row[m.week]) + '-' + String(row[m.day]); if (!rec.dayStart[dkey] || tsMs < rec.dayStart[dkey]) rec.dayStart[dkey] = tsMs; if (!rec.dayLast[dkey] || tsMs > rec.dayLast[dkey]) rec.dayLast[dkey] = tsMs; }
      if (id && id.indexOf('__') !== 0) rec.prog[id] = { status: String(row[m.status] || ''), notes: row[m.notes] || '', proof: row[m.proof] || '' };
    }
  }
  var wkeys = Object.keys(plans).map(Number).sort(function (a, b) { return a - b; }), helpAll = [];
  var out = Object.keys(users).map(function (k) {
    var rec = users[k], blocks = [], gDone = 0, gTot = 0, uHelp = [], fullName = bootcampFullName_(rec.user) || rec.user;
    function addBlock(w, day, label, rawTasks, submitted) {
      var tasks = (rawTasks || []).filter(function (t) { return !t.goal; }); if (!tasks.length) return;
      var touched = !!submitted || tasks.some(function (t) { return rec.prog[t.id]; }); if (!touched) return;
      var mapped = tasks.map(function (t) { var pr = rec.prog[t.id] || {}; return { id: t.id, title: t.title, status: pr.status || 'pending', notes: pr.notes || '', proof: pr.proof || '' }; });
      var dn = mapped.filter(function (t) { return t.status === 'done'; }).length;
      mapped.forEach(function (t) { if (t.status === 'help') { uHelp.push({ week: w, day: day, task: t.title }); helpAll.push({ user: rec.user, name: fullName, week: w, day: day, task: t.title }); } });
      blocks.push({ label: label, week: w, day: day, total: mapped.length, done: dn, pct: Math.round(dn / mapped.length * 100), submitted: submitted, started: bootcampWhen_(rec.dayStart[w + '-' + day] || 0), updated: bootcampWhen_(rec.dayLast[w + '-' + day] || 0), tasks: mapped });
      gDone += dn; gTot += mapped.length;
    }
    wkeys.forEach(function (w) {
      var pl = plans[w];
      if (w === 0) { var allT = []; (pl.days || []).forEach(function (d) { (d.tasks || []).forEach(function (t) { allT.push(t); }); }); addBlock(0, 1, 'Onboarding', allT, rec.weeksSubmitted['0'] || ''); }
      else (pl.days || []).forEach(function (d) { addBlock(w, d.n, 'Week ' + w + ' \u00b7 Day ' + d.n, d.tasks || [], rec.daysSubmitted[w + '-' + d.n] || ''); });
    });
    return { user: rec.user, name: fullName, last: bootcampWhen_(rec.last || 0), done: gDone, total: gTot, pct: gTot ? Math.round(gDone / gTot * 100) : 0, help: uHelp.length, helpItems: uHelp, blocks: blocks };
  });
  return { ok: true, users: out, helpMap: helpAll };
}

/* ================= GUIDE REALTORS (Buyer Guide page) =================
   Realtor name (col C) + photo (col E) from the Login tab, starting row 5.
   The buyer's name is a variable typed into the app, not from the sheet.
   Seller Guide is "coming soon" — no link yet. */
var GUIDE_HIDE_ = ['rahul gupta', 'isa aurakeyrealty', 'office admin', 'pramodh chandrashekar', 'amar kaur', 'follow up boss', 'nav sodhi'];
function guideIsAdmin_(name) { return GUIDE_HIDE_.indexOf(String(name || '').trim().toLowerCase()) >= 0; }
function guideThumb_(url) {
  url = String(url || '').trim(); if (!url) return '';
  var m = url.match(/\/d\/([a-zA-Z0-9_-]{20,})/); if (!m) m = url.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  return m ? ('https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w600') : url;
}
function getGuideRealtors_() {
  try {
    var hit = cacheGet_('guiderealtors_api'); if (hit) return hit;
    var sh = loginTab_(), START_ROW = 5, NAME_COL = 2, PHOTO_COL = 4;   // C = name, E = photo
    if (!sh || sh.getLastRow() < START_ROW) return { ok: true, realtors: [] };
    var vals = sh.getDataRange().getDisplayValues(), first = START_ROW - 1, n = vals.length - first;
    if (n < 1) return { ok: true, realtors: [] };
    var rng = sh.getRange(START_ROW, PHOTO_COL + 1, n, 1), disp = rng.getDisplayValues(), rich = rng.getRichTextValues(), formulas = rng.getFormulas();
    var out = [];
    for (var i = 0; i < n; i++) {
      var name = String(vals[first + i][NAME_COL] || '').trim(); if (!name) continue;
      if (guideIsAdmin_(name)) continue;
      var link = cellUrl_(rich[i][0], formulas[i][0], disp[i][0]);
      out.push({ name: name, photo: guideThumb_(link) });
    }
    var res = { ok: true, realtors: out };
    cachePut_('guiderealtors_api', res); return res;
  } catch (e) { return { ok: false, error: String((e && e.message) || e), realtors: [] }; }
}

/* =====================================================================
   SERVER-FETCH PAGES (external APIs, proxied) — finishes the API
   LTB search · Crime records · School address finder (4 boards)
   These reuse the portal's exact logic. Keys stay server-side.
   ===================================================================== */

/* ---------------- LTB (Ontario Open Data) ---------------- */
var LTB_RESOURCE_ID = '86e75d11-1c2c-4cd9-9b0d-9fccec302b30';
var LTB_MIN_YEAR = 2020, LTB_PAGE_SIZE = 500, LTB_API_LIMIT = 100;
var LTB_COL = {
  file:'File Number/Num\u00e9ro de dossier', apps:'Applications/Requ\u00eates', appType:'Application Type/Type de requ\u00eate',
  addr2:'Rental Unit Address//Adresse du logement locatif', complex:'Complex Address/Adresse du complexe',
  addr:'Rental Unit Address/Adresse du logement locatif', landlord:'Landlord Name/Nom du locateur',
  agent:'Landlord Agent Name/Nom du repr\u00e9sentant du locateur', tenant:'Tenant Name/Nom du locataire',
  former:'Former Tenant Name/Nom de l\u2019ancien locataire', subten:'Sub-Tenant Name/Nom du sous-locataire',
  occ:'Occupant Names/Nom de l\u2019occupant', coop:'Co-op Member Name/Nom du membre de la cooperative',
  coopNm:'Co-op Name/Nom de la cooperative', docType:'Document Type/Type de document',
  date:'Order Date/Date de l\u2019ordonnance', docId:'Document ID/Identifiant du document', dl:'ContentDownload URL/URL de t\u00e9l\u00e9chargement du contenu'
};
function getLTB_(query, offset) {
  query = String(query || '').trim();
  if (query.length < 2) return { ok: false, error: 'Enter at least 2 characters.' };
  offset = Math.max(0, parseInt(offset, 10) || 0);
  try {
    var out = [], scanned = 0, total = 0, pages = Math.ceil(LTB_PAGE_SIZE / LTB_API_LIMIT), p = 0;
    while (p++ < pages) {
      var url = 'https://data.ontario.ca/api/3/action/datastore_search?resource_id=' + encodeURIComponent(LTB_RESOURCE_ID)
        + '&q=' + encodeURIComponent(query) + '&limit=' + LTB_API_LIMIT + '&offset=' + (offset + scanned);
      var r = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
      if (r.getResponseCode() !== 200) { if (scanned === 0) return { ok: false, error: 'Data service returned ' + r.getResponseCode() + '.' }; break; }
      var j; try { j = JSON.parse(r.getContentText()); } catch (e) { break; }
      if (!j || !j.success) break;
      total = j.result.total || 0;
      var recs = j.result.records || [];
      for (var i = 0; i < recs.length; i++) { var n = ltbNorm_(recs[i], query); if (n.year && n.year >= LTB_MIN_YEAR) out.push(n); }
      scanned += recs.length;
      if (offset + scanned >= total || recs.length < LTB_API_LIMIT) break;
    }
    var next = offset + scanned;
    return { ok: true, total: total, records: out, scannedTo: next, hasMore: next < total, offset: offset };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}
function ltbNorm_(rec, query) {
  function g(k) { var v = rec[LTB_COL[k]]; return v == null ? '' : String(v).trim(); }
  var appType = g('appType').toUpperCase(), date = g('date'), year = 0, m = date.match(/(\d{4})/); if (m) year = parseInt(m[1], 10);
  var tenant = g('tenant') || g('former') || g('subten'), address = g('addr') || g('addr2'), q = query.toLowerCase();
  var nameBlob = (g('tenant') + ' ' + g('former') + ' ' + g('subten') + ' ' + g('occ') + ' ' + g('landlord') + ' ' + g('agent') + ' ' + g('coop')).toLowerCase();
  var addrBlob = (address + ' ' + g('complex')).toLowerCase();
  return { file: g('file'), appCode: g('apps'), appType: appType, typeLabel: ltbTypeLabel_(appType, g('apps')), date: date, year: year,
    address: address, complexAddress: g('complex'), landlord: g('landlord'), agent: g('agent'), tenant: tenant, occupants: g('occ'),
    coop: g('coop'), coopName: g('coopNm'), docType: g('docType'), pdf: ltbUrl_(g('dl')), flag: appType === 'L',
    matchName: nameBlob.indexOf(q) >= 0, matchAddr: addrBlob.indexOf(q) >= 0 };
}
function ltbTypeLabel_(appType, code) { if (appType === 'L') return 'Landlord application (L)'; if (appType === 'T') return 'Tenant application (T)'; if (appType === 'C') return 'Co-op application (C)'; return code || 'Order'; }
function ltbUrl_(v) { v = String(v || ''); var m = v.match(/HYPERLINK\s*\(\s*"([^"]+)"/i); if (m) return m[1]; var u = v.match(/https?:\/\/\S+/); return u ? u[0] : ''; }

/* ---------------- CRIME (crimemaps.ca via Referer proxy) ---------------- */
var CRIME_BASE = 'https://crimemaps.ca/api/data/', CRIME_REFERER = 'https://crimemaps.ca/', CRIME_CACHE_MIN = 60;
function crimeHeaders_() { return { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'Referer': CRIME_REFERER, 'Accept': 'application/json,text/plain,*/*', 'Accept-Language': 'en-US,en;q=0.9' }; }
function crimeFetchJson_(file) { var res = UrlFetchApp.fetch(CRIME_BASE + file, { headers: crimeHeaders_(), muteHttpExceptions: true, followRedirects: true }); if (res.getResponseCode() !== 200) throw new Error('crimemaps ' + file + ' -> HTTP ' + res.getResponseCode()); return JSON.parse(res.getContentText()); }
function getCrimeCity_(slug) {
  slug = String(slug || '').toLowerCase().trim(); if (!slug) return { ok: false, error: 'No city given.' };
  try {
    var cache = CacheService.getScriptCache(), ck = 'crime_city_' + slug, hit = cache.get(ck);
    if (hit) { var o = JSON.parse(hit); o.cached = true; return o; }
    var agg = crimeGetAgg_(), win = crimeGetWin_();
    var city = (agg.byCity || {})[slug] || null, wcity = win[slug] || null;
    if (!city && !wcity) return { ok: false, error: 'City "' + slug + '" not found in crime data.' };
    var out = { ok: true, slug: slug, city: city, win: wcity };
    try { cache.put(ck, JSON.stringify(out), CRIME_CACHE_MIN * 60); } catch (e) {}
    return out;
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}
function getCrimeCities_() {
  try { var agg = crimeGetAgg_(), out = [], bc = agg.byCity || {}; for (var slug in bc) out.push({ slug: slug, name: bc[slug].name, province: bc[slug].province }); return { ok: true, cities: out }; }
  catch (e) { return { ok: false, error: String((e && e.message) || e), cities: [] }; }
}
function crimeGetAgg_() {
  var prop = PropertiesService.getScriptProperties(), cached = crimeReadChunked_('crime_agg'), stamp = prop.getProperty('crime_agg_stamp');
  if (cached && stamp && (Date.now() - Number(stamp) < CRIME_CACHE_MIN * 60 * 1000)) return cached;
  var data = crimeFetchJson_('aggregates.json'); try { crimeWriteChunked_('crime_agg', data); prop.setProperty('crime_agg_stamp', String(Date.now())); } catch (e) {} return data;
}
function crimeGetWin_() {
  var prop = PropertiesService.getScriptProperties(), cached = crimeReadChunked_('crime_win'), stamp = prop.getProperty('crime_win_stamp');
  if (cached && stamp && (Date.now() - Number(stamp) < CRIME_CACHE_MIN * 60 * 1000)) return cached;
  var data = crimeFetchJson_('window-city.json'); try { crimeWriteChunked_('crime_win', data); prop.setProperty('crime_win_stamp', String(Date.now())); } catch (e) {} return data;
}
function crimeWriteChunked_(prefix, obj) { var cache = CacheService.getScriptCache(), s = JSON.stringify(obj), size = 90000, n = Math.ceil(s.length / size); if (n > 300) return; var map = {}; for (var i = 0; i < n; i++) map[prefix + '_' + i] = s.substr(i * size, size); map[prefix + '_n'] = String(n); cache.putAll(map, CRIME_CACHE_MIN * 60); }
function crimeReadChunked_(prefix) { var cache = CacheService.getScriptCache(), nStr = cache.get(prefix + '_n'); if (!nStr) return null; var n = Number(nStr), keys = []; for (var i = 0; i < n; i++) keys.push(prefix + '_' + i); var got = cache.getAll(keys), s = ''; for (var j = 0; j < n; j++) { var part = got[prefix + '_' + j]; if (part == null) return null; s += part; } try { return JSON.parse(s); } catch (e) { return null; } }

/* ---------------- SCHOOL ADDRESS FINDER (Peel/Halton/Durham/York) ---------------- */
var FS_YEAR = 2026, FS_SPS_BASE = 'https://api.spsplus.ca/api/v3/Search', FS_YORK_BASE = 'https://schoollocator.yrdsb.ca/ws/api';
var FS_BOARDS = {
  peel:   { id:'peel',   name:'Peel Region',   sys:'sps',  key:'00f4b315-24e5-4a05-8894-91148c612e0e', origin:'https://www.peelschools.org', locator:'https://schoolfinder.peelschools.org/' },
  halton: { id:'halton', name:'Halton Region', sys:'sps',  key:'6b72823a-348c-4f9a-a904-fa1f4736a2f4', origin:'https://www.hdsb.ca', locator:'https://www.hdsb.ca/schools/Pages/find-your-local-school.aspx' },
  durham: { id:'durham', name:'Durham Region', sys:'sps',  key:'3a8fe81d-15e9-0166-9492-2ac5fcc5f5c0', origin:'https://www.ddsb.ca', locator:'https://www.ddsb.ca/en/schools/find-your-school.aspx' },
  york:   { id:'york',   name:'York Region',   sys:'york', key:'WLxv!Z3R96Q#CUc!', origin:'https://schoollocator.yrdsb.ca', locator:'https://schoollocator.yrdsb.ca/' }
};
function fsBoards_() { var out = []; for (var k in FS_BOARDS) { var b = FS_BOARDS[k]; if (b.sys === 'link' || b.key) out.push({ id: b.id, name: b.name, needsNumber: b.sys === 'york', linkOnly: b.sys === 'link', url: b.url || '', locator: b.locator || '' }); } return out; }
function fsSpsHeaders_(b) { return { 'x-api-key': b.key, 'x-api-version': '3.0', 'Origin': b.origin }; }
function fsPick_(o, names) { if (!o) return ''; for (var i = 0; i < names.length; i++) if (o[names[i]] != null) return o[names[i]]; var low = {}; for (var k in o) low[k.toLowerCase()] = o[k]; for (var j = 0; j < names.length; j++) { var v = low[String(names[j]).toLowerCase()]; if (v != null) return v; } return ''; }
function fsFetchJson_(url, opts, retries) { retries = retries || 1; for (var i = 0; i <= retries; i++) { try { var r = UrlFetchApp.fetch(url, opts), code = r.getResponseCode(); if (code >= 200 && code < 300) { var t = r.getContentText(); if (!t) { Utilities.sleep(250); continue; } var j = JSON.parse(t); if (Array.isArray(j) && j.length === 0 && i < retries) { Utilities.sleep(250); continue; } return j; } } catch (e) {} if (i < retries) Utilities.sleep(250); } return null; }
function fsExpandAddr_(a) {
  a = String(a || '');
  var END = '(?=\\s*(?:[NSEW]{1,2}\\b\\s*)?(?:,|$))';   // last token of street part, allowing an optional N/S/E/W
  var map = [['St','Street'],['Rd','Road'],['Ave','Avenue'],['Av','Avenue'],['Dr','Drive'],['Blvd','Boulevard'],
    ['Cres','Crescent'],['Cresc','Crescent'],['Crt','Court'],['Ct','Court'],['Pl','Place'],['Ln','Lane'],
    ['Hwy','Highway'],['Trl','Trail'],['Terr','Terrace'],['Ter','Terrace'],['Sq','Square'],['Cir','Circle'],
    ['Circ','Circle'],['Pkwy','Parkway'],['Gdns','Gardens'],['Gdn','Gardens'],['Grv','Grove'],['Hts','Heights'],['Way','Way']];
  for (var i = 0; i < map.length; i++) {
    a = a.replace(new RegExp('\\b' + map[i][0] + '\\.?' + END, 'gi'), map[i][1]);
  }
  return a.replace(/\s+/g, ' ').trim();
}
function fsSuggest_(boardId, text) {
  text = fsExpandAddr_(text); if (text.length < 3) return []; var b = FS_BOARDS[boardId]; if (!b) return [];
  if (b.sys === 'sps') { var res = fsFetchJson_(FS_SPS_BASE + '/SuggestAddresses?searchText=' + encodeURIComponent(text), { method: 'get', headers: fsSpsHeaders_(b), muteHttpExceptions: true }, 2) || []; return res.map(function (a) { return { id: String(fsPick_(a, ['addressId', 'id'])), label: String(fsPick_(a, ['displayAddress', 'address', 'fullAddress'])) }; }).filter(function (a) { return a.label; }); }
  if (b.sys === 'york') { var res2 = fsFetchJson_(FS_YORK_BASE + '/AddressLists', { method: 'post', contentType: 'application/json', headers: { 'apikey_0': b.key }, payload: JSON.stringify({ name: text }), muteHttpExceptions: true }, 1) || []; return res2.map(function (a) { return { id: '', label: String(fsPick_(a, ['streetAndMunicipality', 'address', 'display'])) }; }).filter(function (a) { return a.label; }); }
  return [];
}
function fsLookup_(boardId, fullAddress, houseNumber) {
  var b = FS_BOARDS[boardId]; if (!b) return { ok: false, error: 'Unknown region.' };
  if (b.sys === 'link') return { ok: true, board: b.name, linkOnly: true, link: b.url, schools: [] };
  fullAddress = fsExpandAddr_(fullAddress); if (fullAddress.length < 4) return { ok: false, error: 'Enter a full address.' };
  try {
    if (b.sys === 'sps') {
      var sug = fsFetchJson_(FS_SPS_BASE + '/SuggestAddresses?searchText=' + encodeURIComponent(fullAddress), { method: 'get', headers: fsSpsHeaders_(b), muteHttpExceptions: true }, 2) || [];
      if (!sug.length) return { ok: false, error: 'That address wasn\u2019t found in ' + b.name + '.' };
      var best = fsBestMatch_(sug, fullAddress), addressId = String(fsPick_(best, ['addressId', 'id']));
      if (!addressId) return { ok: false, error: 'Could not resolve that address.' };
      var schools = fsSpsSchools_(b, addressId); fsAttachRank_(schools);
      return { ok: true, board: b.name, matched: String(fsPick_(best, ['displayAddress', 'address'])) || fullAddress, schools: schools };
    }
    if (b.sys === 'york') {
      var p = fsParseAddress_(fullAddress, houseNumber); if (!p.street) return { ok: false, error: 'Enter a street name.' };
      var schools2 = fsYorkSchools_(b, p.street + ', ' + p.municipality, p.number); fsAttachRank_(schools2);
      return { ok: true, board: b.name, matched: fullAddress, schools: schools2 };
    }
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  return { ok: false, error: 'Unsupported region.' };
}
function fsSchools_(boardId, addressId, addressLabel, houseNumber) {
  var b = FS_BOARDS[boardId]; if (!b) return { ok: false, error: 'Unknown region.' };
  if (b.sys === 'link') return { ok: true, board: b.name, linkOnly: true, link: b.url, schools: [] };
  var schools;
  try { if (b.sys === 'sps') schools = fsSpsSchools_(b, addressId); else if (b.sys === 'york') schools = fsYorkSchools_(b, addressLabel, houseNumber); else return { ok: false, error: 'Unsupported region.' }; }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  fsAttachRank_(schools); return { ok: true, board: b.name, schools: schools };
}
function fsBestMatch_(list, text) { var t = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim(); for (var i = 0; i < list.length; i++) { var d = String(fsPick_(list[i], ['displayAddress', 'address'])).toLowerCase().replace(/\s+/g, ' ').trim(); if (d === t) return list[i]; } for (var j = 0; j < list.length; j++) { var d2 = String(fsPick_(list[j], ['displayAddress', 'address'])).toLowerCase(); if (d2 && (d2.indexOf(t) >= 0 || t.indexOf(d2) >= 0)) return list[j]; } return list[0]; }
function fsParseAddress_(full, houseNumber) { var parts = String(full || '').split(','), first = String(parts[0] || '').trim(), municipality = parts.slice(1).join(',').trim(); var num = String(houseNumber || '').trim(), street = first, m = first.match(/^\s*(\d+[A-Za-z]?)\s+(.+)$/); if (m) { if (!num) num = m[1]; street = m[2].trim(); } return { number: num, street: street, municipality: municipality }; }
function fsSpsSchools_(b, addressId) {
  addressId = String(addressId || '').trim(); if (!addressId) return [];
  var near = fsFetchJson_(FS_SPS_BASE + '/GetSchoolListByAddress?addressId=' + encodeURIComponent(addressId) + '&schoolYear=' + FS_YEAR, { method: 'get', headers: fsSpsHeaders_(b), muteHttpExceptions: true }, 2) || [];
  if (!near.length) return [];
  var dir = fsSpsDirectory_(b), out = [], seen = {};
  function pushRow_(sid, code, name, ranges, gLow, gHigh, full) {
    var track = fsTrack_(name || code, '', []); if (!track) return;
    var grades = fsGradeRanges_(ranges); if (!grades && (gLow || gHigh)) grades = fsCleanGrades_((gLow || '?') + '-' + (gHigh || '?'));
    var coords = fsParseGeo_(fsPick_(full, ['locationGeoJson', 'geoJson', 'location']));
    var norm = fsNormalize_({ name: fsPick_(full, ['schoolName', 'name']) || '', program: track, grades: grades, address: fsPick_(full, ['address1', 'address']), city: fsPick_(full, ['city', 'municipalityName']), community: fsPick_(full, ['municipalityName', 'city']), postal: fsPick_(full, ['postalCode', 'postal']), phone: fsPick_(full, ['phoneNumber', 'phone']), principal: fsPick_(full, ['principalName']), type: fsPick_(full, ['schoolTypeName', 'schoolType']), lat: coords.lat, lng: coords.lng, board: b.name });
    norm.track = track; var key = (String(sid) + '|' + track + '|' + norm.grades).toUpperCase(); if (seen[key]) return; seen[key] = norm; out.push(norm);
  }
  for (var i = 0; i < near.length; i++) {
    var n = near[i], sid = String(fsPick_(n, ['schoolId', 'id'])), full = dir[sid] || n, pts = fsPick_(n, ['programTypes']);
    if (pts && pts.length) { for (var pp = 0; pp < pts.length; pp++) { var pt = pts[pp]; pushRow_(sid, fsPick_(pt, ['programTypeCode']), fsPick_(pt, ['programTypeName', 'name']), fsPick_(pt, ['gradeRanges']), '', '', full); } }
    else pushRow_(sid, fsPick_(n, ['programTypeCode']), fsPick_(n, ['programTypeName']), fsPick_(n, ['gradeRanges']), fsPick_(n, ['gradeLow']), fsPick_(n, ['gradeHigh']), full);
  }
  return out;
}
function fsGradeRanges_(ranges) { if (!ranges || !ranges.length) return ''; var lows = [], highs = []; for (var i = 0; i < ranges.length; i++) { var lo = fsPick_(ranges[i], ['low', 'lowGrade', 'from']), hi = fsPick_(ranges[i], ['high', 'highGrade', 'to']); if (lo !== '') lows.push(String(lo)); if (hi !== '') highs.push(String(hi)); } if (!lows.length && !highs.length) return ''; return fsCleanGrades_((lows[0] || '?') + '-' + (highs[highs.length - 1] || '?')); }
function fsGrades_(n, full) { var names = ['grades', 'gradeRange', 'gradeLevel', 'gradeLevels', 'gradesRange', 'gradeRangeText', 'grade', 'gradesText', 'gradesTaught', 'gradeSpan', 'gradeCategory']; var g = String(fsPick_(n, names) || fsPick_(full, names) || '').trim(); if (g) return fsCleanGrades_(g); var loN = ['lowGrade', 'gradeLow', 'gradeFrom', 'minGrade', 'startGrade', 'fromGrade', 'gradeStart'], hiN = ['highGrade', 'gradeHigh', 'gradeTo', 'maxGrade', 'endGrade', 'toGrade', 'gradeEnd']; var lo = String(fsPick_(n, loN) || fsPick_(full, loN) || '').trim(), hi = String(fsPick_(n, hiN) || fsPick_(full, hiN) || '').trim(); if (lo || hi) return fsCleanGrades_((lo || '?') + '-' + (hi || '?')); return ''; }
function fsCleanGrades_(g) { g = String(g).toUpperCase().replace(/GRADE[S]?/g, '').replace(/\s*TO\s*/g, '-').replace(/\s+/g, ' ').trim(); g = g.replace(/\bJUNIOR\s*KINDERGARTEN\b|\bJUNIOR\s*K\b/g, 'JK').replace(/\bSENIOR\s*KINDERGARTEN\b|\bSENIOR\s*K\b/g, 'SK').replace(/\bKINDERGARTEN\b/g, 'K'); return g.replace(/\s*-\s*/g, '-'); }
function fsTrack_(program, name, programs) { var p = String(program || '').toUpperCase(); if (/EXTENDED\s*FRENCH|\bEF\b/.test(p)) return 'Extended French Track'; if (/FRENCH\s*IMMERSION|\bFI\b|IMMERSION/.test(p)) return 'French Immersion Track'; if (/GIFTED|ENRICH/.test(p)) return 'Gifted / Enriched'; if (/REGULAR|ENGLISH|CORE|\bRT\b|\bDUAL\b/.test(p)) return 'Regular Track'; if (String(program || '').trim()) return String(program).trim(); if (programs && programs.indexOf('French Immersion') >= 0) return 'French Immersion'; return 'Regular Track'; }
function fsSpsDirectory_(b) { var ck = 'fsdir_' + b.id, hit = cacheReadBig_(ck); if (hit) { try { return JSON.parse(hit); } catch (e) {} } var list = fsFetchJson_(FS_SPS_BASE + '/GetSchoolList?schoolYear=' + FS_YEAR, { method: 'get', headers: fsSpsHeaders_(b), muteHttpExceptions: true }, 2) || []; var byId = {}; for (var i = 0; i < list.length; i++) { var s = list[i], sid = fsPick_(s, ['schoolId', 'id']); if (s && sid !== '') byId[String(sid)] = s; } try { cacheWriteBig_(ck, JSON.stringify(byId), 21600); } catch (e) {} return byId; }
function fsParseGeo_(g) { try { var a = JSON.parse(g); if (typeof a === 'string') a = JSON.parse(a); if (a && a.coordinates) a = a.coordinates; if (a && a.length >= 2) return { lng: Number(a[0]), lat: Number(a[1]) }; } catch (e) {} return { lat: '', lng: '' }; }
function fsYorkSchools_(b, addressLabel, houseNumber) {
  var parts = String(addressLabel || '').split(','), streetName = String(parts[0] || '').trim(), municipality = parts.slice(1).join(',').trim(); if (!streetName) return [];
  var body = { streetName: streetName, streetNumber: String(houseNumber || '').trim(), municipality: municipality, elementary_flag: true, secondary_flag: true, elem_fi_flag: true, sec_fi_flag: true, sec_art_flag: true, ib_flag: true, ifReturnSchoolYear: true };
  var res = fsFetchJson_(FS_YORK_BASE + '/SchoolsProfiles', { method: 'post', contentType: 'application/json', headers: { 'apikey_0': b.key }, payload: JSON.stringify(body), muteHttpExceptions: true }, 1) || [];
  var out = [];
  for (var i = 0; i < res.length; i++) { var s = res[i], phone = [fsPick_(s, ['area_code', 'areaCode']), fsPick_(s, ['phone_no', 'phoneNo', 'phone'])].filter(function (x) { return x; }).join('-'); var prog = []; if (fsPick_(s, ['elem_fi_flag', 'sec_fi_flag'])) prog.push('FI'); if (fsPick_(s, ['ib_flag'])) prog.push('IB'); if (fsPick_(s, ['sec_art_flag'])) prog.push('Arts'); out.push(fsNormalize_({ name: fsPick_(s, ['school_name', 'schoolName', 'name']), address: fsPick_(s, ['school_address', 'address']), phone: phone, grades: fsGrades_(s, s), lat: fsPick_(s, ['latitude', 'lat']), lng: fsPick_(s, ['longitude', 'lng']), type: fsPick_(s, ['school_type_code', 'schoolTypeCode', 'type']), program: prog.join(' '), board: b.name })); }
  return out;
}
function fsNormalize_(s) { var grades = fsCleanGrades_(s.grades || ''); return { school: String(s.name || '').trim(), address: String(s.address || '').trim(), city: String(s.city || '').trim(), postal: String(s.postal || '').trim(), phone: String(s.phone || '').trim(), principal: String(s.principal || '').trim(), grades: grades, level: fsLevel_(grades, s.name), type: fsType_(s.type, s.name), programs: fsPrograms_(s.program, s.name), track: fsTrack_(s.program, s.name, fsPrograms_(s.program, s.name)), board: String(s.board || '').trim(), lat: s.lat, lng: s.lng, community: String(s.community || '').trim(), rank: '', score: '' }; }
function fsLevel_(grades, name) { var g = ' ' + String(grades || '').toUpperCase() + ' ', n = String(name || '').toUpperCase(); var gHigh = /\b(9|10|11|12)\b/.test(g), gElem = /\b(JK|SK|K|1|2|3|4|5|6|7|8)\b/.test(g); var hasHigh = gHigh || (!gElem && /SECONDARY|\bHIGH\b|\bH\.?S\.?\b|\bS\.?S\.?\b|\bC\.?I\.?\b|COLLEGIATE|\bACADEMY\b/.test(n)); var hasElem = gElem || (!gHigh && /ELEMENTARY|PUBLIC SCHOOL|\bP\.?S\.?\b/.test(n)); if (hasHigh && hasElem) return 'Intermediate'; if (hasHigh) return 'Secondary'; return 'Elementary'; }
function fsType_(t, name) { var s = (String(t || '') + ' ' + String(name || '')).toUpperCase(); if (s.indexOf('CATHOLIC') >= 0 || /\bST\.?\b|\bSAINT\b|\bHOLY\b|OUR LADY|\bPOPE\b|\bBLESSED\b/.test(s)) return 'Catholic'; if (s.indexOf('PRIVATE') >= 0 || s.indexOf('INDEPENDENT') >= 0) return 'Private'; if (s.indexOf('FRENCH') >= 0 && s.indexOf('IMMERSION') < 0) return 'French'; return 'Public'; }
function fsPrograms_(program, name) { var s = (String(program || '') + ' ' + String(name || '')).toUpperCase(), out = []; if (/FRENCH IMMERSION|\bFI\b|IMMERSION/.test(s)) out.push('French Immersion'); if (/\bIB\b|INTERNATIONAL BACC/.test(s)) out.push('IB'); if (/\bARTS?\b|\bSTEM\b|\bAP\b/.test(s)) out.push('Arts / Specialty'); return out; }
function fsNormName_(s) { return String(s || '').toUpperCase().replace(/\b(CATHOLIC|PUBLIC|ELEMENTARY|SECONDARY|SCHOOL|SENIOR|JUNIOR|SR|JR|MIDDLE|ACADEMY|P\.?S\.?|C\.?S\.?|S\.?S\.?|E\.?S\.?|C\.?I\.?|H\.?S\.?)\b/g, ' ').replace(/[^A-Z0-9]+/g, ' ').trim(); }
function fsAttachRank_(schools) { if (!schools || !schools.length) return; var rank = {}; try { var res = readTab_('School Rankings', 'main', ''); var rows = (res && res.rows) ? res.rows : []; for (var i = 0; i < rows.length; i++) { var nm = rows[i].SCHOOL || rows[i].School || rows[i].school; var k = fsNormName_(nm); if (k && !rank[k]) rank[k] = rows[i]; } } catch (e) {} for (var j = 0; j < schools.length; j++) { var m = rank[fsNormName_(schools[j].school)]; if (m) { schools[j].rank = m.RANK || m.rank || ''; schools[j].score = m.SCORE || m.score || ''; schools[j].community = m.COMMUNITY || m.community || ''; if (!schools[j].city) schools[j].city = m.CITY || m.city || ''; } } }

/* Big-cache helpers for the school directory (reuse crime chunking) */
function cacheWriteBig_(key, str, ttl) { var cache = CacheService.getScriptCache(), size = 90000, n = Math.ceil(str.length / size); if (n > 300) return; var map = {}; for (var i = 0; i < n; i++) map[key + '_' + i] = str.substr(i * size, size); map[key + '_n'] = String(n); cache.putAll(map, ttl || 21600); }
function cacheReadBig_(key) { var cache = CacheService.getScriptCache(), nStr = cache.get(key + '_n'); if (!nStr) return null; var n = Number(nStr), keys = []; for (var i = 0; i < n; i++) keys.push(key + '_' + i); var got = cache.getAll(keys), s = ''; for (var j = 0; j < n; j++) { var part = got[key + '_' + j]; if (part == null) return null; s += part; } return s; }

/* =====================================================================
   BASEMENT CHECK — municipal registration lookup (agent-facing)
   Output is a CLIENT SCRIPT, never a legal verdict. "Legal" is never used.
   Tier A live ArcGIS: Brampton + Oshawa (same adapter, different config).
   Other cities: PERMIT_ON_FILE (Toronto/Vaughan) or NOT_COVERED.
   ===================================================================== */
var BC_CFG = {
  brampton: { name: 'Brampton', tier: 'A', kind: 'arcgis', itemId: '7d9df6528d474b43b6771cb7feefc35e', layer: 0,
              source: 'Brampton GeoHub — Registered Additional Residential Units', asOf: 'updated daily' },
  oshawa:   { name: 'Oshawa', tier: 'A', kind: 'arcgis', serviceUrl: 'https://opendata.arcgis.com/datasets/97d92126eeae4430885d6225df0ff2a0_0/FeatureServer/0', addrField: 'Property_Address', dateFields: { 'Certificate issued': 'Date_Certificate_was_Issued' },
              source: 'Oshawa Open Data — Registered Two Unit Apartments', asOf: 'from the City Land Information System' },
  mississauga: { name: 'Mississauga', tier: 'B', kind: 'sheet', tab: 'Mississauga Second Units', addrCol: 'ADDRESS', wardCol: 'WARD', listDate: '2026-03-08', source: 'Mississauga Second Units Registry (City-published list)', asOf: 'list published 2026-03-08' },
  toronto:  { name: 'Toronto', tier: 'C', kind: 'permit', source: 'Toronto building permits (Second Suite)' },
  vaughan:  { name: 'Vaughan', tier: 'C', kind: 'permit', source: 'Vaughan permit records' }
};
var BC_NOT_COVERED_CITIES = ['barrie','milton','halton hills','pickering','whitby','markham','richmond hill','burlington','caledon','oakville','ajax','kitchener','waterloo','cambridge'];

function bcNorm_(s) { return String(s || '').toUpperCase().replace(/[.,#]/g, ' ').replace(/\s+/g, ' ').trim(); }
function bcCityFromAddr_(addr) {
  var a = String(addr || '').toLowerCase();
  for (var slug in BC_CFG) { if (a.indexOf(BC_CFG[slug].name.toLowerCase()) >= 0) return slug; }
  for (var i = 0; i < BC_NOT_COVERED_CITIES.length; i++) if (a.indexOf(BC_NOT_COVERED_CITIES[i]) >= 0) return BC_NOT_COVERED_CITIES[i];
  return '';
}
function bcStreetPart_(addr) {
  // take everything before the first comma, expand abbreviations, drop unit tokens
  var first = String(addr || '').split(',')[0];
  first = fsExpandAddr_(first);
  first = first.replace(/\b(unit|apt|suite|ste|#)\s*\w+/ig, '').replace(/\s+/g, ' ').trim();
  return first;
}
/* Resolve an ArcGIS item's FeatureServer query URL (cached). */
var BC_TYPES = /^(ST|STREET|RD|ROAD|AVE|AV|AVENUE|DR|DRIVE|BLVD|BOULEVARD|CRES|CRESC|CRESCENT|CRT|CT|COURT|PL|PLACE|LN|LANE|HWY|HIGHWAY|TRL|TRAIL|TER|TERR|TERRACE|SQ|SQUARE|CIR|CIRC|CIRCLE|PKWY|PARKWAY|GDNS|GDN|GARDENS|GRV|GROVE|HTS|HEIGHTS|WAY|CLOSE|GATE|MEWS|GREEN|PATH|RUN|RIDGE|HILL|HOLLOW|VIEW|VALE|WALK|LANDING|CROSSING|COMMON|COMMONS|BAY|CIRCUIT)$/;
function bcNeedle_(address) {
  var first = String(address || '').split(',')[0].toUpperCase().replace(/[.,#]/g, ' ');
  first = first.replace(/\b(UNIT|APT|SUITE|STE|BSMT|BASEMENT|LOWER|UPPER|MAIN)\b.*$/, '').replace(/\s+/g, ' ').trim();
  var toks = first.split(/\s+/).filter(Boolean);
  while (toks.length > 2 && /^[NSEW]{1,2}$/.test(toks[toks.length - 1])) toks.pop();
  while (toks.length > 2 && BC_TYPES.test(toks[toks.length - 1])) toks.pop();
  return toks.join(' ').replace(/'/g, "''");
}
function bcLayerUrl_(cfg) {
  if (cfg.serviceUrl) return cfg.serviceUrl;
  var ck = 'bc_lurl3_' + cfg.itemId, hit = cacheGet_(ck); if (hit && hit.url) return hit.url;
  var meta = UrlFetchApp.fetch('https://www.arcgis.com/sharing/rest/content/items/' + cfg.itemId + '?f=json', { muteHttpExceptions: true });
  if (meta.getResponseCode() !== 200) throw new Error('item meta ' + meta.getResponseCode());
  var j = JSON.parse(meta.getContentText()), base = String((j && j.url) || ''); if (!base) throw new Error('no service url on item');
  base = base.replace(/\/+$/, '');
  var layerUrl = /\/\d+$/.test(base) ? base : (base + '/' + (cfg.layer || 0));
  cachePut_(ck, { url: layerUrl }); return layerUrl;
}
function bcMeta_(cfg, layerUrl) {
  var ck = 'bc_meta3_' + cfg.itemId, hit = cacheGet_(ck); if (hit && hit.fields) return hit;
  var r = UrlFetchApp.fetch(layerUrl + '?f=json', { muteHttpExceptions: true }), out = { fields: [], display: '' };
  try {
    var j = JSON.parse(r.getContentText()); if (j && j.error) throw new Error(j.error.message || 'meta error');
    out.display = String(j.displayField || '');
    var fields = j.fields || [];
    for (var i = 0; i < fields.length; i++) { var f = fields[i], nm = String(f.name || ''); if (f.type !== 'esriFieldTypeString') continue; if (/globalid|guid|shape|geometry|email|www/i.test(nm)) continue; out.fields.push(nm); }
  } catch (e) { out.error = String((e && e.message) || e); }
  cachePut_(ck, out); return out;
}
function bcSearchFields_(meta, cfg) {
  if (cfg && cfg.addrField) return [cfg.addrField];
  var addr = meta.fields.filter(function (n) { return /addr|address|civic|street|location|fulladdr/i.test(n); });
  if (!addr.length && meta.display && meta.fields.indexOf(meta.display) >= 0) addr = [meta.display];
  if (!addr.length) addr = meta.fields.slice(0, 14);
  return addr;
}
function bcArcgisLookup_(cfg, address) {
  var layerUrl = bcLayerUrl_(cfg), meta = bcMeta_(cfg, layerUrl), fields = bcSearchFields_(meta, cfg), needle = bcNeedle_(address);
  var dbg = { layerUrl: layerUrl, display: meta.display, fields: fields, metaError: meta.error || '' };
  if (!needle || !fields.length) return { matched: false, records: [], where: '', _dbg: dbg };
  var where = '(' + fields.map(function (f) { return "UPPER(" + f + ") LIKE '%" + needle + "%'"; }).join(' OR ') + ')';
  var url = layerUrl + '/query?where=' + encodeURIComponent(where) + '&outFields=*&returnGeometry=false&f=json';
  var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true }); if (r.getResponseCode() !== 200) throw new Error('arcgis query ' + r.getResponseCode());
  var j = JSON.parse(r.getContentText()); if (j && j.error) throw new Error('arcgis: ' + (j.error.message || JSON.stringify(j.error)));
  var feats = (j && j.features) || []; dbg.where = where; dbg.count = feats.length;
  return { matched: feats.length > 0, records: feats.map(function (f) { return f.attributes; }), where: where, _dbg: dbg };
}

/* Tier B (Mississauga): match against a Google Sheet tab holding the City-published list. */
function bcSheetLookup_(cfg, address) {
  var ss = ssFor_('main');
  var sh = ss.getSheetByName(cfg.tab);
  if (!sh) { var all = ss.getSheets(); for (var i=0;i<all.length && !sh;i++){ if (all[i].getName().toUpperCase().indexOf('MISSISSAUGA')>=0 && all[i].getName().toUpperCase().indexOf('UNIT')>=0) sh=all[i]; } }
  if (!sh || sh.getLastRow() < 2) return { matched:false, records:[], _dbg:{ error:'tab not found: '+cfg.tab } };
  var vals = sh.getDataRange().getDisplayValues();
  var hdr = vals[0].map(function(h){ return String(h||'').trim().toUpperCase(); });
  var ai = hdr.indexOf(String(cfg.addrCol||'ADDRESS').toUpperCase()); if (ai<0) ai=0;
  var wi = hdr.indexOf(String(cfg.wardCol||'WARD').toUpperCase());
  var needle = bcNeedle_(address).replace(/''/g,"'");
  if (!needle) return { matched:false, records:[], _dbg:{ needle:needle } };
  for (var r=1;r<vals.length;r++){
    var raw = String(vals[r][ai]||'').toUpperCase().replace(/[.,#]/g,' ').replace(/\s+/g,' ').trim();
    if (!raw) continue;
    if (raw.indexOf(needle)===0 || raw.indexOf(' '+needle)>=0 || raw===needle || raw.indexOf(needle+' ')===0){
      var rec = { 'Address on file': vals[r][ai] }; if (wi>=0) rec['Ward']=vals[r][wi];
      return { matched:true, records:[rec], _dbg:{ needle:needle, tab:cfg.tab } };
    }
  }
  return { matched:false, records:[], _dbg:{ needle:needle, tab:cfg.tab } };
}
function bcScript_(status, cityName, cfg, rec) {
  var S = {
    REGISTERED: {
      colour: 'pine', label: 'Registered',
      say: 'I checked ' + cityName + '\u2019s registry and this address shows a registered additional unit on file, with the record dated as shown. That\u2019s the strongest confirmation the City provides, so we can treat the second unit as an established, on-file unit when we run the numbers \u2014 while still getting the paperwork through your lawyer.',
      next: ['Ask the seller for the registration certificate and any final inspection.', 'Have your lawyer confirm the record on closing.', 'You can factor the unit into affordability with reasonable confidence.']
    },
    PERMIT_ON_FILE: {
      colour: 'ochre', label: 'Permit on file',
      say: cityName + ' doesn\u2019t publish a registry of second units \u2014 nobody can look that up. What I can see is a building-permit record for a second suite at this address, which is good evidence but not the same as a registration. I\u2019d want the permit and final inspection documents before we treat it as an established unit.',
      next: ['Ask for the permit number and final inspection sign-off.', 'Order a building-records search through your lawyer.', 'Don\u2019t describe the unit as established in writing until the permit is confirmed.']
    },
    NO_RECORD: {
      colour: 'grey', label: 'No record',
      say: 'I checked ' + cityName + '\u2019s registry and there\u2019s no registration on file for this address. That doesn\u2019t automatically mean the basement is a problem \u2014 it might be family use, built before registration was required, or simply never registered. But it does mean we can\u2019t treat it as an established rental unit when we run the numbers.',
      next: ['Don\u2019t use rental income in the affordability math yet.', 'Ask the seller directly whether it was ever registered.', 'Price the cost of registering it into your offer.']
    },
    NOT_COVERED: {
      colour: 'grey', label: 'Not covered',
      say: cityName + ' doesn\u2019t publish a searchable registry, so there\u2019s nothing for me to look up here \u2014 no result either way. The only reliable answer comes from the City or Town directly, so I\u2019ll put that in as a condition rather than guess.',
      next: ['Add a condition to confirm the unit\u2019s status with the municipality.', 'Ask the seller for any registration or permit paperwork they hold.', 'Don\u2019t rely on rental income until it\u2019s confirmed in writing.']
    },
    AMBIGUOUS: {
      colour: 'blue', label: 'Needs a precise address',
      say: 'That address didn\u2019t resolve to a single property, so I don\u2019t want to give you a false read. Give me the full street address with the city and I\u2019ll check the registry again.',
      next: ['Re-enter the full address including the city.', 'Include the exact house number.']
    }
  };
  var s = S[status] || S.NOT_COVERED;
  var ev = { Source: cfg ? cfg.source : (cityName + ' \u2014 no registry'), Tier: cfg ? ('Tier ' + cfg.tier) : 'Not covered' };
  if (rec) { for (var k in rec) { if (rec[k] != null && String(rec[k]).length && !/geom|shape|objectid|_id|hash/i.test(k)) ev[k] = rec[k]; } }
  return { status: status, statusLabel: s.label, colour: s.colour, say: s.say, next: s.next, evidence: ev };
}

function getBasement_(address) {
  address = String(address || '').trim();
  if (address.length < 4) return { ok: false, error: 'Enter a full address, including the city (e.g. 41 Fanshawe Cres, Brampton).' };
  var slug = bcCityFromAddr_(address), cityName = '';
  try {
    if (slug && BC_CFG[slug]) {
      var cfg = BC_CFG[slug]; cityName = cfg.name;
      if (cfg.kind === 'arcgis') {
        try {
          var res = bcArcgisLookup_(cfg, address);
          var out = bcScript_(res.matched ? 'REGISTERED' : 'NO_RECORD', cityName, cfg, res.matched ? res.records[0] : null);
          out.ok = true; out.city = cityName; out.matched = res.matched; out.count = res.records.length; out.query = bcNeedle_(address);
          out._debug = res._dbg; return out;
        } catch (ee) {
          var soft = bcScript_('AMBIGUOUS', cityName, cfg, null);
          soft.ok = true; soft.city = cityName; soft.statusLabel = 'Temporarily unavailable';
          soft.say = 'I couldn\u2019t reach ' + cityName + '\u2019s registry just now. Let\u2019s confirm this one directly with the City rather than guess.';
          soft.next = ['Try again in a moment.', 'If it persists, confirm the unit\u2019s status with the City directly.'];
          soft._debug = { error: String((ee && ee.message) || ee) };
          return soft;
        }
      }
      if (cfg.kind === 'sheet') {
        var sres = bcSheetLookup_(cfg, address);
        var so = bcScript_(sres.matched ? 'REGISTERED' : 'NO_RECORD', cityName, cfg, sres.matched ? sres.records[0] : null);
        if (sres.matched) so.evidence['List published'] = cfg.listDate || '';
        so.ok = true; so.city = cityName; so.matched = sres.matched; so.count = sres.matched?1:0; so.query = bcNeedle_(address); so._debug = sres._dbg; return so;
      }
      if (cfg.kind === 'permit') { var o1 = bcScript_('PERMIT_ON_FILE', cityName, cfg, null); o1.ok = true; o1.city = cityName; return o1; }
      // tier B (PDF) not live yet -> not covered, honest
      var o2 = bcScript_('NOT_COVERED', cityName, cfg, null); o2.ok = true; o2.city = cityName; return o2;
    }
    // known not-covered city
    if (slug) { var nm = slug.replace(/\b\w/g, function (c) { return c.toUpperCase(); }); var o3 = bcScript_('NOT_COVERED', nm, null, null); o3.ok = true; o3.city = nm; return o3; }
    // city not recognised in the address
    var amb = bcScript_('AMBIGUOUS', 'This address', null, null); amb.ok = true; amb.city = ''; return amb;
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), city: cityName };
  }
}
/* Coverage list for the UI (tier-grouped). */
function getBasementCoverage_() {
  return { ok: true, tiers: [
    { tier: 'A', label: 'Live city registry \u2014 checks instantly', cities: ['Brampton', 'Oshawa'] },
    { tier: 'C', label: 'Building permits only \u2014 no registry', cities: ['Toronto', 'Vaughan'] },
    { tier: 'B', label: 'Registry published as a file \u2014 not yet live', cities: ['Mississauga'] },
    { tier: 'D/E', label: 'No public registry \u2014 confirm with the municipality', cities: ['Barrie', 'Milton', 'Halton Hills', 'Pickering', 'Whitby', 'Markham', 'Richmond Hill', 'Burlington', 'Caledon', 'Oakville', 'Ajax', 'Kitchener', 'Waterloo', 'Cambridge'] }
  ] };
}


/* =====================================================================
   PUBLIC DISPATCHER for the mobile app (google.script.run.app(action, p)).
   Mirrors the JSON routing but returns objects. Single public entry so the
   underscore helpers stay private.
   ===================================================================== */
function app(action, p) {
  p = p || {}; action = String(action || '');
  if (p.fresh) __FRESH = true;
  switch (action) {
    case 'home':          return getHome_();
    case 'cities':        return getCities_();
    case 'citycounts':    return getCityCounts_();
    case 'city':          return getProjects_(p.name);
    case 'focus':         return getFocus_();
    case 'listings':      return getListings_();
    case 'builders':      return getBuilders_();
    case 'contractors':   return getContractors_();
    case 'contacts':      return getContacts_();
    case 'resources':     return getResources_();
    case 'websites':      return getWebsites_();
    case 'faqs':          return getFaqs_();
    case 'vacations':     return getVacations_();
    case 'callnight':     return getCallNight_();
    case 'leaderboard':   return getLeaderboard_(p.period);
    case 'meetings':      return getMeetingsLeaderboard_(p.period);
    case 'guiderealtors': return getGuideRealtors_();
    case 'schools':
    case 'getRankings':
    case 'getSchools':    return readTab_('School Rankings', 'main', '');
    case 'schoolfinder':  return getSchoolFinder_();
    case 'basement':      return getBasement_(p.addr || p.address);
    case 'basementcoverage': return getBasementCoverage_();
    case 'ltb':           return getLTB_(p.q || p.query, p.offset);
    case 'crime':         return getCrimeCity_(p.slug || p.city);
    case 'crimecities':   return getCrimeCities_();
    case 'fsboards':      return { ok: true, boards: fsBoards_() };
    case 'fssuggest':     return { ok: true, items: fsSuggest_(p.board, p.q || p.text) };
    case 'fslookup':      return fsLookup_(p.board, p.addr || p.address, p.num || p.houseNumber);
    case 'fsschools':     return fsSchools_(p.board, p.id || p.addressId, p.label || p.addressLabel, p.num || p.houseNumber);
    case 'login':         return handleLogin_(p);
    case 'mydeals':       return getMyDealsPayload_(p);
    case 'bootcamp':      return getBootcampPayload_(p);
    default:              return { ok: false, error: 'unknown action: ' + action };
  }
}
/** Run once to authorize external requests (basement/crime/ltb/schools). */
function GRANT_URLFETCH_APP() { var r = UrlFetchApp.fetch('https://www.arcgis.com/sharing/rest/content/items/7d9df6528d474b43b6771cb7feefc35e?f=json', { muteHttpExceptions: true }); return 'Authorized. HTTP ' + r.getResponseCode(); }