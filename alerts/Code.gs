/**
 * PPA Maintenance Board — FREE email alert sender (Google Apps Script, runs in a Google account).
 * Also copy js/status.js into this Apps Script project as a file named "status" (same logic as the board).
 *
 * Script properties (Project Settings → Script properties):
 *   FIREBASE_API_KEY   apiKey from the board's Firebase config
 *   FIREBASE_PROJECT   projectId from the board's Firebase config
 *   BOT_EMAIL          email of the "Alert sender (robot)" login you created in Firebase Auth
 *   BOT_PASSWORD       that login's password
 *   BOARD_URL          e.g. https://kylehudson1014-crypto.github.io/ppa-maintenance-board/
 *   TIMEZONE           optional, default America/Chicago
 *
 * Emails go out ONLY when the board's Settings → Alerts → "Send alert emails" switch is ON.
 * Otherwise every run is a dry run (see View → Executions / Logs).
 * The first run only records a baseline (no emails), so nobody gets a flood on day one.
 */
var PROPS = PropertiesService.getScriptProperties();
function prop_(k, d) { var v = PROPS.getProperty(k); return v == null || v === '' ? d : v; }

function signIn_() {
  var r = UrlFetchApp.fetch(prop_('AUTH_URL', 'https://identitytoolkit.googleapis.com') + '/v1/accounts:signInWithPassword?key=' + prop_('FIREBASE_API_KEY'), {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ email: prop_('BOT_EMAIL'), password: prop_('BOT_PASSWORD'), returnSecureToken: true }) });
  var j = JSON.parse(r.getContentText());
  if (!j.idToken) throw new Error('Sign-in failed: ' + r.getContentText());
  return j.idToken;
}
function fsBase_() { return prop_('FIRESTORE_URL', 'https://firestore.googleapis.com') + '/v1/projects/' + prop_('FIREBASE_PROJECT') + '/databases/(default)/documents/'; }
function fromFs_(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFs_);
  if ('mapValue' in v) return fieldsToObj_(v.mapValue.fields || {});
  return null;
}
function fieldsToObj_(f) { var o = {}; Object.keys(f || {}).forEach(function (k) { o[k] = fromFs_(f[k]); }); return o; }
function fsGet_(path, token) {
  var r = UrlFetchApp.fetch(fsBase_() + path, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (r.getResponseCode() === 404) return null;
  if (r.getResponseCode() !== 200) throw new Error('Read ' + path + ' failed: ' + r.getContentText());
  return fieldsToObj_(JSON.parse(r.getContentText()).fields);
}
function fsList_(coll, token) {
  var out = [], pageToken = '';
  do {
    var r = UrlFetchApp.fetch(fsBase_() + coll + '?pageSize=300' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''), { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error('List ' + coll + ' failed: ' + r.getContentText());
    var j = JSON.parse(r.getContentText());
    (j.documents || []).forEach(function (d) { var o = fieldsToObj_(d.fields); o.id = d.name.split('/').pop(); out.push(o); });
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
}

function loadBoard_() {
  var token = signIn_();
  return {
    settings: fsGet_('config/public', token) || {},
    alerts: fsGet_('config/alerts', token) || { enabled: false, recipients: [] },
    aircraft: fsList_('aircraft', token),
    squawks: fsList_('squawks', token).filter(function (s) { return s.status === 'open'; })
  };
}
function recipientsFor_(alerts, a) {
  return (alerts.recipients || []).filter(function (r) { return r.active !== false && r.email && (!(r.locations || []).length || r.locations.indexOf(a.location) >= 0); }).map(function (r) { return r.email; });
}
function locCode_(settings, id) { var l = (settings.locations || []).filter(function (x) { return x.id === id; })[0]; return l ? l.code : ''; }

/** Main job. Run by a time trigger (see installTrigger). */
function checkAndAlert() {
  var tz = prop_('TIMEZONE', 'America/Chicago'), today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var b = loadBoard_();
  // Planes marked "Away from Patriot" in Edit (e.g. N97459) get no alerts until restored.
  if (PPAStatus.activeAircraft) b.aircraft = PPAStatus.activeAircraft(b.aircraft, b.settings);
  if (PPAStatus.dedupeByTail) b.aircraft = PPAStatus.dedupeByTail(b.aircraft);
  var now = {}; b.aircraft.forEach(function (a) { now[a.id] = PPAStatus.evaluate(a, b.settings, b.squawks, today); });
  var prevRaw = PROPS.getProperty('LAST_STATE'), prev = prevRaw ? JSON.parse(prevRaw) : null;
  var sendOn = b.alerts.enabled === true, sent = [], wouldSend = [];
  if (prev) {
    PPAStatus.alertEvents(b.aircraft, prev, now, b.alerts).forEach(function (ev) {
      var to = recipientsFor_(b.alerts, ev.aircraft); if (!to.length) return;
      var subject = '[PPA] ' + ev.subject + (locCode_(b.settings, ev.aircraft.location) ? ' (' + locCode_(b.settings, ev.aircraft.location) + ')' : '');
      var body = ev.aircraft.tail + ' — ' + (ev.aircraft.type || '') + '\n\n' + ev.text + '\n\n' + (ev.aircraft.statusNote ? 'Note: ' + ev.aircraft.statusNote + '\n\n' : '') +
        'Live board: ' + prop_('BOARD_URL', '') + '#board\n\nTracking aid only. The aircraft logbooks are the legal record; the PIC makes the final airworthiness call.';
      var msg = { to: Session.getEffectiveUser().getEmail(), bcc: to.join(','), subject: subject, body: body, name: 'PPA Maintenance Board' };
      if (sendOn) { MailApp.sendEmail(msg); sent.push(subject); } else wouldSend.push(subject + ' → ' + to.join(', '));
    });
  }
  // daily digest
  var hour = Number(Utilities.formatDate(new Date(), tz, 'H'));
  if (b.alerts.digest && hour === Number(b.alerts.digestHour == null ? 7 : b.alerts.digestHour) && PROPS.getProperty('LAST_DIGEST') !== today) {
    var lines = b.aircraft.map(function (a) { var e = now[a.id]; return { a: a, e: e }; }).filter(function (x) { return x.e.overall !== 'ok'; })
      .map(function (x) { return (x.e.overall === 'grounded' ? 'GROUNDED  ' : 'DUE SOON  ') + x.a.tail + ' (' + locCode_(b.settings, x.a.location) + '): ' + x.e.reasons.join('; '); });
    var all = (b.alerts.recipients || []).filter(function (r) { return r.active !== false && r.email; }).map(function (r) { return r.email; });
    var dsub = '[PPA] Daily maintenance summary ' + today + ' — ' + lines.length + ' need attention';
    var dbody = (lines.length ? lines.join('\n') : 'All aircraft current.') + '\n\nBoard: ' + prop_('BOARD_URL', '') + '#board';
    if (all.length) { if (sendOn) { MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(), bcc: all.join(','), subject: dsub, body: dbody, name: 'PPA Maintenance Board' }); sent.push(dsub); } else wouldSend.push(dsub + ' → ' + all.join(', ')); }
    PROPS.setProperty('LAST_DIGEST', today);
  }
  var state = {}; Object.keys(now).forEach(function (id) { state[id] = { overall: now[id].overall }; });
  PROPS.setProperty('LAST_STATE', JSON.stringify(state));
  Logger.log((prev ? '' : 'FIRST RUN: baseline saved, no emails. ') + (sendOn ? 'SENT: ' + JSON.stringify(sent) : 'Sending is OFF. Would send: ' + JSON.stringify(wouldSend)));
  return { sent: sent, wouldSend: wouldSend, baseline: !prev };
}

/** Run once by hand to schedule checks every 15 minutes. */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'checkAndAlert') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('checkAndAlert').timeBased().everyMinutes(15).create();
}
/** Stop all alerts from this script. */
function removeTrigger() { ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); }); }
/** Forget the last state (next run becomes a silent baseline again). */
function resetBaseline() { PROPS.deleteProperty('LAST_STATE'); }
