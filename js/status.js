/* PPA Maintenance Board — status logic (pure JS, no DOM).
   Shared by the web app and the Google Apps Script alert sender.
   TRACKING AID ONLY. The aircraft logbooks are the legal record. */
var PPAStatus = (function () {
  var ITEMS = [
    { key: 'annual',  letter: 'A', label: 'Annual inspection',        short: 'Annual' },
    { key: 'vor',     letter: 'V', label: 'VOR check (IFR)',          short: 'VOR' },
    { key: 'hundred', letter: '1', label: '100-hour inspection',      short: '100-hr' },
    { key: 'pitot',   letter: 'A', label: 'Altimeter / pitot-static (IFR)', short: 'Alt/Pitot' },
    { key: 'xpdr',    letter: 'T', label: 'Transponder',              short: 'Xpdr' },
    { key: 'elt',     letter: 'E', label: 'ELT inspection + battery', short: 'ELT' },
    { key: 'ads',     letter: 'D', label: 'Airworthiness Directives', short: 'ADs' }
  ];

  var DEFAULT_RULES = {
    annual:  { months: 12, warnDays: 30 },
    vor:     { days: 30,   warnDays: 7 },
    hundred: { hours: 100, warnHours: 10 },
    pitot:   { months: 24, warnDays: 30 },
    xpdr:    { months: 24, warnDays: 30 },
    elt:     { months: 12, warnDays: 30 },
    ads:     { warnDays: 30, warnHours: 10 },
    staleHoursDays: 7
  };

  function rules(settings) {
    var r = JSON.parse(JSON.stringify(DEFAULT_RULES));
    var s = (settings && settings.rules) || {};
    Object.keys(s).forEach(function (k) {
      if (typeof s[k] === 'object' && s[k]) { r[k] = r[k] || {}; Object.keys(s[k]).forEach(function (kk) { var v = Number(s[k][kk]); if (!isNaN(v) && s[k][kk] !== '' && s[k][kk] !== null) r[k][kk] = v; }); }
      else if (s[k] !== '' && s[k] != null && !isNaN(Number(s[k]))) r[k] = Number(s[k]);
    });
    return r;
  }

  // ---- date helpers (dates are 'YYYY-MM-DD' strings in local time) ----
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayStr(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null; var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function fmt(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function addDays(s, n) { var t = parse(s); return t == null ? null : fmt(t + n * 86400000); }
  // FAR "calendar months": due through the LAST day of the Nth month after the month done.
  function addCalMonths(s, n) { var t = parse(s); if (t == null) return null; var d = new Date(t); var y = d.getUTCFullYear(), m = d.getUTCMonth() + n; return fmt(Date.UTC(y, m + 1, 0)); }
  function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
  function niceDate(s) { var t = parse(s); if (t == null) return '—'; var d = new Date(t); var M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return M[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear(); }
  function num(v) { if (v === '' || v == null) return null; var n = Number(v); return isNaN(n) ? null : n; }

  var RANK = { na: 0, none: 0, ok: 1, missing: 2, due: 3, over: 4 };
  function worse(a, b) { return RANK[b.state] > RANK[a.state] ? b : a; }

  function dateItem(base, dueDate, warnDays, today) {
    if (!dueDate) return Object.assign(base, { state: 'missing', value: '?', detail: 'No date entered' });
    var left = daysBetween(today, dueDate);
    var st = left < 0 ? 'over' : (left <= warnDays ? 'due' : 'ok');
    return Object.assign(base, { state: st, dueDate: dueDate, daysLeft: left,
      value: left < 0 ? '-' + (-left) + 'd' : left + 'd', overText: left < 0 ? (-left) + (left === -1 ? ' day' : ' days') : '',
      detail: (left < 0 ? 'OVERDUE since ' : 'Due ') + niceDate(dueDate) });
  }

  function hoursText(h) { return (Math.round(h * 10) / 10).toFixed(1); }
  function hoursLabel(h) { return h == null ? '—' : hoursText(h); }
  function meterOf(a) { return a && a.meter === 'hobbs' ? 'hobbs' : 'tach'; }
  // Selected-meter hours. A legacy `hours` value belongs to the selected meter only.
  function meterReading(a, which) {
    if (!a) return null;
    which = which || meterOf(a);
    var v = num(a[which]);
    if (v != null) return v;
    if (which === meterOf(a)) return num(a.hours);
    return null;
  }
  function meterUpdated(a, which) {
    if (!a) return '';
    which = which || meterOf(a);
    return a[which + 'Updated'] || (which === meterOf(a) ? (a.hoursUpdated || '') : '') || '';
  }
  // Keep hours == the selected meter. Copy a legacy hours value into that meter if it is empty.
  function syncMeters(a) {
    if (!a) return a;
    var m = meterOf(a);
    if (num(a[m]) == null && num(a.hours) != null) {
      a[m] = num(a.hours);
      if (!a[m + 'Updated'] && a.hoursUpdated) a[m + 'Updated'] = a.hoursUpdated;
    }
    a.hours = meterReading(a, m);
    a.hoursUpdated = meterUpdated(a, m) || a.hoursUpdated || '';
    return a;
  }

  function evalAD(ad, a, R, today) {
    var cur = meterReading(a);
    var dueDate = ad.nextDueDate || null, dueHrs = num(ad.nextDueHours);
    if (num(ad.intervalDays) && ad.lastDoneDate) dueDate = addDays(ad.lastDoneDate, num(ad.intervalDays));
    if (num(ad.intervalMonths) && ad.lastDoneDate) dueDate = addCalMonths(ad.lastDoneDate, num(ad.intervalMonths));
    if (num(ad.intervalHours) && num(ad.lastDoneHours) != null) dueHrs = num(ad.lastDoneHours) + num(ad.intervalHours);
    var res = { state: 'ok', parts: [] };
    if (!dueDate && dueHrs == null) return { state: 'missing', value: '?', detail: (ad.number || 'AD') + ': no next-due entered', dueDate: null, dueHours: null };
    var st = 'ok', value = '', detail = [];
    var dLeft = null, hLeft = null;
    if (dueDate) { dLeft = daysBetween(today, dueDate); detail.push(niceDate(dueDate)); }
    if (dueHrs != null && cur != null) { hLeft = dueHrs - cur; detail.push(hoursText(dueHrs) + ' h'); }
    if ((dLeft != null && dLeft < 0) || (hLeft != null && hLeft < 0)) st = 'over';
    else if ((dLeft != null && dLeft <= R.ads.warnDays) || (hLeft != null && hLeft <= R.ads.warnHours)) st = 'due';
    var overText = '';
    if (hLeft != null && (dLeft == null || hLeft * 1 < dLeft)) { value = hLeft < 0 ? '-' + hoursText(-hLeft) + 'h' : hoursText(hLeft) + 'h'; if (hLeft < 0) overText = hoursText(-hLeft) + ' hrs'; }
    else { value = dLeft < 0 ? '-' + (-dLeft) + 'd' : dLeft + 'd'; if (dLeft < 0) overText = (-dLeft) + ' days'; }
    return { state: st, value: value, overText: overText, dLeft: dLeft, hLeft: hLeft, dueDate: dueDate, dueHours: dueHrs,
      detail: (ad.number || 'AD') + ' due ' + detail.join(' or ') + ' (whichever first)' };
  }

  // Evaluate one aircraft. Returns { items:[...], overall:'grounded'|'due'|'ok', reasons:[...], ... }
  function evaluate(a, settings, squawks, today) {
    today = today || todayStr();
    var R = rules(settings);
    var na = a.na || {};
    var d = a.dates || {};
    var out = [];
    ITEMS.forEach(function (it) {
      var base = { key: it.key, letter: it.letter, label: it.label, short: it.short };
      if (na[it.key] || ((it.key === 'vor' || it.key === 'pitot') && a.ifr === false) || (it.key === 'hundred' && a.forHire === false)) {
        out.push(Object.assign(base, { state: 'na', value: 'N/A', detail: 'Not applicable' })); return;
      }
      if (it.key === 'annual') out.push(dateItem(base, addCalMonths(d.annual, R.annual.months), R.annual.warnDays, today));
      else if (it.key === 'vor') out.push(dateItem(base, addDays(d.vor, R.vor.days), R.vor.warnDays, today));
      else if (it.key === 'pitot') out.push(dateItem(base, addCalMonths(d.pitot, R.pitot.months), R.pitot.warnDays, today));
      else if (it.key === 'xpdr') out.push(dateItem(base, addCalMonths(d.xpdr, R.xpdr.months), R.xpdr.warnDays, today));
      else if (it.key === 'hundred') {
        var cur = meterReading(a), last = num(a.last100);
        if (cur == null || last == null) { out.push(Object.assign(base, { state: 'missing', value: '?', detail: 'Enter current ' + meterOf(a) + ' and last 100-hr' })); return; }
        var due = last + R.hundred.hours, left = due - cur;
        out.push(Object.assign(base, { state: left < 0 ? 'over' : (left <= R.hundred.warnHours ? 'due' : 'ok'), dueHours: due, hoursLeft: left,
          value: left < 0 ? '-' + hoursText(-left) + 'h' : hoursText(left) + 'h', overText: left < 0 ? hoursText(-left) + ' hrs' : '',
          detail: (left < 0 ? 'OVERDUE — was due at ' : 'Due at ') + hoursText(due) + ' ' + meterOf(a) + '. (The 10-hr overfly allowance is only to reach a place where the inspection can be done; it does not extend the due time and counts against the next interval.)' }));
      }
      else if (it.key === 'elt') {
        var insp = dateItem({}, addCalMonths(d.elt, R.elt.months), R.elt.warnDays, today);
        var bat = dateItem({}, d.eltBattery || null, R.elt.warnDays, today);
        var w = worse(insp, bat);
        out.push(Object.assign(base, { state: w.state, value: w.value, overText: w.overText, dueDate: w.dueDate,
          detail: 'Inspection: ' + (insp.dueDate ? niceDate(insp.dueDate) : 'no date') + ' · Battery exp: ' + (d.eltBattery ? niceDate(d.eltBattery) : 'no date'),
          sub: [{ k: 'Inspection', s: insp.state, v: insp.value }, { k: 'Battery', s: bat.state, v: bat.value }] }));
      }
      else if (it.key === 'ads') {
        var ads = (a.ads || []).filter(function (x) { return !x.inactive; });
        if (!ads.length) { out.push(Object.assign(base, { state: 'none', value: '—', detail: 'No recurring ADs listed' })); return; }
        var evals = ads.map(function (ad) { var e = evalAD(ad, a, R, today); e.ad = ad; return e; });
        var w2 = evals.reduce(function (p, c) { return RANK[c.state] > RANK[p.state] ? c : (RANK[c.state] === RANK[p.state] && (c.dLeft != null && p.dLeft != null && c.dLeft < p.dLeft) ? c : p); });
        out.push(Object.assign(base, { state: w2.state, value: w2.value, overText: w2.overText, detail: w2.detail + (ads.length > 1 ? ' · ' + ads.length + ' ADs tracked' : ''), ads: evals }));
      }
    });

    var open = (squawks || []).filter(function (s) { return s.aircraftId === a.id && s.status === 'open'; });
    var grounding = open.filter(function (s) { return s.grounding; });
    var reasons = [];
    out.forEach(function (i) { if (i.state === 'over') reasons.push(i.short + ' OVERDUE' + (i.overText ? ' ' + i.overText : '')); });
    grounding.forEach(function (s) { reasons.push('Squawk: ' + s.text); });
    if (a.grounded) reasons.unshift('Grounded by maintenance' + (a.groundedReason ? ': ' + a.groundedReason : ''));
    var overall = 'ok', dueReasons = [];
    if (reasons.length) overall = 'grounded';
    else {
      out.forEach(function (i) {
        if (i.state === 'due') dueReasons.push(i.short + ' due in ' + i.value);
        if (i.state === 'missing') dueReasons.push(i.short + ': needs data');
      });
      if (dueReasons.length) overall = 'due';
    }
    var staleSrc = meterUpdated(a);
    var staleDays = staleSrc ? daysBetween(staleSrc, today) : null;
    var hundred = out.filter(function (i) { return i.key === 'hundred'; })[0];
    return { id: a.id, items: out, overall: overall, reasons: overall === 'grounded' ? reasons : dueReasons,
      openSquawks: open.length, groundingSquawks: grounding.length, squawkList: open,
      hundred: hundred, hoursStale: staleDays != null && staleDays > R.staleHoursDays, staleDays: staleDays };
  }

  // Compare two evaluations (previous vs now) and list alert-worthy events.
  function alertEvents(aircraft, prevMap, nowMap, alertCfg) {
    var ev = [];
    var cfg = alertCfg || {};
    aircraft.forEach(function (a) {
      var now = nowMap[a.id], prev = prevMap ? prevMap[a.id] : null;
      if (!now) return;
      if (now.overall === 'grounded' && (!prev || prev.overall !== 'grounded') && cfg.onGrounded !== false)
        ev.push({ type: 'grounded', aircraft: a, eval: now, subject: a.tail + ' is GROUNDED', text: now.reasons.join('; ') });
      if (prev && prev.overall === 'grounded' && now.overall !== 'grounded' && cfg.onReturn !== false)
        ev.push({ type: 'returned', aircraft: a, eval: now, subject: a.tail + ' is back in service', text: now.overall === 'due' ? 'Back in service. Still coming due: ' + now.reasons.join('; ') : 'Back in service, all items current.' });
      if (now.overall === 'due' && (!prev || prev.overall === 'ok') && cfg.onDueSoon !== false)
        ev.push({ type: 'due', aircraft: a, eval: now, subject: a.tail + ' has maintenance coming due', text: now.reasons.join('; ') });
    });
    return ev;
  }

  // True when this aircraft has a tachometer. Sims (Redbird, AATD, etc.) typically do not.
  function hasTach(a) {
    if (!a) return true;
    if (a.hasTach === false || a.noTach === true) return false;
    if (a.hasTach === true) return true;
    var t = String((a.type || '') + ' ' + (a.tail || '')).toLowerCase();
    return !/redbird|aatd|batd|\bsimulator\b|\bflight sim\b|\bftd\b|training device/.test(t);
  }

  function oilAddedLast30Days(reports, aircraftId, now) {
    reports = reports || [];
    now = now || new Date();
    var cut = now.getTime() - 30 * 86400000, sum = 0;
    reports.forEach(function (r) {
      if (aircraftId && r.aircraftId !== aircraftId) return;
      if (!r.oilAdded || r.oilQts == null) return;
      var at = Date.parse(r.createdAt || '');
      if (!isNaN(at) && at >= cut) sum += Number(r.oilQts) || 0;
    });
    return Math.round(sum * 10) / 10;
  }

  function reportsFor(reports, aircraftId) {
    return (reports || []).filter(function (r) { return r.aircraftId === aircraftId; }).slice().sort(function (a, b) {
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
  }

  function latestUnapplied(reports, aircraftId) {
    var list = reportsFor(reports, aircraftId);
    for (var i = 0; i < list.length; i++) {
      if (!list[i].applied && (list[i].tachEnd != null || list[i].hobbsEnd != null)) return list[i];
    }
    return null;
  }

  return { ITEMS: ITEMS, DEFAULT_RULES: DEFAULT_RULES, rules: rules, evaluate: evaluate, alertEvents: alertEvents,
    todayStr: todayStr, addDays: addDays, addCalMonths: addCalMonths, daysBetween: daysBetween, niceDate: niceDate, hoursText: hoursText,
    hoursLabel: hoursLabel, meterOf: meterOf, meterReading: meterReading, meterUpdated: meterUpdated, syncMeters: syncMeters,
    hasTach: hasTach, oilAddedLast30Days: oilAddedLast30Days, reportsFor: reportsFor, latestUnapplied: latestUnapplied };
})();
if (typeof module !== 'undefined') module.exports = PPAStatus;
