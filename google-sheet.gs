/**
 * Picapool intent form -> Google Sheet
 *
 * Every completed form posts one row here. If the same person edits their picks
 * and comes back to the pool screen, the row is updated in place instead of a
 * second row being appended, because each device carries a lead ID.
 *
 * SETUP (about two minutes)
 *  1. Create a Google Sheet. Name does not matter.
 *  2. Extensions > Apps Script. Delete the sample code, paste this whole file.
 *  3. Optional: set SHARED_SECRET below to any random string, and set the same
 *     string as SHEET_SECRET in app.js. Without it, anyone who finds the URL can
 *     write rows. It is not real auth, it just stops drive by junk.
 *  4. Deploy > New deployment > type "Web app".
 *       Execute as:      Me
 *       Who has access:  Anyone
 *     Google will ask you to authorise the script. That warning screen is
 *     expected for your own script: Advanced > Go to (project name).
 *  5. Copy the Web app URL. It ends in /exec.
 *  6. Paste it into SHEET_ENDPOINT at the top of app.js.
 *  7. Optional: pick setupSheets from the function dropdown and press Run, to
 *     create every tab now rather than when the first person uses the form.
 *
 * To check it is live, open the /exec URL in a browser. It should answer with a
 * short "endpoint is live" line.
 *
 * After changing this file you must redeploy: Deploy > Manage deployments >
 * pencil icon > Version: New version > Deploy. The URL stays the same.
 */

var SHEET_NAME = 'Responses';
var TAPS_SHEET_NAME = 'Taps';
var EVENTS_SHEET_NAME = 'Events';
var FUNNEL_SHEET_NAME = 'Funnel';
var README_SHEET_NAME = 'Read me first';
var SHARED_SECRET = '';

// Used to build the shareable address for each campaign link on the Funnel tab.
var SITE_URL = 'https://laptop.picapool.tech';
// How many campaign links the Funnel tab leaves room for.
var MAX_SOURCES = 15;

// Run this once from the editor to create every tab straight away, instead of
// waiting for the first person to use the form. Select setupSheets from the
// function dropdown at the top, then press Run.
function setupSheets() {
  ensureReadmeSheet();
  getSheet();
  getTapSheet();
  getEventSheet();
  ensureFunnelSheet();
  SpreadsheetApp.getActiveSpreadsheet().toast('All tabs are ready.', 'Picapool', 5);
}

