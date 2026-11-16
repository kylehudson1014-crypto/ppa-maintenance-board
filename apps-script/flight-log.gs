/**
 * PPA Maintenance Board — Flight Log sheet receiver (Google Apps Script).
 *
 * Setup is in apps-script/README.txt (create the Sheet in kylehudson1014@gmail.com,
 * Extensions → Apps Script, paste this file, set SHARED_TOKEN, deploy as a web app:
 * Execute as me / Who has access: Anyone, then paste the URL + token into Settings).
 *
 * After pasting a new version: Deploy → Manage deployments → pencil → Version: New version → Deploy.
 * The web app URL stays the same. Opening the Sheet also upgrades existing tabs (onOpen).
 *
 * Script properties (Project Settings → Script properties):
 *   SHARED_TOKEN   must match the token stored on the board
 *
 * The board POSTs text/plain JSON (mode: no-cors). Tokens in a public web app are only
 * light protection: the URL and token live in config/public so the CFI page can send
 * rows, and anyone who can load the board can read them. This script still validates
 * fields, ignores duplicate Report IDs, and does not accept unpaid third-party APIs.
 *
 * Optional base64 JPEG fields tachPhoto / hobbsPhoto are saved to a Drive folder
 * named "PPA Flight Log Photos". Links go in the Tach photo and Hobbs photo columns.
 * Photos are never written back to Firestore.
 *
 * Each monthly tab (and the older "Flight Log" tab) has Billed / Billed by / Billed on
 * columns for the secretary. Checking Billed auto-fills Billed on (America/Chicago); Billed by is left for initials.
 */
var TZ = 'America/Chicago';
var TAB = 'Flight Log';
var PHOTO_FOLDER = 'PPA Flight Log Photos';
var HEADERS = [
  'Submitted (America/Chicago)', 'Flight date', 'Tail', 'Location',
  'CFI name', 'CFI email', 'Student',
  'Tach start', 'Tach end', 'Tach time',
  'Hobbs start', 'Hobbs end', 'Hobbs time',
  'Oil added (Y/N)', 'Oil qts', 'Squawk text', 'Report ID',
  'Tach photo', 'Hobbs photo',
  'Billed', 'Billed by', 'Billed on'
];
var MAX_PHOTO_BYTES = 2 * 1024 * 1024;
var QTS = { '0.5': 1, '1': 1, '1.5': 1, '2': 1, '2.5': 1, '3': 1, '3.5': 1, '4': 1 };

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) || '';
    var result = appendFlightLog(raw);
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'PPA Flight Log' })).setMimeType(ContentService.MimeType.JSON);
}

/** Main entry used by tests and doPost. */
function appendFlightLog(raw) {
  var data = parseAndValidate(raw);
  if (reportExistsAnywhere_(data.reportId)) {
    return { ok: true, duplicate: true, reportId: data.reportId };
  }
  ensureAllLogTabs_();
  var sh = getOrCreateSheet(data.createdAt);
  var tachUrl = savePhoto_(data.tachPhoto, data.tail, 'tach', data.reportId);
  var hobbsUrl = savePhoto_(data.hobbsPhoto, data.tail, 'hobbs', data.reportId);
  appendLogRow_(sh, data, tachUrl, hobbsUrl);
  return { ok: true, added: true, reportId: data.reportId, tachPhoto: tachUrl, hobbsPhoto: hobbsUrl };
}

function parseAndValidate(raw) {
  if (!raw || !String(raw).trim()) throw new Error('Empty request');
  var obj;
  try { obj = JSON.parse(String(raw)); } catch (e) { throw new Error('Body is not valid JSON'); }
  if (!obj || typeof obj !== 'object') throw new Error('Body is not an object');

  var expected = PropertiesService.getScriptProperties().getProperty('SHARED_TOKEN');
  if (!expected) throw new Error('SHARED_TOKEN is not set in Script properties');
  if (String(obj.token || '') !== String(expected)) throw new Error('Token does not match');

  var reportId = clampStr(obj.reportId, 80);
  if (!reportId) throw new Error('Report ID is required');
  var tail = clampStr(obj.tail, 20);
  if (!tail) throw new Error('Tail is required');

  var oilAdded = !!obj.oilAdded && obj.oilAdded !== 'N' && obj.oilAdded !== 'n' && obj.oilAdded !== 'false';
  if (obj.oilAdded === 'Y' || obj.oilAdded === 'y' || obj.oilAdded === 'yes') oilAdded = true;
  var oilQts = null;
  if (oilAdded) {
    if (obj.oilQts == null || obj.oilQts === '') throw new Error('Oil quarts required when oil was added');
    oilQts = Number(obj.oilQts);
    if (isNaN(oilQts) || !QTS[String(oilQts)]) throw new Error('Oil quarts must be 0.5 to 4 in half-quart steps');
  }

  var tachStart = numOrNull(obj.tachStart), tachEnd = numOrNull(obj.tachEnd);
  var hobbsStart = numOrNull(obj.hobbsStart), hobbsEnd = numOrNull(obj.hobbsEnd);
  assertMeterPair('Tach', tachStart, tachEnd);
  assertMeterPair('Hobbs', hobbsStart, hobbsEnd);

  return {
    reportId: reportId,
    createdAt: clampStr(obj.createdAt, 40),
    tail: tail,
    location: clampStr(obj.location, 20),
    cfiName: clampStr(obj.cfiName, 80),
    cfiEmail: clampStr(obj.cfiEmail, 80).toLowerCase(),
    student: clampStr(obj.student, 80),
    tachStart: tachStart, tachEnd: tachEnd,
    hobbsStart: hobbsStart, hobbsEnd: hobbsEnd,
    oilAdded: oilAdded,
    oilQts: oilAdded ? oilQts : '',
    squawkText: clampStr(obj.squawkText, 500),
    tachPhoto: stripDataUrl(obj.tachPhoto),
    hobbsPhoto: stripDataUrl(obj.hobbsPhoto)
  };
}

