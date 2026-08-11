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
  check('laptop demand query present', String(fg[0][5]).indexOf('laptop_interest') !== -1);
  check('own model query present', String(fg[0][8]).indexOf('own_model') !== -1);
  check('per link query present', String(fg[0][11]).indexOf('step_viewed') !== -1);

  const balanced = s => (String(s).match(/"/g) || []).length % 2 === 0 && (String(s).match(/\(/g) || []).length === (String(s).match(/\)/g) || []).length;
  check('all funnel formulas have balanced quotes and brackets',
    [fg[1][1], fg[2][2], fg[2][3], fg[0][5], fg[0][8], fg[0][11]].every(balanced));

  const rg = rowsOf(ss, 'Read me first');
  check('read me has content', rg.length > 25, rg.length);
  check('read me opens with a title', String(rg[0][0]).indexOf('how this sheet works') !== -1, rg[0][0]);
  check('read me explains every tab', ['Responses', 'Taps', 'Events', 'Funnel'].every(t => rg.some(r => String(r[0]) === t)));
  check('read me warns about privacy', rg.some(r => /phone numbers/i.test(String(r[0]))));
  const jargon = ['JSON', 'endpoint', 'deploy', 'API', 'payload', 'localStorage', 'sendBeacon'];
  const hits = rg.filter(r => jargon.some(j => new RegExp('\\b' + j + '\\b').test(String(r[0])))).map(r => String(r[0]).slice(0, 60));
  check('read me stays free of developer jargon', hits.length === 0, hits);

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

console.log('\n' + (failures ? failures + ' FAILED' : 'all checks passed') + '\n');
process.exit(failures ? 1 : 0);