// Order here is the column order in the sheet. Adding a key means adding a
// column, so add new ones at the end and existing rows stay lined up.
var COLUMNS = [
  { key: 'submittedAt', label: 'Submitted at' },
  { key: 'updatedAt', label: 'Updated at' },
  { key: 'leadId', label: 'Lead ID' },
  { key: 'name', label: 'Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'purpose', label: 'Primary use' },
  { key: 'budget', label: 'Budget band' },
  { key: 'picks', label: 'Shortlisted laptops' },
  { key: 'pickCount', label: 'Shortlist count' },
  { key: 'custom', label: 'Own model or brand' },
  { key: 'week', label: 'Buying window' },
  { key: 'readiness', label: 'Readiness' },
  { key: 'poolTotal', label: 'Pool price total' },
  { key: 'listTotal', label: 'List price total' },
  { key: 'poolId', label: 'Pool' },
  { key: 'source', label: 'Source' },
  { key: 'host', label: 'Host' }
];

// One row per step or choice, tied to an anonymous session id. This is what the
// Funnel sheet reads to work out where people leave. No names or numbers land
// here, only that somebody reached the contact step.
var EVENT_COLUMNS = [
  { key: 'at', label: 'At' },
  { key: 'session', label: 'Session' },
  { key: 'source', label: 'Source' },
  { key: 'event', label: 'Event' },
  { key: 'detail', label: 'Detail' },
  { key: 'device', label: 'Device' },
  { key: 'poolId', label: 'Pool' }
];

// One row per tap on a campaign link, filled in even when the person never
// finishes the form. Source is the path they arrived on, so /test reads "test".
var TAP_COLUMNS = [
  { key: 'tappedAt', label: 'Tapped at' },
  { key: 'source', label: 'Source' },
  { key: 'path', label: 'Path' },
  { key: 'repeat', label: 'Been here before' },
  { key: 'referrer', label: 'Came from' },
  { key: 'host', label: 'Host' },
  { key: 'poolId', label: 'Pool' }
];

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json({ ok: false, error: 'busy' });
  }
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
    if (SHARED_SECRET && body.secret !== SHARED_SECRET) return json({ ok: false, error: 'bad secret' });
    ensureReadmeSheet();
    if (body.type === 'tap') return recordTap(body);
    if (body.type === 'events') return recordEvents(body);

    var sheet = getSheet();
    var now = new Date();
    var values = {};
    COLUMNS.forEach(function (c) { values[c.key] = body[c.key] != null ? body[c.key] : ''; });
    values.submittedAt = body.submittedAt ? new Date(body.submittedAt) : now;
    values.updatedAt = now;

    var existing = findRowByLeadId(sheet, body.leadId);
    if (existing > 0) {
      // Keep the first submission time, replace everything else.
      values.submittedAt = sheet.getRange(existing, keyIndex('submittedAt') + 1).getValue() || values.submittedAt;
      sheet.getRange(existing, 1, 1, COLUMNS.length).setValues([toRow(values)]);
    } else {
      sheet.appendRow(toRow(values));
    }
    return json({ ok: true, row: existing > 0 ? existing : sheet.getLastRow() });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return ContentService.createTextOutput(
    'Picapool endpoint is live. Tabs: "' + README_SHEET_NAME + '" explains the sheet, "' +
    SHEET_NAME + '" holds the responses, "' + TAPS_SHEET_NAME + '" the link taps, "' +
    EVENTS_SHEET_NAME + '" the step by step activity, and "' + FUNNEL_SHEET_NAME +
    '" works out where people drop off.'
  );
}

// Events arrive in batches, so one setValues beats a stream of appendRow calls.
function recordEvents(body) {
  var rows = body.rows;
  if (!rows || !rows.length) return json({ ok: true, events: 0 });
  var sheet = getEventSheet();
  var values = rows.map(function (r) {
    return EVENT_COLUMNS.map(function (c) {
      if (c.key === 'at') return r.at ? new Date(r.at) : new Date();
      return r[c.key] != null ? r[c.key] : '';
    });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, EVENT_COLUMNS.length).setValues(values);
  ensureFunnelSheet();
  return json({ ok: true, events: values.length, row: sheet.getLastRow() });
}

function getEventSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(EVENTS_SHEET_NAME) || ss.insertSheet(EVENTS_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(EVENT_COLUMNS.map(function (c) { return c.label; }));
    sheet.getRange(1, 1, 1, EVENT_COLUMNS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// The steps a person passes through, in order. The label is what shows on the
// Funnel sheet, the screen is what the form logs as step_viewed.
var FUNNEL_STEPS = [
  { label: 'Opened the link', screen: 'landing' },
  { label: 'Chose a use', screen: 'purpose' },
  { label: 'Chose a budget', screen: 'budget' },
  { label: 'Saw the picks', screen: 'picks' },
  { label: 'Chose a week', screen: 'timeline' },
  { label: 'Chose readiness', screen: 'intent' },
  { label: 'Reached contact', screen: 'contact' },
  { label: 'Joined the pool', screen: 'done' }
];

// Built once, then left alone. Everything on it is a live formula, so it keeps
// itself current as events arrive. Run rebuildFunnel() to recreate it.
function ensureFunnelSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(FUNNEL_SHEET_NAME)) return;
  buildFunnelSheet(ss.insertSheet(FUNNEL_SHEET_NAME));
}

function rebuildFunnel() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var old = ss.getSheetByName(FUNNEL_SHEET_NAME);
  if (old) ss.deleteSheet(old);
  buildFunnelSheet(ss.insertSheet(FUNNEL_SHEET_NAME));
}

