/**
 * Realtor Portal — core: config, helpers, routing
 * Part of the Realtor Portal Apps Script project; all .gs files share one
 * global scope, so load order does not matter.
 */
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
/* The web app is anonymous, so `fresh` must not let a caller force unlimited full-sheet
   reads: at most one cache-busting rebuild per action per 30s. A user tapping Refresh
   still gets a rebuild; a loop cannot exhaust the script's quota. */
function freshAllowed_(action) {
  try {
    var c = CacheService.getScriptCache(), gk = 'freshgate_' + action;
    if (c.get(gk)) return false;
    c.put(gk, '1', 30);
    return true;
  } catch (e) { return false; }
}

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
/* Stitches the HTML partials into App.html at render time (<?!= include('X') ?>). */
function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.fresh && freshAllowed_(String(p.action || ''))) __FRESH = true;
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


/* =====================================================================
   PUBLIC DISPATCHER for the mobile app (google.script.run.app(action, p)).
   Mirrors the JSON routing but returns objects. Single public entry so the
   underscore helpers stay private.
   ===================================================================== */
function app(action, p) {
  p = p || {}; action = String(action || '');
  if (p.fresh && !__FRESH && freshAllowed_(action)) __FRESH = true;
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
    case 'schools':
    case 'getRankings':
    case 'getSchools':    return rankingsSlim_();
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