function whenOf_(createdAt) {
  var n = Number(createdAt);
  var when = createdAt ? new Date(isNaN(n) ? createdAt : n) : new Date();
  return isNaN(when.getTime()) ? new Date() : when;
}

function rowObject_(data, tachUrl, hobbsUrl) {
  var when = whenOf_(data.createdAt);
  if (isNaN(when.getTime())) when = new Date();
  var submitted = Utilities.formatDate(when, TZ, 'yyyy-MM-dd HH:mm');
  var flightDate = Utilities.formatDate(when, TZ, 'yyyy-MM-dd');
  return {
    'Submitted (America/Chicago)': submitted,
    'Flight date': flightDate,
    'Tail': data.tail,
    'Location': data.location,
    'CFI name': data.cfiName,
    'CFI email': data.cfiEmail,
    'Student': data.student,
    'Tach start': ncell(data.tachStart),
    'Tach end': ncell(data.tachEnd),
    'Tach time': ncell(delta_(data.tachStart, data.tachEnd)),
    'Hobbs start': ncell(data.hobbsStart),
    'Hobbs end': ncell(data.hobbsEnd),
    'Hobbs time': ncell(delta_(data.hobbsStart, data.hobbsEnd)),
    'Oil added (Y/N)': data.oilAdded ? 'Y' : 'N',
    'Oil qts': data.oilAdded ? data.oilQts : '',
    'Squawk text': data.squawkText,
    'Report ID': data.reportId,
    'Tach photo': tachUrl || '',
    'Hobbs photo': hobbsUrl || '',
    'Billed': false,
    'Billed by': '',
    'Billed on': ''
  };
}

function appendLogRow_(sh, data, tachUrl, hobbsUrl) {
  ensureLogSheet_(sh);
  var headers = headerRow_(sh);
  var obj = rowObject_(data, tachUrl, hobbsUrl);
  var row = [];
  for (var i = 0; i < headers.length; i++) {
    row.push(Object.prototype.hasOwnProperty.call(obj, headers[i]) ? obj[headers[i]] : '');
  }
  sh.appendRow(row);
}

// One tab per month, named like "2026-11 Nov", from the flight's date. Newest month goes first.
function monthTabName_(createdAt) {
  return Utilities.formatDate(whenOf_(createdAt), TZ, 'yyyy-MM MMM');
}

function isLogTab_(name) { return name === TAB || /^\d{4}-\d{2} [A-Za-z]{3}$/.test(name); }

function reportExistsAnywhere_(reportId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return false;
  var tabs = ss.getSheets();
  for (var i = 0; i < tabs.length; i++) {
    if (isLogTab_(tabs[i].getName()) && findReportRow(tabs[i], reportId) >= 0) return true;
  }
  return false;
}

function getOrCreateSheet(createdAt) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('This script must be bound to a Google Sheet (open it with Extensions → Apps Script from the Sheet).');
  var name = monthTabName_(createdAt);
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name, 0); }
  return ensureLogSheet_(sh);
}

function headerRow_(sh) {
  var last = Math.max(sh.getLastColumn(), 1);
  if (sh.getLastRow() < 1) return [];
  return sh.getRange(1, 1, 1, last).getValues()[0];
}

function colLetter_(n) {
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Add any missing headers on the right, then checkboxes, colors, freeze, and a filter. */
function ensureLogSheet_(sh) {
  var existing = headerRow_(sh);
  var blank = !existing.length || !String(existing[0] || '').trim();
  if (blank) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  } else {
    for (var i = 0; i < HEADERS.length; i++) {
      var have = headerRow_(sh);
      if (have.indexOf(HEADERS[i]) < 0) {
        sh.getRange(1, Math.max(sh.getLastColumn(), have.length) + 1).setValue(HEADERS[i]);
      }
    }
  }
  applyBillingUi_(sh);
  return sh;
}

function ensureAllLogTabs_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return;
  var tabs = ss.getSheets();
  for (var i = 0; i < tabs.length; i++) {
    if (isLogTab_(tabs[i].getName())) ensureLogSheet_(tabs[i]);
  }
}