function buildFunnelSheet(sheet) {
  var E = "'" + EVENTS_SHEET_NAME + "'!";
  var T = "'" + TAPS_SHEET_NAME + "'!";
  var n = FUNNEL_STEPS.length;

  // Distinct sessions that reached a screen at least once. Distinct matters,
  // because pressing back re enters a screen and would otherwise count twice.
  function reached(screen, sourceCell) {
    return 'IFERROR(COUNTA(UNIQUE(FILTER(' + E + '$B$2:$B,' +
      (sourceCell ? E + '$C$2:$C=' + sourceCell + ',' : '') +
      E + '$D$2:$D="step_viewed",' + E + '$E$2:$E="' + screen + '"))),0)';
  }

  // ---- everyone, whichever link they came from ----
  sheet.getRange('A1:D1').setValues([['Step', 'People', 'Share of openers', 'Lost here']]).setFontWeight('bold');
  for (var i = 0; i < n; i++) {
    var row = i + 2;
    sheet.getRange(row, 1).setValue(FUNNEL_STEPS[i].label);
    sheet.getRange(row, 2).setFormula('=' + reached(FUNNEL_STEPS[i].screen, null));
    sheet.getRange(row, 3).setFormula('=IFERROR($B' + row + '/$B$2,0)');
    if (i > 0) sheet.getRange(row, 4).setFormula('=IFERROR($B' + (row - 1) + '-$B' + row + ',0)');
  }
  sheet.getRange(2, 3, n, 1).setNumberFormat('0%');

  // ---- the same funnel, split by the link people arrived on ----
  var title = n + 3;                 // one blank row under the block above
  var head = title + 1;
  var first = head + 1;              // first row of link data
  sheet.getRange(title, 1)
    .setValue('Every link, and how far the people who used it got')
    .setFontWeight('bold').setFontSize(12).setFontColor('#F03506');

  var header = ['Link', 'Share this address', 'Taps']
    .concat(FUNNEL_STEPS.map(function (s) { return s.label; }))
    .concat(['Joined, out of taps']);
  sheet.getRange(head, 1, 1, header.length).setValues([header]).setFontWeight('bold');

  // The link names fill themselves in as new tags show up in Events.
  sheet.getRange(first, 1).setFormula(
    '=IFERROR(SORT(UNIQUE(FILTER(' + E + '$C$2:$C,' + E + '$C$2:$C<>""))),"")'
  );

  for (var r = first; r < first + MAX_SOURCES; r++) {
    var src = '$A' + r;
    var guard = function (body) { return '=IF(' + src + '="","",' + body + ')'; };

    sheet.getRange(r, 2).setFormula(guard(
      'IF(' + src + '="direct","' + SITE_URL + '","' + SITE_URL + '/"&' + src + ')'
    ));
    sheet.getRange(r, 3).setFormula(guard('COUNTIF(' + T + '$B$2:$B,' + src + ')'));
    for (var s = 0; s < n; s++) {
      sheet.getRange(r, 4 + s).setFormula(guard(reached(FUNNEL_STEPS[s].screen, src)));
    }
    // Joined divided by taps, the number that says whether a link is working.
    sheet.getRange(r, 4 + n).setFormula(guard('IFERROR($' + colLetter(3 + n) + r + '/$C' + r + ',0)'));
  }
  sheet.getRange(first, 4 + n, MAX_SOURCES, 1).setNumberFormat('0%');

  // ---- demand, which is what matters when negotiating ----
  // Counted once per session per laptop, so somebody toggling a card on and off
  // does not count twice.
  sheet.getRange('N1').setFormula(
    '=IFERROR(QUERY(' + E + '$D$2:$E,"select Col2, count(Col1) where Col1 = ' + "'laptop_interest'" +
    ' group by Col2 order by count(Col1) desc label Col2 ' + "'Laptop shortlisted'" +
    ', count(Col1) ' + "'People'" + '",0),"Nothing yet")'
  );
  sheet.getRange('Q1').setFormula(
    '=IFERROR(QUERY(' + E + '$D$2:$E,"select Col2, count(Col1) where Col1 = ' + "'own_model'" +
    ' group by Col2 order by count(Col1) desc label Col2 ' + "'Asked for by name'" +
    ', count(Col1) ' + "'People'" + '",0),"Nothing yet")'
  );

  var note = first + MAX_SOURCES + 1;
  sheet.getRange(note, 1).setValue('Everything here recalculates on its own as people use the form. Nothing to press.');
  sheet.getRange(note + 1, 1).setValue('Room for ' + MAX_SOURCES + ' links. If you share more than that, run rebuildFunnel from the Apps Script editor after raising MAX_SOURCES.');
  sheet.getRange(note, 1, 2, 1).setFontColor('#888888');

  sheet.setColumnWidth(1, 130);
  sheet.setColumnWidth(2, 250);
  sheet.setFrozenRows(1);
}

