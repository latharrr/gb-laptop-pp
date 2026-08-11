// Runs google-sheet.gs against a mock Sheets API so the script can be exercised
// without deploying it. Node only, not shipped to the browser.
//   node test-sheet.js
'use strict';
const fs = require('fs');
const vm = require('vm');

let failures = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ok    ' + name); }
  else { failures++; console.log('  FAIL  ' + name + (extra ? '  -> ' + JSON.stringify(extra) : '')); }
}

function makeSheet(name) {
  const grid = [];           // grid[row][col], 0 indexed internally
  const fmt = { hiddenGridlines: false, frozenRows: 0, widths: {} };
  const at = (r, c) => (grid[r] && grid[r][c] !== undefined ? grid[r][c] : '');
  const put = (r, c, v) => { while (grid.length <= r) grid.push([]); grid[r][c] = v; };
  const lastRow = () => {
    let last = 0;
    grid.forEach((row, i) => { if (row && row.some(v => v !== '' && v !== undefined)) last = i + 1; });
    return last;
  };
  const chain = {};
  function rangeFor(cells) {
    const api = {
      setValues(vals) { vals.forEach((row, i) => row.forEach((v, j) => put(cells.r + i, cells.c + j, v))); return api; },
      setValue(v) { put(cells.r, cells.c, v); return api; },
      setFormula(f) { put(cells.r, cells.c, f); return api; },
      getValue() { return at(cells.r, cells.c); },
      getValues() {
        const out = [];
        for (let i = 0; i < cells.rows; i++) {
          const row = [];
          for (let j = 0; j < cells.cols; j++) row.push(at(cells.r + i, cells.c + j));
          out.push(row);
        }
        return out;
      },
      setFontWeight() { return api; }, setFontSize() { return api; }, setFontColor() { return api; },
      setNumberFormat(f) { fmt['numfmt:' + cells.r + ':' + cells.c] = f; return api; },
      setWrap() { return api; }, setVerticalAlignment() { return api; },
    };
    return api;
  }
  function parseA1(a1) {
    const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(a1);
    const colNum = s => s.split('').reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
    const c = colNum(m[1]), r = parseInt(m[2], 10) - 1;
    const c2 = m[3] ? colNum(m[3]) : c, r2 = m[4] ? parseInt(m[4], 10) - 1 : r;
    return { r, c, rows: r2 - r + 1, cols: c2 - c + 1 };
  }
  const sheet = {
    __name: name, __grid: grid, __fmt: fmt,
    getName() { return name; },
    getLastRow: lastRow,
    getMaxRows() { return Math.max(1000, lastRow()); },
    appendRow(vals) { const r = lastRow(); vals.forEach((v, j) => put(r, j, v)); return sheet; },
    getRange(a, b, c, d) {
      if (typeof a === 'string') return rangeFor(parseA1(a));
      return rangeFor({ r: a - 1, c: b - 1, rows: c || 1, cols: d || 1 });
    },
    setFrozenRows(n) { fmt.frozenRows = n; return sheet; },
    setHiddenGridlines(v) { fmt.hiddenGridlines = v; return sheet; },
    setColumnWidth(c, w) { fmt.widths[c] = w; return sheet; },
  };
  return sheet;
}

function makeSpreadsheet() {
  const order = [];
  const byName = {};
  return {
    __order: order,
    getSheetByName(n) { return byName[n] || null; },
    insertSheet(n) { const s = makeSheet(n); byName[n] = s; order.push(n); return s; },
    deleteSheet(s) { delete byName[s.getName()]; order.splice(order.indexOf(s.getName()), 1); },
    setActiveSheet(s) { this.__active = s; return s; },
    moveActiveSheet(pos) {
      const n = this.__active.getName();
      order.splice(order.indexOf(n), 1);
      order.splice(pos - 1, 0, n);
    },
    toast() {},
  };
}

function load(secret) {
  const ss = makeSpreadsheet();
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput(t) { return { __text: t, setMimeType() { return this; } }; },
    },
    console,
  };
  vm.createContext(sandbox);
  let code = fs.readFileSync('google-sheet.gs', 'utf8');
  if (secret) code = code.replace("var SHARED_SECRET = '';", "var SHARED_SECRET = '" + secret + "';");
  vm.runInContext(code, sandbox);
  return { ss, ctx: sandbox };
}

const post = (ctx, obj) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(obj) } }).__text);
const rowsOf = (ss, name) => (ss.getSheetByName(name) || { __grid: [] }).__grid;
// The script runs in its own vm realm, so its Dates fail `instanceof Date` here.
const isDate = v => Object.prototype.toString.call(v) === '[object Date]';
const FUNNEL_STEPS_LABELS = ['Opened the link', 'Chose a use', 'Chose a budget', 'Saw the picks',
  'Chose a week', 'Chose readiness', 'Reached contact', 'Joined the pool'];

