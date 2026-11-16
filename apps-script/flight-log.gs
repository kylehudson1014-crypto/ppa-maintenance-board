/**
 * PPA Maintenance Board — Flight Log sheet receiver (Google Apps Script).
 *
 * Setup is in apps-script/README.txt (create the Sheet in kylehudson1014@gmail.com,
 * Extensions → Apps Script, paste this file, set SHARED_TOKEN, deploy as a web app:
 * Execute as me / Who has access: Anyone, then paste the URL + token into Settings).
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
  'Tach photo', 'Hobbs photo'
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
  var sh = getOrCreateSheet();
  if (findReportRow(sh, data.reportId) >= 0) {
    return { ok: true, duplicate: true, reportId: data.reportId };
  }
  var tachUrl = savePhoto_(data.tachPhoto, data.tail, 'tach', data.reportId);
  var hobbsUrl = savePhoto_(data.hobbsPhoto, data.tail, 'hobbs', data.reportId);
  sh.appendRow(rowFrom(data, tachUrl, hobbsUrl));
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

function rowFrom(data, tachUrl, hobbsUrl) {
  var when = data.createdAt ? new Date(data.createdAt) : new Date();
  if (isNaN(when.getTime())) when = new Date();
  var submitted = Utilities.formatDate(when, TZ, 'yyyy-MM-dd HH:mm');
  var flightDate = Utilities.formatDate(when, TZ, 'yyyy-MM-dd');
  return [
    submitted, flightDate, data.tail, data.location,
    data.cfiName, data.cfiEmail, data.student,
    ncell(data.tachStart), ncell(data.tachEnd), ncell(delta_(data.tachStart, data.tachEnd)),
    ncell(data.hobbsStart), ncell(data.hobbsEnd), ncell(delta_(data.hobbsStart, data.hobbsEnd)),
    data.oilAdded ? 'Y' : 'N', data.oilAdded ? data.oilQts : '',
    data.squawkText, data.reportId,
    tachUrl || '', hobbsUrl || ''
  ];
}

function getOrCreateSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('This script must be bound to a Google Sheet (open it with Extensions → Apps Script from the Sheet).');
  var sh = ss.getSheetByName(TAB);
  if (!sh) sh = ss.insertSheet(TAB);
  var last = sh.getLastRow();
  if (last < 1) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.setFrozenRows(1);
    return sh;
  }
  var existing = sh.getRange(1, 1, 1, Math.max(HEADERS.length, sh.getLastColumn())).getValues()[0];
  var need = false;
  for (var i = 0; i < HEADERS.length; i++) {
    if (existing[i] !== HEADERS[i]) need = true;
  }
  if (need && !String(existing[0] || '').trim()) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.setFrozenRows(1);
  } else if (need) {
    // Add any missing photo columns on the right without rewriting older headers blindly.
    if (existing.indexOf('Tach photo') < 0) sh.getRange(1, existing.length + 1).setValue('Tach photo');
    if (sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].indexOf('Hobbs photo') < 0) {
      sh.getRange(1, sh.getLastColumn() + 1).setValue('Hobbs photo');
    }
  }
  return sh;
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
