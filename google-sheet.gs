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
  ['body', 'If you only read one thing: Responses is the list of people to contact, and Funnel tells you which links are working and which laptops are wanted.'],
  ['blank', ''],

  ['head', '1. What a student actually does'],
  ['body', 'Worth knowing, because every column here comes out of one of these steps.'],
  ['body', 'They open the link and press Find my laptop. They pick what they will mainly use it for, out of gaming, heavy coding, balanced everyday use, or design and editing. They pick a budget band. We then show them the laptops that fit both answers.'],
  ['body', 'They mark as many as they want with I am interested. If nothing on the list suits them, there is an optional box where they can type any model or brand themselves, and that alone is enough to carry on.'],
  ['body', 'Then they pick roughly which week they plan to buy, say how ready they are, and leave a name and mobile number. The number saves itself two seconds after they finish typing, so there is no submit button to miss.'],
  ['body', 'Afterwards they can go back, change their picks, and return. That updates their existing row rather than making a second one.'],
  ['body', 'Each laptop shown carries our reference price, in rupees with normal Indian comma grouping (57,999 or 1,02,999), so a student knows roughly what they are signing up for. That price is a starting point, not a final number: prices in India move every week, and the whole point of pooling is that we negotiate it down afterwards once we know how many of us want the same model.'],
  ['blank', ''],

  ['head', '2. The tabs along the bottom'],
  ['sub', 'Responses'],
  ['body', 'One row per student who finished the form: their name, phone number, budget, and the laptops they said they want. This is the list you actually work from when you call people or go to a seller.'],
  ['sub', 'Taps'],
  ['body', 'One row every time somebody opens a link, even if they close it a second later without filling anything in. Counted once per person per visit, so somebody refreshing the page does not count twice. Put this next to Responses and you can see how many people looked versus how many signed up.'],
  ['sub', 'Events'],
  ['body', 'A trail of every screen a person visited and every choice they made. It is long and it is not meant to be read directly. The Funnel tab turns it into something useful. No names or phone numbers are ever written here.'],
  ['sub', 'Funnel'],
  ['body', 'The summary, and the one worth reading. Described in full in section 4 below.'],
  ['sub', 'Read me first'],
  ['body', 'This page.'],
  ['blank', ''],

  ['head', '3. What every column means'],
  ['sub', 'Responses'],
  ['body', 'Submitted at is when they first filled the form. Updated at is when they last changed something. If those two differ, they came back and edited.'],
  ['body', 'Lead ID is a random code for one person’s phone. Ignore it. It exists so that somebody changing their mind updates their own row instead of creating a duplicate.'],
  ['body', 'Name and Phone are what they typed. Numbers are stored with +91 in front so you can copy one straight into WhatsApp.'],
  ['body', 'Primary use and Budget band are the two answers we match laptops on.'],
  ['body', 'Shortlisted laptops is everything they marked interested in, separated by a vertical bar, with our reference price next to each. Shortlist count is how many that was.'],
  ['body', 'Own model or brand is a laptop the student typed in themselves because it was not on our list. These are worth reading. They are real requests.'],
  ['body', 'Buying window is roughly when they plan to buy. Readiness is how certain they said they are, which is how you tell a firm buyer from somebody browsing.'],
  ['body', 'Pool price total and List price total are rough reference numbers for what somebody’s shortlist costs. Students never see these. They are here only so whoever negotiates knows the ballpark.'],
  ['body', 'Pool is which round of the group buy this was. Source is the link they came through. Host is the address they were on, which is only useful for spotting test entries.'],
  ['sub', 'Taps'],
  ['body', 'Tapped at is when they opened it. Source is the link. Path is the exact address after the slash. Been here before says yes if that phone had opened it on an earlier day. Came from shows which app or site they arrived from, when the phone tells us, so you can see whether WhatsApp or Instagram sent them.'],
  ['sub', 'Events'],
  ['body', 'At is the moment it happened. Session is a random code for one person’s single sitting. Source is the link. Device says whether they were on a phone, tablet or computer.'],
  ['body', 'Event and Detail are the pair that matter. Event says what happened, Detail says which one. The events you will see are: step_viewed with the screen name, chose_use, chose_budget, chose_week and chose_readiness with the answer they picked, laptop_interest with the laptop they marked, own_model with what they typed themselves, stretched_budget when they asked to see a higher band, skipped_picks when they chose to be texted options later, started_contact when they began typing their details, joined_pool when they finished, and restarted if they began again.'],
  ['body', 'A laptop counts once per person no matter how many times they tap it on and off, so the demand numbers cannot be inflated by somebody being indecisive.'],
  ['blank', ''],

  ['head', '4. Reading the Funnel tab'],
  ['body', 'The top block is everybody together. Each row is a step of the form, People is how many got that far, Share of openers is that as a percentage of everyone who opened the link, and Lost here is how many gave up at that step. The biggest number in the Lost here column is the thing worth fixing.'],
  ['body', 'The block underneath is the same funnel split by link. One row per link, with the full address to copy, how many taps it got, how far its people got, and what share of its taps ended up joining. This is how you tell that the hostel poster brought forty taps and two sign ups while the WhatsApp message brought twenty taps and eleven. There is room for fifteen links.'],
  ['body', 'Over on the right are two lists. The first ranks laptops by how many people shortlisted them, including people who never finished the form, which is the number to take to a seller. The second lists the models people asked for by name.'],
  ['body', 'Every number on that tab is a live formula. It recalculates on its own. There is nothing to press and nothing to refresh.'],
  ['blank', ''],

  ['head', '5. Making a new link for a poster or a group'],
  ['body', 'Pick any single word and put it after the address. Share laptop.picapool.tech/hostel and every response from that link is tagged hostel, so you can tell which posters and which groups actually worked. Nothing needs setting up first. The word just has to be one word with no spaces.'],
  ['body', 'The link appears on the Funnel tab on its own, the first time somebody uses it, with its taps and its own funnel next to it. The Share this address column there gives you the full address to copy.'],
  ['body', 'Somebody typing the plain address with nothing after the slash is tagged direct.'],
  ['blank', ''],

  ['head', '6. The three buttons you can press'],
  ['body', 'These live in the script behind the sheet. To reach them: open Extensions in the menu above, choose Apps Script, and a code window opens in a new tab. Along the top of that window is a dropdown listing names. Pick one and press Run. The first time, Google asks you to allow it, which is expected for your own script.'],
  ['body', 'You will almost never need these. Nothing here is required for the form to work day to day.'],
  ['sub', 'setupSheets'],
  ['body', 'Creates any tab that is missing and leaves existing ones alone. Use it if a tab gets deleted by accident, or right after setting the sheet up, so everything exists before the first student arrives.'],
  ['sub', 'rebuildFunnel'],
  ['body', 'Deletes the Funnel tab and builds it again. Use it if the layout there has been changed by mistake, or if a formula shows an error. It touches no data at all, since that tab holds nothing but formulas.'],
  ['sub', 'rebuildReadme'],
  ['body', 'Deletes this page and writes it again. Use it if this page gets edited by accident.'],
  ['body', 'One more thing, for whoever looks after the code: editing the script alone changes nothing. The new version has to be published from the Deploy button at the top right of the code window, choosing Manage deployments and then a new version. Until that happens the form keeps using the old one.'],
  ['blank', ''],

  ['head', '7. Safe to do'],
  ['body', 'Sort, filter, hide columns, colour rows, and add your own notes column at the far right of a tab. None of that breaks anything. Sorting Responses is fine even after people start editing their answers, because the form finds somebody’s row by their code rather than by where it sits.'],
  ['head', 'Please do not'],
  ['body', 'Rename a tab, delete the top row of headings, or move, delete or rename any of the existing columns. The form writes into these tabs by position, so changing the layout makes new responses land in the wrong columns.'],
  ['blank', ''],

  ['head', '8. Keep this sheet private'],
  ['body', 'These are real phone numbers of students in our batch. Do not share the link publicly, do not post screenshots with numbers showing, and share it person by person with only the few people who need it.'],
  ['body', 'The Events tab deliberately holds no names or numbers, so if you ever need to show somebody how the form is performing, that tab and the Funnel tab are safe to share on their own.'],
  ['blank', ''],

  ['head', '9. If something looks wrong'],
  ['body', 'Funnel is showing zeroes: nobody has used the form yet. Once people start, it fills in on its own.'],
  ['body', 'A row changed instead of a new one appearing: that is the same person editing their answer. Working as intended.'],
  ['body', 'The same person appears twice: they used a different phone, or cleared their browser between visits. There is no way for us to tell those apart.'],
  ['body', 'A tab went missing: run setupSheets, as described in section 6.'],
  ['body', 'A number on Funnel looks impossible: run rebuildFunnel.'],
  ['body', 'More than fifteen links are in use: the extra names appear but their numbers do not. Ask whoever looks after the code to raise the limit.'],
  ['body', 'Nothing is arriving at all, from anybody: the form’s connection to this sheet has probably not been published since the last change. Ask whoever set it up.'],
  ['blank', ''],
  ['body', 'The form’s code lives at github.com/latharrr/gb-laptop-pp, and the technical notes are in the README file there.']
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
    // Indian digit grouping (57,999 / 1,02,999) instead of the default 57999,
    // to match the price shown on screen and in the "Shortlisted laptops" text.
    var RUPEE_FORMAT = '"₹"#,##,##0';
    sheet.getRange(2, keyIndex('poolTotal') + 1, sheet.getMaxRows() - 1, 1).setNumberFormat(RUPEE_FORMAT);
    sheet.getRange(2, keyIndex('listTotal') + 1, sheet.getMaxRows() - 1, 1).setNumberFormat(RUPEE_FORMAT);
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