console.log('\nApps Script behaviour\n');
{
  const { ss, ctx } = load();

  // --- responses ---
  const lead = { leadId: 'L1', name: 'Riya', phone: '+919812345670', purpose: 'Gaming', budget: 'Under 60k', picks: 'Lenovo LOQ', pickCount: 1, source: 'whatsapp', host: 'laptop.picapool.tech', submittedAt: '2026-08-11T10:00:00.000Z' };
  const r1 = post(ctx, lead);
  check('lead appends at row 2', r1.ok && r1.row === 2, r1);

  const r2 = post(ctx, Object.assign({}, lead, { picks: 'Lenovo LOQ | MSI Thin 15', pickCount: 2 }));
  check('same leadId updates the same row', r2.row === 2, r2);

  const g = rowsOf(ss, 'Responses');
  check('updated row kept its picks change', String(g[1][7]).indexOf('MSI Thin 15') !== -1, g[1][7]);
  check('original submittedAt preserved', isDate(g[1][0]) && g[1][0].toISOString() === '2026-08-11T10:00:00.000Z', String(g[1][0]));
  check('updatedAt is later than submittedAt', g[1][1] > g[1][0]);

  const r3 = post(ctx, Object.assign({}, lead, { leadId: 'L2', name: 'Aarav' }));
  check('different leadId appends row 3', r3.row === 3, r3);
  check('phone column formatted as text', ss.getSheetByName('Responses').__fmt['numfmt:1:4'] === '@');

  // --- taps ---
  const t1 = post(ctx, { type: 'tap', tappedAt: '2026-08-11T10:05:00.000Z', source: 'whatsapp', path: '/whatsapp', repeat: 'no', referrer: 'https://wa.me/' });
  check('tap goes to Taps, not Responses', t1.ok && t1.tapped === 'whatsapp', t1);
  check('Responses untouched by a tap', rowsOf(ss, 'Responses').length === 3);
  check('tap row landed under the header', rowsOf(ss, 'Taps').length === 2);

  // --- events ---
  const ev = { type: 'events', rows: [
    { at: '2026-08-11T10:06:00.000Z', session: 'S1', source: 'whatsapp', event: 'step_viewed', detail: 'landing', device: 'mobile', poolId: 'P' },
    { at: '2026-08-11T10:06:05.000Z', session: 'S1', source: 'whatsapp', event: 'step_viewed', detail: 'purpose', device: 'mobile', poolId: 'P' },
    { at: '2026-08-11T10:06:09.000Z', session: 'S1', source: 'whatsapp', event: 'laptop_interest', detail: 'Lenovo LOQ', device: 'mobile', poolId: 'P' },
  ] };
  const e1 = post(ctx, ev);
  check('event batch writes every row', e1.ok && e1.events === 3, e1);
  check('Events has header plus 3', rowsOf(ss, 'Events').length === 4);
  const e2 = post(ctx, ev);
  check('second batch appends, does not overwrite', rowsOf(ss, 'Events').length === 7, e2);
  check('event timestamps stored as Dates', isDate(rowsOf(ss, 'Events')[1][0]), String(rowsOf(ss, 'Events')[1][0]));
  check('empty batch is a no op', post(ctx, { type: 'events', rows: [] }).events === 0);

  // --- generated sheets ---
  check('Funnel sheet created', !!ss.getSheetByName('Funnel'));
  check('Read me sheet created', !!ss.getSheetByName('Read me first'));
  check('Read me is the first tab', ss.__order[0] === 'Read me first', ss.__order);

  const fg = rowsOf(ss, 'Funnel');
  check('funnel has all 8 steps', fg.length >= 9 && fg[8][0] === 'Joined the pool', fg.map(r => r[0]));
  check('funnel step formula references Events', String(fg[1][1]).indexOf("'Events'!") !== -1, fg[1][1]);
  check('funnel counts distinct sessions', /COUNTA\(UNIQUE\(FILTER/.test(String(fg[1][1])));
  check('share formula divides by openers', String(fg[2][2]).indexOf('$B$2') !== -1, fg[2][2]);
  check('lost-here formula subtracts previous step', String(fg[2][3]) === '=IFERROR($B2-$B3,0)', fg[2][3]);
  check('no lost-here on the first step', fg[1][3] === undefined || fg[1][3] === '');
  check('laptop demand query present', String(fg[0][13]).indexOf('laptop_interest') !== -1, fg[0][13]);
  check('own model query present', String(fg[0][16]).indexOf('own_model') !== -1, fg[0][16]);

  // --- per link funnel block ---
  // 8 steps -> title on row 11, header row 12, link rows start at 13.
  const HEAD = 11, FIRST = 12;   // zero indexed
  check('per link section has a heading', /Every link/.test(String(fg[HEAD - 1][0])), fg[HEAD - 1][0]);
  const hdr = fg[HEAD].map(String);
  check('per link header starts Link, Share this address, Taps',
    hdr[0] === 'Link' && hdr[1] === 'Share this address' && hdr[2] === 'Taps', hdr.slice(0, 3));
  check('per link header lists all 8 steps',
    hdr.slice(3, 11).join('|') === FUNNEL_STEPS_LABELS.join('|'), hdr.slice(3, 11));
  check('per link header ends with the conversion column', hdr[11] === 'Joined, out of taps', hdr[11]);

  const linkRow = fg[FIRST].map(String);
  check('link names come from a live unique list of sources',
    /UNIQUE\(FILTER\('Events'!\$C\$2:\$C/.test(linkRow[0]), linkRow[0]);
  check('shareable address is built from the site url',
    linkRow[1].indexOf('https://laptop.picapool.tech/"&$A13') !== -1, linkRow[1]);
  check('direct link falls back to the bare address',
    /IF\(\$A13="direct","https:\/\/laptop\.picapool\.tech"/.test(linkRow[1]), linkRow[1]);
  check('taps column counts the Taps sheet, not Events',
    /COUNTIF\('Taps'!\$B\$2:\$B,\$A13\)/.test(linkRow[2]), linkRow[2]);
  check('per link step counts filter by that link',
    /FILTER\('Events'!\$B\$2:\$B,'Events'!\$C\$2:\$C=\$A13/.test(linkRow[3]), linkRow[3]);
  check('per link step counts are distinct sessions', /COUNTA\(UNIQUE\(FILTER/.test(linkRow[3]));
  check('last step column targets the done screen', /\$E\$2:\$E="done"/.test(linkRow[10]), linkRow[10]);
  check('conversion divides joined by taps', /\$K13\/\$C13/.test(linkRow[11]), linkRow[11]);
  check('every link cell is guarded against empty rows',
    linkRow.slice(1, 12).every(f => f.indexOf('=IF($A13="","",') === 0), linkRow.slice(1, 12).map(f => f.slice(0, 16)));
  check('there is room for 15 links', fg[FIRST + 14] && String(fg[FIRST + 14][2]).indexOf('$A27') !== -1, fg[FIRST + 14] && fg[FIRST + 14][2]);
  check('the per link block does not collide with the demand queries',
    fg[HEAD].length <= 13 && !fg[FIRST].slice(13).some(Boolean));

  const balanced = s => (String(s).match(/"/g) || []).length % 2 === 0 && (String(s).match(/\(/g) || []).length === (String(s).match(/\)/g) || []).length;
  const everyFormula = [];
  fg.forEach(row => (row || []).forEach(cell => { if (typeof cell === 'string' && cell.charAt(0) === '=') everyFormula.push(cell); }));
  check('every formula on the sheet has balanced quotes and brackets',
    everyFormula.every(balanced), everyFormula.filter(f => !balanced(f)).slice(0, 2));
  check('the sheet is mostly formulas, not hardcoded numbers', everyFormula.length > 150, everyFormula.length);

  const rg = rowsOf(ss, 'Read me first');
  const text = rg.map(r => String(r[0])).join('\n');
  const has = s => text.indexOf(s) !== -1;

  check('read me has content', rg.length > 60, rg.length);
  check('read me opens with a title', String(rg[0][0]).indexOf('how this sheet works') !== -1, rg[0][0]);
  check('read me names every tab as its own heading',
    ['Responses', 'Taps', 'Events', 'Funnel', 'Read me first'].every(t => rg.some(r => String(r[0]) === t)));
  check('read me is numbered into sections',
    [1, 2, 3, 4, 5, 6, 7, 8, 9].every(n => rg.some(r => String(r[0]).indexOf(n + '. ') === 0)),
    rg.filter(r => /^\d\. /.test(String(r[0]))).map(r => String(r[0])));

  check('read me walks through what a student does',
    has('Find my laptop') && has('I am interested') && has('saves itself'));
  check('read me explains why no prices are shown', /never shows a price/.test(text));
  check('read me documents all three runnable functions',
    ['setupSheets', 'rebuildFunnel', 'rebuildReadme'].every(f => rg.some(r => String(r[0]) === f)));
  check('read me says how to reach those functions',
    has('Extensions') && has('Apps Script') && has('press Run'));
  check('read me warns that editing the script is not enough on its own',
    /editing the script alone changes nothing/i.test(text));

  const COLS = ['Submitted at', 'Updated at', 'Lead ID', 'Shortlisted laptops', 'Own model or brand',
    'Buying window', 'Readiness', 'Pool price total', 'List price total', 'Been here before', 'Came from'];
  check('read me explains every non obvious column', COLS.every(has), COLS.filter(c => !has(c)));

  const EVENTS = ['step_viewed', 'chose_use', 'chose_budget', 'chose_week', 'chose_readiness',
    'laptop_interest', 'own_model', 'stretched_budget', 'skipped_picks', 'started_contact',
    'joined_pool', 'restarted'];
  check('read me lists every event name the form can send', EVENTS.every(has), EVENTS.filter(e => !has(e)));

  check('read me explains both funnel blocks and the demand lists',
    /Share of openers/.test(text) && /Lost here/.test(text) && /split by link/.test(text) && /take to a seller/.test(text));
  check('read me covers campaign links', has('laptop.picapool.tech/hostel') && has('tagged direct'));
  check('read me has a troubleshooting section', /showing zeroes/.test(text) && /went missing/.test(text));
  check('read me warns about privacy', /phone numbers/i.test(text));
  check('read me says which tabs are safe to share', /safe to share/.test(text));
  check('read me points at the code', has('github.com/latharrr/gb-laptop-pp'));

  // "Deploy" is allowed, it is a button label and the text says where to find it.
  const jargon = ['JSON', 'endpoint', 'API', 'payload', 'localStorage', 'sendBeacon', 'callback', 'webhook', 'idempotent'];
  const hits = rg.filter(r => jargon.some(j => new RegExp('\\b' + j + '\\b').test(String(r[0])))).map(r => String(r[0]).slice(0, 60));
  check('read me stays free of developer jargon', hits.length === 0, hits);
  const longest = rg.reduce((a, r) => Math.max(a, String(r[0]).length), 0);
  check('no paragraph is an unreadable wall of text', longest < 700, longest);

  // --- doGet ---
  check('doGet names every tab', ['Read me first', 'Responses', 'Taps', 'Events', 'Funnel'].every(n => ctx.doGet().__text.indexOf(n) !== -1), ctx.doGet().__text);

  // --- resilience ---
  check('garbage body does not throw', post(ctx, {}).ok === true);
  const bad = ctx.doPost({ postData: { contents: 'not json at all' } });
  check('malformed json returns an error instead of crashing', JSON.parse(bad.__text).ok === false);
  check('missing postData does not throw', JSON.parse(ctx.doPost({}).__text).ok === true);
}
{
  const { ctx } = load('hunter2');
  check('wrong secret rejected', post(ctx, { leadId: 'X', secret: 'nope' }).error === 'bad secret');
  check('right secret accepted', post(ctx, { leadId: 'X', secret: 'hunter2' }).ok === true);
}

// The sheet and the form are edited separately and drift silently, so tie them
// together here: anything app.js can send has to be understood by the script.
{
  const app = fs.readFileSync('app.js', 'utf8');
  const gs = fs.readFileSync('google-sheet.gs', 'utf8');

  const fired = new Set();
  [...app.matchAll(/track\('([a-z_]+)'/g)].forEach(m => fired.add(m[1]));
  [...app.matchAll(/trackOnce\([^,]+,\s*'([a-z_]+)'/g)].forEach(m => fired.add(m[1]));
  const readme = gs.slice(gs.indexOf('var README_ROWS'), gs.indexOf('function ensureReadmeSheet'));
  check('every event the form fires is explained in the read me',
    [...fired].every(e => readme.indexOf(e) !== -1), [...fired].filter(e => readme.indexOf(e) === -1));

  const screens = [...gs.matchAll(/screen: '([a-z]+)'/g)].map(m => m[1]);
  const appScreens = (app.match(/var ORDER = \[([^\]]+)\]/) || [])[1].replace(/'/g, '').split(',').map(s => s.trim());
  check('every funnel step is a screen the form actually has',
    screens.length === 8 && screens.every(s => appScreens.indexOf(s) !== -1),
    screens.filter(s => appScreens.indexOf(s) === -1));

  const payloadKeys = [...app.matchAll(/^\s{6}([a-zA-Z]+):/gm)].map(m => m[1]);
  const sheetKeys = [...gs.matchAll(/\{ key: '([a-zA-Z]+)'/g)].map(m => m[1]);
  check('every column the sheet writes is a key the form sends',
    ['leadId', 'name', 'phone', 'purpose', 'budget', 'picks', 'custom', 'week', 'readiness', 'source', 'host']
      .every(k => sheetKeys.indexOf(k) !== -1 && payloadKeys.indexOf(k) !== -1),
    { payloadKeys, sheetKeys });

  const site = (gs.match(/var SITE_URL = '([^']+)'/) || [])[1];
  check('the address on the funnel tab matches the live site',
    site === 'https://laptop.picapool.tech', site);
}

console.log('\n' + (failures ? failures + ' FAILED' : 'all checks passed') + '\n');
process.exit(failures ? 1 : 0);
