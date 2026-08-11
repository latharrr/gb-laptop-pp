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
    'Picapool endpoint is live. Responses go to the "' + SHEET_NAME + '" sheet, ' +
    'link taps go to "' + TAPS_SHEET_NAME + '".'
  );
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
