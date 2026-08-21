/**
 * Realtor Portal — sheet readers: projects, directory, login
 * Part of the Realtor Portal Apps Script project; all .gs files share one
 * global scope, so load order does not matter.
 */
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