function applyBillingUi_(sh) {
  var headers = headerRow_(sh);
  var billedCol = headers.indexOf('Billed') + 1;
  var lastCol = Math.max(headers.length, sh.getLastColumn(), HEADERS.length);
  sh.setFrozenRows(1);
  var maxRows = Math.max(sh.getMaxRows(), 2);
  if (billedCol) {
    sh.getRange(2, billedCol, maxRows - 1, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireCheckbox().setAllowInvalid(false).build()
    );
  }
  var range = sh.getRange(2, 1, maxRows - 1, lastCol);
  var letter = billedCol ? colLetter_(billedCol) : 'T';
  var green = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$' + letter + '2=TRUE')
    .setBackground('#d9ead3')
    .setRanges([range])
    .build();
  var yellow = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$' + letter + '2<>TRUE')
    .setBackground('#fff2cc')
    .setRanges([range])
    .build();
  sh.setConditionalFormatRules([green, yellow]);
  var filter = sh.getFilter();
  if (filter) filter.remove();
  sh.getRange(1, 1, Math.max(sh.getLastRow(), 2), lastCol).createFilter();
}

/** Simple trigger: checking Billed fills Billed on (and Billed by if we know the user). Unchecking clears the date. */
function onEdit(e) {
  handleBilledEdit_(e);
}

function handleBilledEdit_(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (!isLogTab_(sh.getName())) return;
  if (e.range.getRow() < 2) return;
  var headers = headerRow_(sh);
  var billedCol = headers.indexOf('Billed') + 1;
  var byCol = headers.indexOf('Billed by') + 1;
  var onCol = headers.indexOf('Billed on') + 1;
  if (!billedCol) return;
  var startCol = e.range.getColumn();
  var endCol = startCol + e.range.getNumColumns() - 1;
  if (billedCol < startCol || billedCol > endCol) return;
  var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  var n = e.range.getNumRows();
  var start = e.range.getRow();
  for (var i = 0; i < n; i++) {
    var row = start + i;
    var val = sh.getRange(row, billedCol).getValue();
    var checked = val === true || val === 'TRUE' || val === 'Yes' || val === 'Y';
    if (checked) {
      if (onCol) sh.getRange(row, onCol).setValue(today);
      // Leave Billed by for the secretary's initials. Session.getActiveUser()
      // would add a userinfo.email scope and often returns blank on consumer accounts.
    } else if (onCol) {
      sh.getRange(row, onCol).clearContent();
    }
  }
}

/** Opening the Sheet upgrades older tabs (including "Flight Log") with billing columns. */
function onOpen() {
  ensureAllLogTabs_();
}

function findReportRow(sh, reportId) {
  var vals = sh.getDataRange().getValues();
  if (!vals.length) return -1;
  var col = vals[0].indexOf('Report ID');
  if (col < 0) col = 16;
  for (var r = 1; r < vals.length; r++) {
    if (String(vals[r][col] || '') === String(reportId)) return r + 1;
  }
  return -1;
}

function savePhoto_(b64, tail, kind, reportId) {
  if (!b64) return '';
  var raw = String(b64).replace(/\s/g, '');
  if (!raw) return '';
  // base64 length ≈ 4/3 of bytes; reject oversized payloads before decode.
  if (raw.length > Math.ceil(MAX_PHOTO_BYTES * 4 / 3) + 32) throw new Error(kind + ' photo is too large');
  var bytes;
  try { bytes = Utilities.base64Decode(raw); } catch (e) { throw new Error(kind + ' photo is not valid base64'); }
  if (!bytes || bytes.length > MAX_PHOTO_BYTES) throw new Error(kind + ' photo is too large');
  var folder = getOrCreatePhotoFolder();
  var safeTail = String(tail || 'plane').replace(/[^\w\-]/g, '');
  var name = safeTail + '_' + kind + '_' + String(reportId || 'x').replace(/[^\w\-]/g, '') + '.jpg';
  var blob = Utilities.newBlob(bytes, 'image/jpeg', name);
  var file = folder.createFile(blob);
  return file.getUrl();
}

function getOrCreatePhotoFolder() {
  var it = DriveApp.getFoldersByName(PHOTO_FOLDER);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(PHOTO_FOLDER);
}

function clampStr(v, max) {
  if (v == null) return '';
  var s = String(v).trim();
  return s.length > max ? s.slice(0, max) : s;
}
function numOrNull(v) {
  if (v == null || v === '') return null;
  var n = Number(v);
  if (isNaN(n)) throw new Error('Meter value is not a number');
  return n;
}
function assertMeterPair(label, s, e) {
  function ok(v) { return v == null || (v >= 0 && v <= 100000); }
  if (!ok(s) || !ok(e)) throw new Error(label + ' must be between 0 and 100000');
  if (s != null && e != null && e < s) throw new Error('End ' + label + ' is earlier than start');
}
function delta_(s, e) {
  if (s == null || e == null) return '';
  return Math.round((e - s) * 10) / 10;
}
function ncell(v) { return v == null || v === '' ? '' : v; }
function stripDataUrl(v) {
  if (!v) return '';
  var s = String(v);
  var i = s.indexOf('base64,');
  return (i >= 0 ? s.slice(i + 7) : s).replace(/\s/g, '');
}