// 1 becomes A, 2 becomes B, and so on. Only ever called with small numbers here.
function colLetter(n) {
  var out = '';
  while (n > 0) {
    var rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

// Written for whoever opens this spreadsheet without having built any of it.
// Plain words only, no jargon that is not explained on the spot.
var README_ROWS = [
  ['title', 'Picapool laptop group buy: how this sheet works'],
  ['body', 'Everything here fills itself in from the form at laptop.picapool.tech. Nothing needs to be typed by hand. Leave the sheet open, refresh the page now and then, and new rows appear as students use the form.'],
  ['blank', ''],

  ['head', 'The tabs along the bottom'],
  ['sub', 'Responses'],
  ['body', 'One row per student who finished the form: their name, phone number, budget, and the laptops they said they want. This is the list you actually work from when you call people or go to a seller.'],
  ['sub', 'Taps'],
  ['body', 'One row every time somebody opens the link, even if they close it a second later without filling anything in. Put this next to Responses and you can see how many people looked versus how many signed up.'],
  ['sub', 'Events'],
  ['body', 'A trail of every screen a person visited and every button they pressed. It is long and it is not meant to be read directly. The Funnel tab turns it into something useful.'],
  ['sub', 'Funnel'],
  ['body', 'The summary, and the one worth reading. The top block is everybody together: how many got to each step, and how many you lost at each one. Underneath it is the same thing split by link, so you can see that the hostel poster brought forty taps and two sign ups while the WhatsApp message brought twenty taps and eleven. Off to the right are the laptops the most people shortlisted, which is the number you take to a seller. It all updates on its own.'],
  ['blank', ''],

  ['head', 'Columns that are not obvious'],
  ['body', 'Lead ID and Session are random codes for one person’s phone. You can ignore both. They exist so that if somebody comes back and changes their mind, their existing row gets updated instead of a second row appearing for the same person.'],
  ['body', 'Source is which link the person came through. Share laptop.picapool.tech/whatsapp and everyone from that link is tagged whatsapp. Somebody typing the plain address is tagged direct.'],
  ['body', 'Submitted at is when they first filled the form. Updated at is when they last changed something.'],
  ['body', 'Own model or brand is a laptop the student typed in themselves because it was not on our list. These are worth reading. They are real requests.'],
  ['body', 'Pool price total and List price total are rough reference numbers for what somebody’s shortlist costs. Students never see a single price anywhere in the form. These are here only so whoever negotiates knows the ballpark.'],
  ['blank', ''],

  ['head', 'Making a new link for a poster or a group'],
  ['body', 'Pick any single word and put it after the address. Share laptop.picapool.tech/hostel and every response from that link is tagged hostel, so you can tell which posters and which groups actually worked. Nothing needs setting up first. The word just has to be one word with no spaces.'],
  ['body', 'The link appears on the Funnel tab on its own, the first time somebody uses it, with its taps and its own funnel next to it. The Share this address column there gives you the full address to copy. There is room for fifteen links.'],
  ['blank', ''],

  ['head', 'Safe to do'],
  ['body', 'Sort, filter, hide columns, colour rows, and add your own notes column at the far right of a tab. None of that breaks anything. Sorting Responses is fine even after people start editing their answers.'],
  ['head', 'Please do not'],
  ['body', 'Rename a tab, delete the top row of headings, or move, delete or rename any of the existing columns. The form writes into these tabs by position, so changing the layout makes new responses land in the wrong columns.'],
  ['blank', ''],

  ['head', 'Keep this sheet private'],
  ['body', 'These are real phone numbers of students in our batch. Do not share the link publicly, do not post screenshots with numbers showing, and share it person by person with only the few people who need it.'],
  ['blank', ''],

  ['head', 'If something looks wrong'],
  ['body', 'Funnel is showing zeroes: nobody has used the form yet. Once people start, it fills in on its own.'],
  ['body', 'A row changed instead of a new one appearing: that is the same person editing their answer. Working as intended.'],
  ['body', 'Nothing is arriving at all: the form’s connection to this sheet probably needs redeploying. Ask whoever set it up.'],
  ['body', 'A tab went missing: open Extensions, then Apps Script, choose setupSheets from the dropdown at the top and press Run. It rebuilds anything absent without touching existing data.']
];

function ensureReadmeSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(README_SHEET_NAME)) return;
  var sheet = ss.insertSheet(README_SHEET_NAME);
  buildReadmeSheet(sheet);
  // Whoever opens the spreadsheet should land on this first.
  ss.setActiveSheet(sheet);
  ss.moveActiveSheet(1);
}

