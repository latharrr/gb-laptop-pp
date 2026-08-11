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
var SHARED_SECRET = '';

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
    'Picapool endpoint is live. Responses go to "' + SHEET_NAME + '", link taps to "' +
    TAPS_SHEET_NAME + '", step by step activity to "' + EVENTS_SHEET_NAME + '", and "' +
    FUNNEL_SHEET_NAME + '" works out where people drop off.'
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
  sheet.getRange('A1:D1').setValues([['Step', 'People', 'Share of openers', 'Lost here']]).setFontWeight('bold');

  for (var i = 0; i < FUNNEL_STEPS.length; i++) {
    var row = i + 2;
    // Distinct sessions that reached this screen at least once.
    sheet.getRange(row, 1).setValue(FUNNEL_STEPS[i].label);
    sheet.getRange(row, 2).setFormula(
      '=IFERROR(COUNTA(UNIQUE(FILTER(' + E + '$B$2:$B,' + E + '$D$2:$D="step_viewed",' +
      E + '$E$2:$E="' + FUNNEL_STEPS[i].screen + '"))),0)'
    );
    sheet.getRange(row, 3).setFormula('=IFERROR($B' + row + '/$B$2,0)');
    if (i > 0) sheet.getRange(row, 4).setFormula('=IFERROR($B' + (row - 1) + '-$B' + row + ',0)');
  }
  sheet.getRange(2, 3, FUNNEL_STEPS.length, 1).setNumberFormat('0%');

  // Demand, which is the number that matters when negotiating. Counted once per
  // session per laptop, so a person toggling a card on and off counts once.
  sheet.getRange('F1').setFormula(
    '=IFERROR(QUERY(' + E + '$D$2:$E,"select Col2, count(Col1) where Col1 = ' + "'laptop_interest'" +
    ' group by Col2 order by count(Col1) desc label Col2 ' + "'Laptop shortlisted'" +
    ', count(Col1) ' + "'People'" + '",0),"Nothing yet")'
  );
  sheet.getRange('I1').setFormula(
    '=IFERROR(QUERY(' + E + '$D$2:$E,"select Col2, count(Col1) where Col1 = ' + "'own_model'" +
    ' group by Col2 order by count(Col1) desc label Col2 ' + "'Asked for by name'" +
    ', count(Col1) ' + "'People'" + '",0),"Nothing yet")'
  );
  sheet.getRange('L1').setFormula(
    '=IFERROR(QUERY(' + E + '$C$2:$D,"select Col1, count(Col2) where Col2 = ' + "'step_viewed'" +
    ' group by Col1 order by count(Col2) desc label Col1 ' + "'Link'" +
    ', count(Col2) ' + "'Steps taken'" + '",0),"Nothing yet")'
  );

  sheet.getRange('A12').setValue('Everything here recalculates on its own as the Events sheet fills up.');
  sheet.getRange('A13').setValue('Run rebuildFunnel from the Apps Script editor to recreate this sheet.');
  sheet.getRange('A12:A13').setFontColor('#888888');
  sheet.setColumnWidth(1, 170);
  sheet.setFrozenRows(1);
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
