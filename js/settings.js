/* Settings: lists, thresholds, TV, alerts, people, CSV import/export, go-live. */
var PPASettings = (function () {
  var U = window.PPAUI, V = PPAViews, S = PPAStatus, st = Store.state;
  var esc = U.esc, $ = U.$, $$ = U.$$, toast = U.toast, opt = V.opt, clone = V.clone;
  var GROUPS = ['CFI', 'Customer', 'Renter', 'Mechanic', 'Owner', 'Dispatch'];
  var CSV_COLS = ['tail', 'type', 'location', 'meter', 'current_tach', 'tach_date', 'current_hobbs', 'hobbs_date', 'current_hours', 'hours_date', 'ifr', 'for_hire', 'annual_done', 'last_100hr_at', 'pitot_static_done', 'transponder_done', 'elt_done', 'elt_battery_expires', 'status_note', 'expected_back', 'fsp_aircraft_id'];
  var ALIASES = { 'tail number': 'tail', tailnumber: 'tail', registration: 'tail', 'n-number': 'tail', aircraft: 'tail', model: 'type', 'make/model': 'type', base: 'location', airport: 'location', 'current hobbs': 'current_hobbs', 'current tach': 'current_tach', hobbs: 'current_hobbs', tach: 'current_tach', 'hobbs time': 'current_hobbs', 'tach time': 'current_tach', hours: 'current_hours', 'current hours': 'current_hours', 'aircraft id': 'fsp_aircraft_id', aircraftid: 'fsp_aircraft_id' };
  var pendingImport = null;

  function saveS(mut, msg) { var s = clone(st.settings); mut(s); return Store.saveSettings(s).then(function () { if (msg) toast(msg); U.render(true); }); }
  function saveA(mut, msg) { var a = clone(st.alerts || {}); mut(a); return Store.saveAlerts(a).then(function () { if (msg) toast(msg); U.render(true); }); }

  function strList(key, title, help) {
    var l = st.settings[key] || [];
    return '<div class="card"><h2>' + title + '</h2>' + (help ? '<p class="sub" style="color:var(--mute)">' + help + '</p>' : '') + '<div class="listed">' + l.map(function (x, i) {
      return '<div class="li"><input type="text" data-sl="' + key + '" data-i="' + i + '" value="' + esc(x) + '"><button class="iconbtn" data-slu="' + key + '" data-i="' + i + '">↑</button><button class="iconbtn" data-sld="' + key + '" data-i="' + i + '">↓</button><button class="iconbtn" data-slx="' + key + '" data-i="' + i + '">✕</button></div>';
    }).join('') + '</div><div class="row" style="margin-top:8px"><input type="text" data-sladd="' + key + '" placeholder="Add new…" style="flex:1"><button class="btn" data-sladdb="' + key + '">Add</button></div></div>';
  }
  function swap(arr, i, d) { var j = i + d; if (j < 0 || j >= arr.length) return arr; var t = arr[i]; arr[i] = arr[j]; arr[j] = t; return arr; }

  function view() {
    var s = st.settings, al = st.alerts || {}, R = S.rules(s), tv = s.tv || {}, pub = s.public || {};
    var used = {}; st.aircraft.forEach(function (a) { used[a.location] = (used[a.location] || 0) + 1; });
    var base = location.href.split('#')[0];
    var pendingReqs = (st.accessRequests || []).filter(function (x) { return x.status === 'pending'; });
    var pendBadge = pendingReqs.length ? ' <span class="reqbadge">' + pendingReqs.length + '</span>' : '';
    var html = U.topbar('Settings', 'Everything here is editable without code') + '<div class="wrap" style="max-width:980px">' + U.demoBanner() +
      '<div class="chips"><button class="btn sm" data-jump="s-loc">Locations</button><button class="btn sm" data-jump="s-lists">Lists</button><button class="btn sm" data-jump="s-rules">Due rules</button><button class="btn sm" data-jump="s-tv">TV & public</button><button class="btn sm" data-jump="s-alerts">Alerts</button><button class="btn sm" data-jump="s-people">People' + pendBadge + '</button><button class="btn sm" data-jump="s-flog">Flight log Sheet</button><button class="btn sm" data-jump="s-data">CSV / data</button><button class="btn sm" data-jump="s-live">Go live</button></div>' +

      // locations
      '<div class="card" id="s-loc"><h2>Locations (schools / airports)</h2><div class="listed">' + (s.locations || []).map(function (l, i) {
        return '<div class="li"><input type="text" data-loc="' + i + '.code" value="' + esc(l.code) + '" style="max-width:110px;flex:0 0 110px" placeholder="KECP"><input type="text" data-loc="' + i + '.name" value="' + esc(l.name) + '" placeholder="Name"><span class="sub" style="color:var(--mute)">' + (used[l.id] || 0) + ' aircraft</span><button class="iconbtn" data-locu="' + i + '">↑</button><button class="iconbtn" data-locd="' + i + '">↓</button><button class="iconbtn" data-locx="' + i + '">✕</button></div>';
      }).join('') + '</div><div class="row" style="margin-top:8px"><input type="text" id="nlc" placeholder="Code (e.g. KPFN)" style="max-width:160px"><input type="text" id="nln" placeholder="Name" style="flex:1"><button class="btn" id="addloc">Add location</button></div>' +
      '<p class="sub" style="color:var(--mute);font-size:12px">Renaming keeps every aircraft linked. A location with aircraft can\'t be removed until they\'re moved.</p></div>' +

      '<div id="s-lists">' + strList('types', 'Aircraft types (dropdown)') + strList('notePresets', 'Status note choices', 'Quick picks for the note shown on the TV and customer view.') +
      strList('groundPresets', 'Manual grounding reasons') + strList('squawkPresets', 'Common squawks (one-tap buttons on the CFI form)') + '</div>' +

      // rules
      '<div class="card" id="s-rules"><h2>Due rules & yellow thresholds</h2><table class="prev"><tr><th>Item</th><th>Interval</th><th>Turn yellow when</th></tr>' +
      rrow('annual', 'A · Annual', 'months', 'calendar months', 'warnDays', 'days left') +
      rrow('hundred', '1 · 100-hour', 'hours', 'hours', 'warnHours', 'hours left') + rrow('pitot', 'A · Alt / pitot-static', 'months', 'calendar months', 'warnDays', 'days left') +
      rrow('xpdr', 'T · Transponder', 'months', 'calendar months', 'warnDays', 'days left') + rrow('elt', 'E · ELT inspection', 'months', 'calendar months', 'warnDays', 'days left (also battery)') +
      rrow('oil50', '50 · 50-hr oil change (non-grounding)', 'hours', 'hours', 'warnHours', 'hours left') +
      '<tr><td>D · ADs</td><td>per AD</td><td><input type="number" data-rule="ads.warnDays" value="' + R.ads.warnDays + '" style="width:90px"> days or <input type="number" data-rule="ads.warnHours" value="' + R.ads.warnHours + '" style="width:90px"> hours left</td></tr>' +
      '<tr><td>Hours freshness</td><td colspan="2">Flag "hours old" when tach/Hobbs not updated in <input type="number" data-rule="staleHoursDays" value="' + R.staleHoursDays + '" style="width:90px"> days</td></tr></table>' +
      '<p class="sub" style="color:var(--mute);font-size:12px">Defaults follow 14 CFR 91.409 (annual, 100-hr), 91.411 (pitot-static, 24 cal. months), 91.413 (transponder, 24 cal. months), 91.207 (ELT, 12 cal. months). Overdue = red = GROUNDED, except non-grounding items like the 50-hr oil change, which stay amber. GPS / nav database updates are ignored. Missing dates show as "needs data" (yellow).</p>' +
      '<button class="btn sm" id="rdef">Reset to defaults</button></div>' +

      // tv
      '<div class="card" id="s-tv"><h2>TV display & public view</h2><div class="row">' +
      '<label class="chk"><input type="checkbox" data-tv="logo"' + (tv.logo !== false ? ' checked' : '') + '> Logo in corner</label>' +
      '<label class="chk"><input type="checkbox" data-tv="watermark"' + (tv.watermark !== false ? ' checked' : '') + '> Faint logo watermark</label>' +
      '<label class="chk"><input type="checkbox" data-tv="showSquawkText"' + (tv.showSquawkText !== false ? ' checked' : '') + '> Show squawk text on TV</label>' +
      '<label class="chk"><input type="checkbox" data-pub="showSquawkText"' + (pub.showSquawkText !== false ? ' checked' : '') + '> Show squawk text to customers</label></div><div class="row">' +
      '<label class="f">Seconds per page (if fleet doesn\'t fit)<select data-tvs="pageSeconds">' + [10, 15, 20, 30, 60].map(function (n) { return opt(n, n + ' s', tv.pageSeconds || 15); }).join('') + '</select></label>' +
      '<label class="f">TV order<select data-tvs="sort">' + opt('status', 'Problems first', tv.sort || 'status') + opt('tail', 'Tail number', tv.sort) + opt('location', 'Location', tv.sort) + opt('custom', 'Custom (Edit → TV order)', tv.sort) + '</select></label></div>' +
      '<h3>Links</h3><div class="listed"><div class="li">📺 All locations: <a href="' + base + '#tv">' + base + '#tv</a></div>' + (s.locations || []).map(function (l) { return '<div class="li">📺 ' + esc(l.code) + ' only: <a href="' + base + '#tv?loc=' + encodeURIComponent(l.code) + '">' + base + '#tv?loc=' + esc(l.code) + '</a></div>'; }).join('') +
      '<div class="li">📱 Customers / renters: <a href="' + base + '#board">' + base + '#board</a></div><div class="li">⚑ CFI squawk form: <a href="' + base + '#squawk">' + base + '#squawk</a></div></div></div>' +

      // alerts
      '<div class="card" id="s-alerts"><h2>Email alerts</h2>' +
      '<div class="banner ' + (al.enabled ? 'red' : 'blue') + '">' + (al.enabled ? 'Alerts switch is ON. Emails go out only if the free Google Apps Script sender (setup Doc, step 6) is installed.' : 'Alerts are OFF. Nothing is emailed. This page sets up who would get what; the preview below shows exactly what would go out right now.') + '</div>' +
      '<div class="row"><label class="chk"><input type="checkbox" data-al="enabled"' + (al.enabled ? ' checked' : '') + (st.mode === 'demo' ? ' disabled' : '') + '> <b>Send alert emails</b>' + (st.mode === 'demo' ? ' (needs live setup)' : '') + '</label></div><div class="row">' +
      '<label class="chk"><input type="checkbox" data-al="onGrounded"' + (al.onGrounded !== false ? ' checked' : '') + '> When a plane becomes GROUNDED</label>' +
      '<label class="chk"><input type="checkbox" data-al="onDueSoon"' + (al.onDueSoon !== false ? ' checked' : '') + '> When an item turns yellow (coming due)</label>' +
      '<label class="chk"><input type="checkbox" data-al="onReturn"' + (al.onReturn !== false ? ' checked' : '') + '> When a plane is back in service</label>' +
      '<label class="chk"><input type="checkbox" data-al="digest"' + (al.digest ? ' checked' : '') + '> Daily summary at</label><select data-als="digestHour" style="width:auto">' + Array.apply(null, Array(24)).map(function (_, h) { return opt(h, (h % 12 || 12) + (h < 12 ? ' AM' : ' PM'), al.digestHour == null ? 7 : al.digestHour); }).join('') + '</select></div>' +
      '<h3>Recipients</h3><div class="listed">' + (al.recipients || []).map(function (r, i) {
        return '<div class="li"><label class="chk"><input type="checkbox" data-rc="' + i + '.active"' + (r.active !== false ? ' checked' : '') + '></label><input type="text" data-rc="' + i + '.name" value="' + esc(r.name) + '" placeholder="Name"><input type="email" data-rc="' + i + '.email" value="' + esc(r.email) + '" placeholder="email"><select data-rc="' + i + '.group" style="max-width:140px">' + GROUPS.map(function (g) { return opt(g, g, r.group); }).join('') + '</select>' +
          '<span class="row" style="gap:4px">' + (s.locations || []).map(function (l) { return '<label class="chk" style="min-height:30px;font-size:13px"><input type="checkbox" data-rcl="' + i + '" value="' + l.id + '"' + ((r.locations || []).indexOf(l.id) >= 0 ? ' checked' : '') + '>' + esc(l.code) + '</label>'; }).join('') + '<span class="sub" style="color:var(--mute);font-size:11px">(none = all)</span></span>' +
          '<button class="iconbtn" data-rcu="' + i + '">↑</button><button class="iconbtn" data-rcd="' + i + '">↓</button><button class="iconbtn" data-rcx="' + i + '">✕</button></div>';
      }).join('') + '</div><button class="btn" id="addrc" style="margin-top:8px">+ Add recipient</button>' +
      '<h3>Preview — what would go out right now</h3>' + preview(al) + '</div>' +

      // people
      '<div class="card" id="s-people"><h2>People & roles' + pendBadge + '</h2>' +
      (pendingReqs.length ? '<div class="pendingbox"><h3>Pending requests (' + pendingReqs.length + ')</h3>' + pendingReqs.map(function (r) {
        return '<div class="pendingreq"><div><b>' + esc(r.name || '') + '</b> · ' + esc(r.email) + '</div>' +
          (r.requestedAt ? '<p class="sub" style="color:var(--mute);margin:4px 0 0">Requested ' + esc((function (s) { var d = new Date(s); return isNaN(d.getTime()) ? String(s).slice(0, 10) : d.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' }); })(r.requestedAt)) + '</p>' : '') +
          '<div class="row" style="margin-top:8px;flex-wrap:wrap;gap:8px">' +
          '<button class="btn ok sm" data-appr="cfi" data-em="' + esc(r.email) + '">Approve as CFI</button>' +
          '<button class="btn sm" data-appr="editor" data-em="' + esc(r.email) + '">Approve as editor</button>' +
          '<button class="btn bad sm" data-deny="' + esc(r.email) + '">Deny</button></div></div>';
      }).join('') + '</div>' : '<p class="sub" style="color:var(--mute)">No pending access requests.</p>') +
      (st.mode === 'demo' ? '<p class="sub" style="color:var(--mute)">In demo mode this list is just practice. Live, a CFI can request access from the sign-in screen; you approve them here without opening Firebase.</p>' : '') +
      '<div class="listed">' + (st.roles || []).map(function (r) {
        return '<div class="li"><span style="flex:2">' + esc(r.email) + '</span><input type="text" data-rn="' + esc(r.email) + '" value="' + esc(r.name || '') + '" placeholder="Name"><select data-rr="' + esc(r.email) + '" style="max-width:220px">' + opt('editor', 'Owner / Mechanic (edit all)', r.role) + opt('cfi', 'CFI (squawks only)', r.role) + opt('alerts', 'Alert sender (robot)', r.role) + '</select>' + (st.user && st.user.email === r.email ? '<span class="sub">(you)</span>' : '<button class="iconbtn" data-rx="' + esc(r.email) + '">✕</button>') + '</div>';
      }).join('') + '</div><div class="row" style="margin-top:8px"><input type="email" id="npe" placeholder="email" style="flex:2"><input type="text" id="npn" placeholder="Name" style="flex:1"><select id="npr" style="max-width:220px">' + opt('cfi', 'CFI (squawks only)', 'cfi') + opt('editor', 'Owner / Mechanic (edit all)', '') + opt('alerts', 'Alert sender (robot)', '') + '</select><button class="btn" id="addpe">Add</button></div>' +
      '<p class="sub" style="color:var(--mute);font-size:12px">CFIs request a login from the sign-in screen. Approve them here — you do not need to add them in the Firebase console. You can still add someone by hand if their login already exists. Customers never need a login.</p></div>' +

      // flight log sheet
      '<div class="card" id="s-flog"><h2>Flight log Google Sheet (billing)</h2>' +
      '<p class="sub" style="color:var(--mute)">CFI post-flight reports are saved on the board and, if you connect a Sheet, also appended for the secretary. Flight Schedule Pro stays the official hours record; CFI times never change Tach or Hobbs on the board.</p>' +
      '<div class="row"><label class="f">Flight log Sheet web app URL<input type="url" id="flogurl" placeholder="https://script.google.com/macros/s/…/exec" value="' + esc(s.flightLogSheetUrl || '') + '"></label></div>' +
      '<div class="row"><label class="f">Shared token<input type="text" id="flogtok" placeholder="Same value as SHARED_TOKEN in Apps Script" value="' + esc(s.flightLogSheetToken || '') + '" autocomplete="off"></label></div>' +
      '<div class="row" style="margin-top:8px"><button class="btn pri" id="flogsave">Save Sheet connection</button><button class="btn" id="flogresend">Resend unsent to Sheet (' + (st.flightReports || []).filter(function (r) { return !r.sheetSent; }).length + ')</button></div>' +
      '<p class="sub" style="color:var(--mute);font-size:12px">The URL and token are stored in public settings so the CFI page can send rows after submit. Anyone who can load the board can read them — treat the token as light protection only. The script still checks the token, validates fields, and ignores duplicate Report ID values. Meter photos (from Snap meter) go to a Drive folder named “PPA Flight Log Photos”; they are not stored in Firestore. Setup steps: create the Sheet in your personal Drive, Extensions → Apps Script, paste <code>apps-script/flight-log.gs</code>, set SHARED_TOKEN, deploy as a web app (Execute as me / Who has access: Anyone), then paste the URL and token here.</p></div>' +

      // data
      '<div class="card" id="s-data"><h2>CSV import / export & backup</h2><div class="row">' +
      '<label class="btn pri">⬆ Import FSP Maintenance Status Report<input type="file" id="fspin" accept=".pdf,application/pdf,.csv,text/csv" class="hide"></label>' +
      '<div class="row" style="margin-top:8px;gap:8px;align-items:center"><label class="sub" for="igt">Skip on FSP import (tails, comma-separated):</label><input id="igt" style="flex:1;min-width:160px" value="' + esc(ignored().join(', ')) + '"><button class="btn" id="igts">Save</button></div>' +
      '<button class="btn" id="csvout">⬇ Export fleet CSV</button><button class="btn" id="flogout">⬇ Export flight log CSV</button><a class="btn" href="template.csv" download>⬇ Blank CSV template</a>' +
      '<label class="btn">⬆ Import CSV<input type="file" id="csvin" accept=".csv,text/csv" class="hide"></label>' +
      '<button class="btn" id="jsonout">⬇ Full backup (JSON)</button>' + (st.mode === 'demo' ? '<label class="btn">⬆ Restore backup<input type="file" id="jsonin" accept=".json" class="hide"></label><button class="btn" id="reset">Reload SAMPLE data</button><button class="btn bad" id="clear">Start empty (remove samples)</button>' : '') + '</div>' +
      '<p class="sub" style="color:var(--mute);font-size:12px">Fastest refresh: in Flight Schedule Pro open Reports → Maintenance Status Report, print/save as PDF, then upload it here. You will get a preview (new / changed / unchanged) before anything is saved. Existing planes are never deleted. Closed squawks are skipped; only open squawks are added, and duplicates are not created. ADs, 50-hour oil, GPS database, and similar extras come in as tracked reminders. Tach and Hobbs stay separate; the 100-hour meter is set from the report (tach when the 100-hour time is tach-based) and are the official hours on this board. CSV import still works: matches by tail number (or FSP aircraft ID); blank cells never erase data. Export flight log CSV (or use the billing Sheet) to pull CFI-reported Tach/Hobbs, oil, instructor and student names — FSP stays the official hours record, and CFI times never update the board.</p>' +
      '<div id="imp">' + importPreview() + '</div></div>' +

      // live
      '<div class="card" id="s-live"><h2>Go live (shared data on every screen)</h2>' + (st.mode === 'live' ? '<div class="banner blue">LIVE — connected to Firebase project <b>' + esc(window.PPA_CONFIG.firebaseConfig.projectId) + '</b>. ' + (st.fromCache ? 'Currently offline / cached.' : 'Online.') + '</div>' :
        '<p>Right now this is DEMO mode. To share one board across the TV, editors\' phones and customers\' phones, do the one-time free Firebase setup in the setup Doc (about 15 minutes), then paste the config into <code>js/config.js</code> (or send it to your assistant to commit).</p>') +
      (window.PPA_CONFIG.setupDocUrl ? '<a class="btn" href="' + esc(window.PPA_CONFIG.setupDocUrl) + '" target="_blank">Open setup steps</a>' : '') + '</div>' +
      '<p class="disclaimer">' + U.DISCLAIMER + '</p></div>';
    document.getElementById('app').innerHTML = html;
    bind();
  }
  function rrow(k, label, iKey, iUnit, wKey, wUnit) {
    var R = S.rules(st.settings);
    return '<tr><td>' + label + '</td><td><input type="number" data-rule="' + k + '.' + iKey + '" value="' + R[k][iKey] + '" style="width:90px"> ' + iUnit + '</td><td><input type="number" data-rule="' + k + '.' + wKey + '" value="' + R[k][wKey] + '" style="width:90px"> ' + wUnit + '</td></tr>';
  }
  function recipientsFor(al, a) { return (al.recipients || []).filter(function (r) { return r.active !== false && r.email && (!(r.locations || []).length || r.locations.indexOf(a.location) >= 0); }); }
  function preview(al) {
    var now = U.evalAll();
    var ev = S.alertEvents(st.aircraft, null, now, al);
    if (!ev.length) return '<p>No alerts would go out right now.</p>';
    return '<table class="prev"><tr><th>Subject</th><th>Why</th><th>To</th></tr>' + ev.map(function (x) { var to = recipientsFor(al, x.aircraft); return '<tr><td><b>' + esc('[PPA] ' + x.subject) + '</b></td><td>' + esc(x.text) + '</td><td>' + (to.length ? esc(to.map(function (r) { return r.name || r.email; }).join(', ')) : '<i>nobody (check recipients/locations)</i>') + '</td></tr>'; }).join('') +
      '</table><p class="sub" style="color:var(--mute);font-size:12px">Live, the sender only emails on a CHANGE (e.g. a plane newly grounded), not every check, so people aren\'t spammed. This preview lists everything currently in that state. ' + (al.enabled ? '' : '<b>Sending is OFF.</b>') + '</p>';
  }

  // ---------- CSV ----------
  function parseCSV(text) {
    var rows = [], row = [], f = '', q = false;
    text = text.replace(/^\uFEFF/, '');
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; } else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); });
  }
  function csvCell(v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function normDate(v) {
    v = String(v || '').trim(); if (!v) return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    var m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (m) { var y = +m[3]; if (y < 100) y += 2000; return y + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2); }
    return null;
  }
  function yes(v) { v = String(v).trim().toLowerCase(); return v === '' ? null : ['y', 'yes', 'true', '1', 'x'].indexOf(v) >= 0; }
  function exportCSV() {
    var ev = U.evalAll();
    var head = CSV_COLS.concat(['status', 'reasons']);
    var lines = [head.join(',')].concat(st.aircraft.map(function (a) {
      var d = a.dates || {};
      return [a.tail, a.type, U.locCode(a.location), a.meter, S.meterReading(a, 'tach'), S.meterUpdated(a, 'tach'), S.meterReading(a, 'hobbs'), S.meterUpdated(a, 'hobbs'), S.meterReading(a), S.meterUpdated(a), a.ifr === false ? 'no' : 'yes', a.forHire === false ? 'no' : 'yes', d.annual, a.last100, d.pitot, d.xpdr, d.elt, d.eltBattery, a.statusNote, a.expectedBack, a.fspAircraftId, U.LABEL[ev[a.id].overall], ev[a.id].reasons.join('; ')].map(csvCell).join(',');
    }));
    download('ppa-fleet-' + S.todayStr() + '.csv', lines.join('\n'), 'text/csv');
  }
  function locFor(r) {
    var a = st.aircraft.filter(function (x) { return x.id === r.aircraftId; })[0];
    return a ? U.locCode(a.location) : '';
  }
  function resendUnsent() {
    var url = ((st.settings && st.settings.flightLogSheetUrl) || '').trim();
    if (!url) return toast('Add the Sheet web app URL first', true);
    var unsent = (st.flightReports || []).filter(function (r) { return !r.sheetSent; });
    if (!unsent.length) return toast('Nothing to resend');
    var btn = $('#flogresend'); if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    var acc = { ok: 0, fail: 0 };
    var chain = Promise.resolve();
    unsent.forEach(function (r) {
      chain = chain.then(function () {
        return Store.sendFlightLogToSheet(r, { location: locFor(r) }).then(function (res) {
          if (res && res.sent) {
            return Store.markReportSheetSent(r.id).then(function () { acc.ok++; });
          }
          acc.fail++;
        });
      });
    });
    chain.then(function () {
      toast('Sent ' + acc.ok + ' to the Sheet' + (acc.fail ? ', ' + acc.fail + ' failed' : '') + '. Duplicates are ignored by Report ID. Photos from the original submit are not stored, so a resend may have blank photo columns.');
      U.render(true);
    }).catch(function (e) { toast((e && e.message) || String(e), true); U.render(true); });
  }
  function exportFlightLog() {
    var head = ['date', 'tail', 'cfi', 'student', 'tach_start', 'tach_end', 'hobbs_start', 'hobbs_end', 'oil_added', 'oil_qts'];
    var rows = (st.flightReports || []).slice().sort(function (a, b) { return String(a.createdAt || '').localeCompare(String(b.createdAt || '')); });
    var lines = [head.join(',')].concat(rows.map(function (r) {
      return [
        (function () { if (!r.createdAt) return ''; var d = new Date(r.createdAt); return isNaN(d.getTime()) ? String(r.createdAt).slice(0, 10) : S.todayStr(d); })(),
        r.tail || '',
        r.reportedBy || r.reporterEmail || '',
        r.student || '',
        r.tachStart, r.tachEnd, r.hobbsStart, r.hobbsEnd,
        r.oilAdded ? 'yes' : 'no',
        r.oilAdded ? r.oilQts : ''
      ].map(csvCell).join(',');
    }));
    download('ppa-flight-log-' + S.todayStr() + '.csv', lines.join('\n'), 'text/csv');
  }
  function download(name, text, type) { var b = new Blob([text], { type: type }); var u = URL.createObjectURL(b); var a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 500); }
  function buildImport(text) {
    var rows = parseCSV(text); if (rows.length < 2) return { error: 'No data rows found.' };
    var hdr = rows[0].map(function (h) { h = h.trim().toLowerCase(); return ALIASES[h] || h.replace(/\s+/g, '_'); });
    if (hdr.indexOf('tail') < 0 && hdr.indexOf('fsp_aircraft_id') < 0) return { error: 'Need a "tail" column (or "Tail Number").' };
    var ops = [], warn = [], newLocs = [], newTypes = [];
    var locs = clone(st.settings.locations || []), types = (st.settings.types || []).slice();
    rows.slice(1).forEach(function (r, n) {
      var o = {}; hdr.forEach(function (h, i) { o[h] = (r[i] || '').trim(); });
      var tail = (o.tail || '').toUpperCase().replace(/\s/g, '');
      var ex = st.aircraft.filter(function (a) { return (tail && a.tail.toUpperCase().replace(/-/g, '') === tail.replace(/-/g, '')) || (o.fsp_aircraft_id && a.fspAircraftId === o.fsp_aircraft_id); })[0];
      if (!ex && !tail) { warn.push('Row ' + (n + 2) + ': no tail number, skipped'); return; }
      var a = ex ? clone(ex) : { id: PPASample.uid(), tail: tail, type: '', location: (locs[0] || {}).id || '', meter: 'tach', hours: null, last100: null, hoursUpdated: '', tach: null, hobbs: null, tachUpdated: '', hobbsUpdated: '', ifr: true, forHire: true, dates: {}, na: {}, ads: [], statusNote: '', expectedBack: '', grounded: false, groundedReason: '', fspAircraftId: '', order: st.aircraft.length + n, log: [] };
      var ch = [];
      function setv(k, v, label) { if (v === null || v === undefined || v === '') return; if (JSON.stringify(getp(a, k)) !== JSON.stringify(v)) { setp(a, k, v); ch.push(label); } }
      if (o.type) { if (types.indexOf(o.type) < 0) { types.push(o.type); newTypes.push(o.type); } setv('type', o.type, 'type'); }
      if (o.location) { var L = locs.filter(function (l) { return l.code.toLowerCase() === o.location.toLowerCase() || l.name.toLowerCase() === o.location.toLowerCase(); })[0]; if (!L) { L = { id: o.location.toLowerCase().replace(/[^a-z0-9]/g, '') || PPASample.uid(), code: o.location.toUpperCase(), name: o.location }; locs.push(L); newLocs.push(L.code); } setv('location', L.id, 'location'); }
      if (o.meter) setv('meter', /hobbs/i.test(o.meter) ? 'hobbs' : 'tach', 'meter');
      function applyHours(col, field, dateCol, label) {
        if (!o[col]) return;
        var hv = Number(String(o[col]).replace(/,/g, ''));
        if (isNaN(hv)) { warn.push(tail + ': ' + label + ' "' + o[col] + '" not a number'); return; }
        var prev = field === 'hours' ? S.meterReading(a) : S.meterReading(a, field);
        if (ex && prev != null && hv < prev) warn.push(tail + ': ' + label + ' goes DOWN ' + prev + ' → ' + hv + ' (check)');
        if (field === 'hours') {
          var m = S.meterOf(a);
          setv(m, hv, label);
          if (ch.indexOf(label) >= 0) a[m + 'Updated'] = normDate(o[dateCol]) || S.todayStr();
        } else {
          setv(field, hv, label);
          if (ch.indexOf(label) >= 0) a[field + 'Updated'] = normDate(o[dateCol]) || S.todayStr();
        }
      }
      applyHours('current_tach', 'tach', 'tach_date', 'tach');
      applyHours('current_hobbs', 'hobbs', 'hobbs_date', 'hobbs');
      // legacy current_hours updates the selected 100-hr meter only if that meter was not in this row
      var selCol = 'current_' + S.meterOf(a);
      if (o.current_hours && !o[selCol]) applyHours('current_hours', 'hours', 'hours_date', 'hours');
      S.syncMeters(a);
      if (o.last_100hr_at) { var lv = Number(o.last_100hr_at.replace(/,/g, '')); if (!isNaN(lv)) setv('last100', lv, 'last 100-hr'); }
      [['ifr', 'ifr'], ['for_hire', 'forHire']].forEach(function (p) { if (o[p[0]] !== undefined) { var y = yes(o[p[0]]); if (y !== null) setv(p[1], y, p[0]); } });
      [['annual_done', 'annual'], ['pitot_static_done', 'pitot'], ['transponder_done', 'xpdr'], ['elt_done', 'elt'], ['elt_battery_expires', 'eltBattery']].forEach(function (p) {
        if (o[p[0]]) { var d = normDate(o[p[0]]); if (d === null) warn.push(tail + ': bad date "' + o[p[0]] + '" in ' + p[0]); else setv('dates.' + p[1], d, p[0]); }
      });
      if (o.status_note) setv('statusNote', o.status_note, 'note');
      if (o.expected_back) { var eb = normDate(o.expected_back); if (eb) setv('expectedBack', eb, 'expected back'); }
      if (o.fsp_aircraft_id) setv('fspAircraftId', o.fsp_aircraft_id, 'FSP id');
      if (!ex || ch.length) ops.push({ a: a, isNew: !ex, changes: ch });
    });
    return { ops: ops, warn: warn, newLocs: newLocs, newTypes: newTypes, locs: locs, types: types };
  }
  function getp(o, p) { return p.split('.').reduce(function (x, k) { return x == null ? undefined : x[k]; }, o); }
  function setp(o, p, v) { var k = p.split('.'), x = o; for (var i = 0; i < k.length - 1; i++) { x[k[i]] = x[k[i]] || {}; x = x[k[i]]; } x[k[k.length - 1]] = v; }
  function importPreview() {
    var p = pendingImport; if (!p) return '';
    if (p.error) return '<div class="banner red">' + esc(p.error) + '</div>';
    var nNew = p.ops.filter(function (o) { return o.isNew; }).length;
    var nUpd = p.ops.filter(function (o) { return !o.isNew && o.changes && o.changes.length; }).length;
    var nSame = p.ops.filter(function (o) { return !o.isNew && (!o.changes || !o.changes.length); }).length;
    var nSq = (p.squawkOps || []).length;
    var fsp = p.source === 'fsp';
    return '<div class="banner blue">Ready to import' + (p.reportCreated ? ' (report ' + esc(p.reportCreated) + ')' : '') + ': <b>' + nNew + ' new</b>, <b>' + nUpd + ' updated</b>, <b>' + nSame + ' unchanged</b>' + (nSq ? ', <b>' + nSq + ' open squawk' + (nSq === 1 ? '' : 's') + '</b>' : '') + (p.newLocs.length ? ' · new locations: ' + esc(p.newLocs.join(', ')) : '') + (p.newTypes.length ? ' · new types: ' + esc(p.newTypes.join(', ')) : '') + '</div>' +
      (p.warn.length ? '<div class="banner">' + p.warn.map(esc).join('<br>') + '</div>' : '') +
      '<table class="prev"><tr><th>Tail</th><th></th><th>Changes</th>' + (fsp ? '<th>Open squawks</th>' : '') + '</tr>' + p.ops.map(function (o) {
        var kind = o.isNew ? 'NEW' : (o.changes && o.changes.length ? 'update' : 'unchanged');
        var sq = (o.squawks || []).map(function (x) { return x.description; }).join('; ');
        return '<tr><td>' + esc(o.a.tail) + '</td><td>' + kind + '</td><td>' + esc((o.changes || []).join(', ') || (o.isNew ? 'all fields' : '—')) + '</td>' + (fsp ? '<td>' + esc(sq || '—') + '</td>' : '') + '</tr>';
      }).join('') + '</table>' +
      '<div class="row" style="margin-top:8px"><button class="btn pri" id="impgo">Apply import</button><button class="btn ghost" id="impno">Cancel</button></div>';
  }
  function applyImport() {
    var p = pendingImport; if (!p || !p.ops) return;
    var s = clone(st.settings); s.locations = p.locs; s.types = p.types;
    if (p.source === 'fsp') s.lastFspImportAt = new Date().toISOString();
    var who = st.name || (st.user && st.user.email) || 'import';
    var label = p.source === 'fsp' ? 'FSP import' : 'CSV import';
    var toSave = p.ops.filter(function (o) { return o.isNew || (o.changes && o.changes.length); });
    Store.saveSettings(s).then(function () {
      return Promise.all(toSave.map(function (o) { o.a.log = o.a.log || []; o.a.log.unshift({ at: new Date().toISOString(), by: who, what: label + ': ' + (o.isNew ? 'created' : o.changes.join(', ')) }); return Store.saveAircraft(o.a); }));
    }).then(function () {
      var sqs = p.squawkOps || [];
      var chain = Promise.resolve();
      sqs.forEach(function (q) {
        chain = chain.then(function () { return Store.addSquawk(q); });
      });
      return chain.then(function () { return sqs.length; });
    }).then(function (nSq) {
      toast('Imported ' + toSave.length + ' aircraft' + (nSq ? ' and ' + nSq + ' open squawk' + (nSq === 1 ? '' : 's') : ''));
      pendingImport = null; U.render(true);
    }).catch(function (e) { toast(e.message, true); });
  }

  function eqv(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function squawkDup(tail, text, date, list) {
    var n = squashSq(text);
    return (list || []).some(function (s) {
      return (s.tail || '').toUpperCase().replace(/-/g, '') === tail && squashSq(s.text) === n && (!date || !s.createdAt || String(s.createdAt).slice(0, 10) === date);
    });
  }
  function squashSq(t) { return String(t || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

  function ignored() { var l = st.settings.ignoreTails; if (!Array.isArray(l)) l = ['NB58RB']; return l.map(function (t) { return String(t).toUpperCase().replace(/[\s-]/g, ''); }).filter(Boolean); }
  function buildFspImport(parsed) {
    if (!parsed || !parsed.aircraft || !parsed.aircraft.length) return { error: 'No aircraft found in that report. Use Flight Schedule Pro’s Maintenance Status Report PDF.' };
    var Imp = window.PPAFspImport;
    var ops = [], warn = (parsed.warnings || []).slice(), newLocs = [], newTypes = [], squawkOps = [];
    var locs = clone(st.settings.locations || []), types = (st.settings.types || []).slice();
    parsed.aircraft.forEach(function (raw, n) {
      var f = Imp.toBoardFields(raw);
      (f.doubts || []).forEach(function (d) { warn.push(d); });
      if ((f.skippedReminders || []).length) warn.push((f.tail || '') + ': ignored ' + f.skippedReminders.map(function (n) { return '"' + n + '"'; }).join(', ') + ' (VOR / GPS-nav database items are not tracked)');
      var tail = (f.tail || '').toUpperCase().replace(/\s/g, '');
      if (ignored().indexOf(tail.replace(/-/g, '')) >= 0) { warn.push(tail + ' skipped (on the ignore list in Settings).'); return; }
      if (/redbird|aatd|batd|\bsimulator\b|\bflight sim\b|\bftd\b|training device/i.test(String((f.type || '') + ' ' + (raw.model || raw.make || raw.description || '') + ' ' + tail))) { warn.push(tail + ' skipped (simulator, not an aircraft).'); return; }
      var ex = st.aircraft.filter(function (a) { return tail && a.tail.toUpperCase().replace(/-/g, '') === tail.replace(/-/g, ''); })[0];
      var a = ex ? clone(ex) : { id: PPASample.uid(), tail: tail, type: '', location: (locs[0] || {}).id || '', meter: 'tach', hours: null, last100: null, hoursUpdated: '', tach: null, hobbs: null, tachUpdated: '', hobbsUpdated: '', ifr: true, forHire: true, dates: {}, na: {}, ads: [], statusNote: '', expectedBack: '', grounded: false, groundedReason: '', fspAircraftId: '', order: st.aircraft.length + n, log: [] };
      var ch = [];
      function setv(k, v, label) { if (v === null || v === undefined || v === '') return; if (!eqv(getp(a, k), v)) { setp(a, k, v); ch.push(label); } }
      if (f.type) { if (types.indexOf(f.type) < 0) { types.push(f.type); newTypes.push(f.type); } setv('type', f.type, 'type'); }
      if (f.location) { var L = locs.filter(function (l) { return l.code.toLowerCase() === f.location.toLowerCase() || l.name.toLowerCase() === f.location.toLowerCase(); })[0]; if (!L) { L = { id: f.location.toLowerCase().replace(/[^a-z0-9]/g, '') || PPASample.uid(), code: f.location.toUpperCase(), name: f.location }; locs.push(L); newLocs.push(L.code); } setv('location', L.id, 'location'); }
      if (f.meter) setv('meter', f.meter, 'meter');
      function applyHours(val, field, dateVal, label) {
        if (val == null) return;
        var prev = S.meterReading(a, field);
        if (ex && prev != null && val < prev) warn.push(tail + ': ' + label + ' goes DOWN ' + prev + ' → ' + val + ' (check)');
        setv(field, val, label);
        if (ch.indexOf(label) >= 0) a[field + 'Updated'] = dateVal || parsed.reportCreated || S.todayStr();
      }
      applyHours(f.current_tach, 'tach', f.tach_date, 'tach');
      applyHours(f.current_hobbs, 'hobbs', f.hobbs_date, 'hobbs');
      S.syncMeters(a);
      if (f.last_100hr_at != null) setv('last100', f.last_100hr_at, 'last 100-hr');
      [['annual_done', 'annual'], ['pitot_static_done', 'pitot'], ['transponder_done', 'xpdr'], ['elt_done', 'elt'], ['elt_battery_expires', 'eltBattery']].forEach(function (pair) {
        if (f[pair[0]]) setv('dates.' + pair[1], f[pair[0]], pair[0]);
      });
      if (f.status_note && !a.statusNote) setv('statusNote', f.status_note, 'note');
      // merge reminders / ADs
      var ads = (a.ads || []).slice();
      (f.ads || []).forEach(function (nAd) {
        if (S.isGpsUpdate(nAd)) return; // GPS / nav database updates are not tracked
        var hit = ads.filter(function (x) {
          if (S.isOilChange(nAd) && S.isOilChange(x)) return true; // one 50-hr oil change per plane
          if (nAd.number && x.number === nAd.number) {
            var sameNum = ads.filter(function (y) { return y.number === nAd.number; });
            if (sameNum.length <= 1) return true;
            return String(x.desc || '').toLowerCase() === String(nAd.desc || '').toLowerCase();
          }
          var ng = function (t) { return String(t || '').toLowerCase().replace(/\s*\(?\s*non\s*-?\s*grounding\s*\)?/g, '').trim(); };
          return !nAd.number && ng(x.desc) === ng(nAd.desc);
        })[0];
        if (!hit) {
          var add = { id: PPASample.uid(), number: nAd.number || '', desc: nAd.desc || '', intervalMonths: nAd.intervalMonths, intervalDays: nAd.intervalDays, intervalHours: nAd.intervalHours, lastDoneDate: nAd.lastDoneDate || '', lastDoneHours: nAd.lastDoneHours, nextDueDate: nAd.nextDueDate || '', nextDueHours: nAd.nextDueHours, nonGrounding: !!nAd.nonGrounding };
          ads.push(add); ch.push('AD ' + (nAd.number || nAd.desc));
        } else {
          var changed = false;
          ['intervalHours', 'intervalDays', 'intervalMonths', 'lastDoneHours', 'nextDueHours'].forEach(function (k) {
            if (nAd[k] != null && nAd[k] !== '' && hit[k] !== nAd[k]) { hit[k] = nAd[k]; changed = true; }
          });
          ['lastDoneDate', 'nextDueDate', 'desc', 'number'].forEach(function (k) {
            if (nAd[k] && hit[k] !== nAd[k]) { hit[k] = nAd[k]; changed = true; }
          });
          if (nAd.nonGrounding && !hit.nonGrounding) { hit.nonGrounding = true; changed = true; }
          if (changed) ch.push('AD ' + (nAd.number || nAd.desc));
        }
      });
      if (JSON.stringify(ads) !== JSON.stringify(a.ads || [])) a.ads = ads;
      var openSq = (f.openSquawks || []).filter(function (sq) {
        var all = (st.squawks || []).concat(st.closedSquawks || []);
        if (squawkDup(tail, sq.description, sq.date, all)) { warn.push(tail + ': skipped duplicate squawk "' + sq.description + '"'); return false; }
        return true;
      });
      openSq.forEach(function (sq) {
        squawkOps.push({ aircraftId: a.id, tail: a.tail, text: sq.description, severity: sq.groundable ? 'grounding' : 'open', grounding: !!sq.groundable, status: 'open', reportedBy: sq.reportedBy || 'FSP import', createdAt: (sq.date || parsed.reportCreated || S.todayStr()) + 'T12:00:00' });
        ch.push('open squawk');
      });
      ops.push({ a: a, isNew: !ex, changes: ch, squawks: openSq });
    });
    return { source: 'fsp', ops: ops, warn: warn, newLocs: newLocs, newTypes: newTypes, locs: locs, types: types, squawkOps: squawkOps, reportCreated: parsed.reportCreated || '' };
  }

  function ingestFspFile(file) {
    var name = (file.name || '').toLowerCase();
    if (name.endsWith('.csv') || file.type === 'text/csv') {
      return file.text().then(function (t) { pendingImport = buildImport(t); pendingImport.source = pendingImport.source || 'csv'; });
    }
    if (!window.PPAFspImport) return Promise.reject(new Error('FSP importer failed to load. Refresh the page and try again.'));
    toast('Reading PDF…');
    return file.arrayBuffer().then(function (buf) {
      return PPAFspImport.loadPdfjs().then(function (lib) { return PPAFspImport.parsePdfBuffer(buf, lib); });
    }).then(function (parsed) { pendingImport = buildFspImport(parsed); });
  }

  function bind() {
    $$('[data-jump]').forEach(function (b) { b.onclick = function () { document.getElementById(b.dataset.jump).scrollIntoView({ behavior: 'smooth' }); }; });
    // string lists
    $$('[data-sl]').forEach(function (el) { el.onchange = function () { var k = el.dataset.sl, i = +el.dataset.i, v = el.value.trim(); saveS(function (s) { var old = s[k][i]; if (v) s[k][i] = v; else s[k].splice(i, 1); if (k === 'types' && old && v && old !== v) st.aircraft.forEach(function (a) { if (a.type === old) { var c = clone(a); c.type = v; Store.saveAircraft(c); } }); }, 'Saved'); }; });
    $$('[data-slu],[data-sld]').forEach(function (b) { b.onclick = function () { var k = b.dataset.slu || b.dataset.sld; saveS(function (s) { swap(s[k], +b.dataset.i, b.dataset.slu ? -1 : 1); }); }; });
    $$('[data-slx]').forEach(function (b) { b.onclick = function () { var k = b.dataset.slx; saveS(function (s) { s[k].splice(+b.dataset.i, 1); }, 'Removed'); }; });
    $$('[data-sladdb]').forEach(function (b) { b.onclick = function () { var k = b.dataset.sladdb, inp = $('[data-sladd="' + k + '"]'), v = inp.value.trim(); if (!v) return; saveS(function (s) { s[k] = (s[k] || []).concat([v]); }, 'Added'); }; });
    $$('[data-sladd]').forEach(function (i) { i.onkeydown = function (k) { if (k.key === 'Enter') $('[data-sladdb="' + i.dataset.sladd + '"]').click(); }; });
    // locations
    $$('[data-loc]').forEach(function (el) { el.onchange = function () { var p = el.dataset.loc.split('.'); var v = el.value.trim(); if (!v) { U.render(true); return; } saveS(function (s) { s.locations[+p[0]][p[1]] = p[1] === 'code' ? v.toUpperCase() : v; }, 'Location renamed'); }; });
    $$('[data-locu],[data-locd]').forEach(function (b) { b.onclick = function () { saveS(function (s) { swap(s.locations, +(b.dataset.locu || b.dataset.locd), b.dataset.locu ? -1 : 1); }); }; });
    $$('[data-locx]').forEach(function (b) { b.onclick = function () { var l = st.settings.locations[+b.dataset.locx]; var n = st.aircraft.filter(function (a) { return a.location === l.id; }).length; if (n) return toast(n + ' aircraft are at ' + l.code + '. Move them first.', true); if (confirm('Remove ' + l.code + '?')) saveS(function (s) { s.locations.splice(+b.dataset.locx, 1); }, 'Removed'); }; });
    $('#addloc').onclick = function () { var c = $('#nlc').value.trim().toUpperCase(), n = $('#nln').value.trim(); if (!c) return toast('Code required', true); if ((st.settings.locations || []).some(function (l) { return l.code === c; })) return toast(c + ' already exists', true); saveS(function (s) { s.locations = (s.locations || []).concat([{ id: c.toLowerCase().replace(/[^a-z0-9]/g, '') + '-' + PPASample.uid().slice(0, 4), code: c, name: n || c }]); }, 'Location added'); };
    // rules
    $$('[data-rule]').forEach(function (el) { el.onchange = function () { var p = el.dataset.rule.split('.'), v = el.value === '' ? null : Number(el.value); if (v != null && (isNaN(v) || v < 0)) return toast('Enter a positive number', true); saveS(function (s) { s.rules = s.rules || {}; if (p.length === 1) s.rules[p[0]] = v; else { s.rules[p[0]] = s.rules[p[0]] || {}; s.rules[p[0]][p[1]] = v; } }, 'Rule saved — board recalculated'); }; });
    $('#rdef').onclick = function () { if (confirm('Reset all due rules to FAR defaults?')) saveS(function (s) { s.rules = {}; }, 'Defaults restored'); };
    // tv
    $$('[data-tv]').forEach(function (el) { el.onchange = function () { saveS(function (s) { s.tv = s.tv || {}; s.tv[el.dataset.tv] = el.checked; }, 'Saved'); }; });
    $$('[data-pub]').forEach(function (el) { el.onchange = function () { saveS(function (s) { s.public = s.public || {}; s.public[el.dataset.pub] = el.checked; }, 'Saved'); }; });
    $$('[data-tvs]').forEach(function (el) { el.onchange = function () { saveS(function (s) { s.tv = s.tv || {}; s.tv[el.dataset.tvs] = isNaN(+el.value) ? el.value : +el.value; }, 'Saved'); }; });
    // alerts
    $$('[data-al]').forEach(function (el) { el.onchange = function () { if (el.dataset.al === 'enabled' && el.checked && !confirm('Turn ON alert emails? They only send if the Apps Script sender is installed (setup Doc step 6). Recipients will start getting emails.')) { el.checked = false; return; } saveA(function (a) { a[el.dataset.al] = el.checked; }, 'Saved'); }; });
    $$('[data-als]').forEach(function (el) { el.onchange = function () { saveA(function (a) { a[el.dataset.als] = +el.value; }, 'Saved'); }; });
    $$('[data-rc]').forEach(function (el) { el.onchange = function () { var p = el.dataset.rc.split('.'); var v = el.type === 'checkbox' ? el.checked : el.value.trim(); if (p[1] === 'email' && v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return toast('That email doesn\'t look right', true); saveA(function (a) { a.recipients[+p[0]][p[1]] = v; }, 'Saved'); }; });
    $$('[data-rcl]').forEach(function (el) { el.onchange = function () { var i = +el.dataset.rcl; saveA(function (a) { var r = a.recipients[i]; r.locations = r.locations || []; if (el.checked) { if (r.locations.indexOf(el.value) < 0) r.locations.push(el.value); } else r.locations = r.locations.filter(function (x) { return x !== el.value; }); }, 'Saved'); }; });
    $$('[data-rcu],[data-rcd]').forEach(function (b) { b.onclick = function () { saveA(function (a) { swap(a.recipients, +(b.dataset.rcu || b.dataset.rcd), b.dataset.rcu ? -1 : 1); }); }; });
    $$('[data-rcx]').forEach(function (b) { b.onclick = function () { saveA(function (a) { a.recipients.splice(+b.dataset.rcx, 1); }, 'Removed'); }; });
    $('#addrc').onclick = function () { saveA(function (a) { a.recipients = a.recipients || []; a.recipients.push({ id: PPASample.uid(), name: '', email: '', group: 'CFI', locations: [], active: true }); }); };
    // people
    $$('[data-rr]').forEach(function (el) { el.onchange = function () { var r = st.roles.filter(function (x) { return x.email === el.dataset.rr; })[0]; Store.saveRole({ email: r.email, name: r.name, role: el.value }).then(function () { toast('Role saved'); U.render(true); }); }; });
    $$('[data-rn]').forEach(function (el) { el.onchange = function () { var r = st.roles.filter(function (x) { return x.email === el.dataset.rn; })[0]; Store.saveRole({ email: r.email, role: r.role, name: el.value.trim() }).then(function () { toast('Saved'); }); }; });
    $$('[data-rx]').forEach(function (b) { b.onclick = function () { if (confirm('Remove access for ' + b.dataset.rx + '?')) Store.deleteRole(b.dataset.rx).then(function () { U.render(true); }); }; });
    $('#addpe').onclick = function () { var e = $('#npe').value.trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return toast('Enter a valid email', true); Store.saveRole({ email: e, name: $('#npn').value.trim(), role: $('#npr').value }).then(function () { toast('Added'); U.render(true); }).catch(function (x) { toast(x.message, true); }); };
    $$('[data-appr]').forEach(function (b) { b.onclick = function () { Store.approveAccess(b.dataset.em, b.dataset.appr).then(function () { toast(b.dataset.appr === 'editor' ? 'Approved as editor' : 'Approved as CFI'); U.render(true); }).catch(function (x) { toast(x.message, true); }); }; });
    $$('[data-deny]').forEach(function (b) { b.onclick = function () { if (!confirm('Deny access for ' + b.dataset.deny + '?')) return; Store.denyAccess(b.dataset.deny).then(function () { toast('Denied'); U.render(true); }).catch(function (x) { toast(x.message, true); }); }; });
    // data
    $('#csvout').onclick = exportCSV;
    if ($('#flogout')) $('#flogout').onclick = exportFlightLog;
    if ($('#flogsave')) $('#flogsave').onclick = function () {
      var url = ($('#flogurl').value || '').trim(), token = ($('#flogtok').value || '').trim();
      if (url && !/^https:\/\/script\.google\.com\//i.test(url)) return toast('The URL should be a Google Apps Script web app (script.google.com)', true);
      saveS(function (s) { s.flightLogSheetUrl = url; s.flightLogSheetToken = token; }, 'Sheet connection saved');
    };
    if ($('#flogresend')) $('#flogresend').onclick = resendUnsent;
    $('#csvin').onchange = function () { var f = this.files[0]; if (!f) return; f.text().then(function (t) { pendingImport = buildImport(t); U.render(true); setTimeout(function () { var el = $('#imp'); if (el) el.scrollIntoView(); }, 50); }); };
    if ($('#igts')) $('#igts').onclick = function () { var l = $('#igt').value.split(/[,\s]+/).map(function (t) { return t.trim().toUpperCase(); }).filter(Boolean); saveS(function (s) { s.ignoreTails = l; }, 'Ignore list saved'); };
    if ($('#fspin')) $('#fspin').onchange = function () {
      var f = this.files[0], inp = this; if (!f) return;
      ingestFspFile(f).then(function () { U.render(true); setTimeout(function () { var el = $('#imp'); if (el) el.scrollIntoView(); }, 50); }).catch(function (e) { toast((e && e.message) || String(e), true); }).then(function () { inp.value = ''; });
    };
    if ($('#impgo')) $('#impgo').onclick = applyImport;
    if ($('#impno')) $('#impno').onclick = function () { pendingImport = null; U.render(true); };
    $('#jsonout').onclick = function () { download('ppa-maint-backup-' + S.todayStr() + '.json', JSON.stringify({ settings: st.settings, alerts: st.alerts, aircraft: st.aircraft, squawks: st.squawks, closedSquawks: st.closedSquawks, flightReports: st.flightReports || [], priv: st.priv, roles: st.roles, accessRequests: st.accessRequests || [] }, null, 1), 'application/json'); };
    if ($('#jsonin')) $('#jsonin').onchange = function () { var f = this.files[0]; if (!f) return; f.text().then(function (t) { try { var d = JSON.parse(t); if (!d.aircraft || !d.settings) throw new Error('Not a board backup'); localStorage.setItem('ppa-mb-demo-v1', JSON.stringify(d)); location.reload(); } catch (e) { toast(e.message, true); } }); };
    if ($('#reset')) $('#reset').onclick = function () { if (confirm('Replace everything on this device with fresh SAMPLE data?')) { Store.resetDemo(); toast('Sample data reloaded'); } };
    if ($('#clear')) $('#clear').onclick = function () { if (confirm('Remove all sample aircraft and squawks on this device? (Settings stay.)')) { Store.clearDemo(); toast('Empty board ready'); } };
  }
  return { view: view, buildImport: buildImport, buildFspImport: buildFspImport, parseCSV: parseCSV, exportFlightLog: exportFlightLog };
})();