function rebuildReadme() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var old = ss.getSheetByName(README_SHEET_NAME);
  if (old) ss.deleteSheet(old);
  ensureReadmeSheet();
}

function buildReadmeSheet(sheet) {
  sheet.getRange(1, 1, README_ROWS.length, 1)
    .setValues(README_ROWS.map(function (r) { return [r[1]]; }));

  for (var i = 0; i < README_ROWS.length; i++) {
    var cell = sheet.getRange(i + 1, 1);
    var kind = README_ROWS[i][0];
    if (kind === 'title') cell.setFontSize(16).setFontWeight('bold').setFontColor('#1C1C1E');
    else if (kind === 'head') cell.setFontSize(12).setFontWeight('bold').setFontColor('#F03506');
    else if (kind === 'sub') cell.setFontSize(11).setFontWeight('bold').setFontColor('#1C1C1E');
    else cell.setFontSize(10).setFontColor('#444444');
  }

  sheet.setColumnWidth(1, 780);
  sheet.getRange(1, 1, README_ROWS.length, 1).setWrap(true).setVerticalAlignment('top');
  sheet.setHiddenGridlines(true);
}

function recordTap(body) {
  var sheet = getTapSheet();
  var values = {};
  TAP_COLUMNS.forEach(function (c) { values[c.key] = body[c.key] != null ? body[c.key] : ''; });
  values.tappedAt = body.tappedAt ? new Date(body.tappedAt) : new Date();
  sheet.appendRow(TAP_COLUMNS.map(function (c) { return values[c.key]; }));
  return json({ ok: true, tapped: values.source, row: sheet.getLastRow() });
}

function getTapSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TAPS_SHEET_NAME) || ss.insertSheet(TAPS_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(TAP_COLUMNS.map(function (c) { return c.label; }));
    sheet.getRange(1, 1, 1, TAP_COLUMNS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function toRow(values) {
  return COLUMNS.map(function (c) { return values[c.key]; });
}

function keyIndex(key) {
  for (var i = 0; i < COLUMNS.length; i++) if (COLUMNS[i].key === key) return i;
  return -1;
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS.map(function (c) { return c.label; }));
    sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    // Phones arrive as +91XXXXXXXXXX. Text format stops Sheets mangling them.
    sheet.getRange(2, keyIndex('phone') + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
  }
  return sheet;
}

function findRowByLeadId(sheet, leadId) {
  if (!leadId) return 0;
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var vals = sheet.getRange(2, keyIndex('leadId') + 1, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) === String(leadId)) return i + 2;
  }
  return 0;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
