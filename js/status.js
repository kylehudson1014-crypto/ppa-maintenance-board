/* PPA Maintenance Board — status logic (pure JS, no DOM).
   Shared by the web app and the Google Apps Script alert sender.
   TRACKING AID ONLY. The aircraft logbooks are the legal record. */
var PPAStatus = (function () {
  var ITEMS = [
    { key: 'annual',  letter: 'A', label: 'Annual inspection',        short: 'Annual' },
    { key: 'hundred', letter: '1', label: '100-hour inspection',      short: '100-hr' },
    { key: 'pitot',   letter: 'A', label: 'Altimeter / pitot-static (IFR)', short: 'Alt/Pitot' },
    { key: 'xpdr',    letter: 'T', label: 'Transponder',              short: 'Xpdr' },
    { key: 'elt',     letter: 'E', label: 'ELT inspection + battery', short: 'ELT' },
    { key: 'ads',     letter: 'D', label: 'Airworthiness Directives & tracked reminders', short: 'ADs' },
    { key: 'oil50',   letter: '50', label: '50-hr oil change', short: '50-hr oil' }
  ];

  var DEFAULT_RULES = {
    annual:  { months: 12, warnDays: 30 },
    hundred: { hours: 100, warnHours: 10 },
    pitot:   { months: 24, warnDays: 30 },
    xpdr:    { months: 24, warnDays: 30 },
    elt:     { months: 12, warnDays: 30 },
    ads:     { warnDays: 30, warnHours: 10 },
    oil50:   { hours: 50, warnHours: 5 },
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

  // ---- tracked reminders (ADs / extras) ----
  // GPS / nav database updates are not tracked (Chad, 11/16/2026).
  var GPS_RE = /\bgps\b|nav\s*data|navigation\s*data|\bnav\s*db\b|\bdatabase\b|\bnavdata\b|jeppesen/i;
  // A 50-hour oil change reminder (FSP "50 Hour Oil Change", "50 hr oil", "Oil change", ...).
  var OIL50_RE = /\b50\s*-?\s*(hour|hr|h)s?\b.*\boil\b|\boil\s*(and\s*filter\s*)?change\b|\boil\b.*\b50\s*-?\s*(hour|hr|h)s?\b/i;
  function adText(ad) { return String((ad && ad.number) || '') + ' ' + String((ad && ad.desc) || ''); }
  function isGpsUpdate(ad) { return !isOilChange(ad) && GPS_RE.test(adText(ad)); }
  function isOilChange(ad) { return !!ad && (ad.kind === 'oil50' || OIL50_RE.test(adText(ad))); }
  // Ignored = editor tapped Ignore, or a GPS/nav update the editor has not explicitly restored.
  // The 50-hr oil change can never be ignored (Kyle, 11/16/2026): any old `ignored` flag on it is overridden.
  function isIgnoredAD(ad) { if (!ad || isOilChange(ad)) return false; if (ad.ignored === true) return true; if (ad.ignored === false) return false; return isGpsUpdate(ad); }
  // Default 50-hr oil change for planes that do not already track one (e.g. from FSP).
  // Starting point: the last 100-hr (oil is changed at the 100-hr), unless an editor records one.
  function defaultOil50(a, R) {
    R = R || rules(null);
    var last100 = num(a && a.last100);
    return { id: 'oil50', kind: 'oil50', virtual: true, number: '', desc: '50-hr oil change', nonGrounding: true,
      intervalMonths: null, intervalDays: null, intervalHours: R.oil50.hours,
      lastDoneDate: '', lastDoneHours: last100, assumedFrom100: last100 != null,
      nextDueDate: '', nextDueHours: null };
  }
  // The list the board tracks for one aircraft: stored ADs + the default oil change when missing.
  function trackedADs(a, R) {
    var list = (a && a.ads || []).slice();
    if (!list.some(isOilChange) && a && a.oil50 !== false) list.push(defaultOil50(a, R));
    return list;
  }

  function evalAD(ad, a, R, today) {
    var cur = meterReading(a);
    var dueDate = ad.nextDueDate || null, dueHrs = num(ad.nextDueHours);
    if (num(ad.intervalDays) && ad.lastDoneDate) dueDate = addDays(ad.lastDoneDate, num(ad.intervalDays));
    if (num(ad.intervalMonths) && ad.lastDoneDate) dueDate = addCalMonths(ad.lastDoneDate, num(ad.intervalMonths));
    if (num(ad.intervalHours) && num(ad.lastDoneHours) != null) dueHrs = num(ad.lastDoneHours) + num(ad.intervalHours);
    var res = { state: 'ok', parts: [] };
    if (!dueDate && dueHrs == null) {
      if (ad.virtual) return { state: 'none', value: '—', detail: '50-hr oil change: enter when it was last done', dueDate: null, dueHours: null };
      return { state: 'missing', value: '?', detail: (ad.number || 'AD') + ': no next-due entered', dueDate: null, dueHours: null };
    }
    var st = 'ok', value = '', detail = [];
    var dLeft = null, hLeft = null;
    if (dueDate) { dLeft = daysBetween(today, dueDate); detail.push(niceDate(dueDate)); }
    if (dueHrs != null && cur != null) { hLeft = dueHrs - cur; detail.push(hoursText(dueHrs) + ' h'); }
    if ((dLeft != null && dLeft < 0) || (hLeft != null && hLeft < 0)) st = 'over';
    else if ((dLeft != null && dLeft <= R.ads.warnDays) || (hLeft != null && hLeft <= R.ads.warnHours)) st = 'due';
    var ngOver = false;
    var nonGr = ad.nonGrounding || /non\s*-?\s*grounding/i.test(ad.desc || '') || (isOilChange(ad) && ad.nonGrounding !== false);
    var warnH = isOilChange(ad) && R.oil50 ? R.oil50.warnHours : R.ads.warnHours;
    if (st === 'due' && !(dLeft != null && dLeft <= R.ads.warnDays) && hLeft != null && hLeft > warnH) st = 'ok';
    if (st === 'over' && nonGr) { st = 'due'; ngOver = true; }
    var overText = '';
    if (hLeft != null && (dLeft == null || hLeft * 1 < dLeft)) { value = hLeft < 0 ? '-' + hoursText(-hLeft) + 'h' : hoursText(hLeft) + 'h'; if (hLeft < 0) overText = hoursText(-hLeft) + ' hrs'; }
    else { value = dLeft < 0 ? '-' + (-dLeft) + 'd' : dLeft + 'd'; if (dLeft < 0) overText = (-dLeft) + ' days'; }
    return { state: st, value: value, overText: overText, dLeft: dLeft, hLeft: hLeft, dueDate: dueDate, dueHours: dueHrs,
      nonGroundingOverdue: ngOver,
      detail: (ngOver ? 'OVERDUE (non-grounding) — ' : '') + (ad.number || ad.desc || 'AD') + ' due ' + detail.join(' or ') + ' (whichever first)' + (nonGr && !ngOver ? ' · non-grounding' : '') + (ad.virtual && ad.assumedFrom100 ? ' · assumed from last 100-hr' : '') };
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
      if ((na[it.key] && it.key !== 'oil50') || (it.key === 'pitot' && a.ifr === false) || (it.key === 'hundred' && a.forHire === false)) {
        out.push(Object.assign(base, { state: 'na', value: 'N/A', detail: 'Not applicable' })); return;
      }
      if (it.key === 'annual') out.push(dateItem(base, addCalMonths(d.annual, R.annual.months), R.annual.warnDays, today));
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
      else if (it.key === 'oil50') {
        var oils = trackedADs(a, R).filter(function (x) { return !x.inactive && isOilChange(x); });
        var liveOils = oils.filter(function (x) { return !isIgnoredAD(x); });
        if (!liveOils.length) { out.push(Object.assign(base, { state: 'na', value: 'N/A', detail: oils.length ? '50-hr oil change ignored' : 'Not tracked', ads: [], ignoredAds: oils })); return; }
        var oe = liveOils.map(function (ad) { var e = evalAD(ad, a, R, today); e.ad = ad; return e; });
        var wo = oe.reduce(function (p, c) { return RANK[c.state] > RANK[p.state] ? c : p; });
        out.push(Object.assign(base, { state: wo.state, value: wo.value, overText: wo.overText, nonGroundingOverdue: !!wo.nonGroundingOverdue, detail: wo.detail, ads: oe, ignoredAds: oils.filter(isIgnoredAD) }));
      }
      else if (it.key === 'ads') {
        var all = trackedADs(a, R).filter(function (x) { return !x.inactive && !isOilChange(x); }); // oil change has its own "50" letter
        var ignoredAds = all.filter(isIgnoredAD);
        var ads = all.filter(function (x) { return !isIgnoredAD(x); });
        if (!ads.length) { out.push(Object.assign(base, { state: 'none', value: '—', detail: 'No recurring ADs listed' + (ignoredAds.length ? ' · ' + ignoredAds.length + ' ignored' : ''), ads: [], ignoredAds: ignoredAds })); return; }
        var evals = ads.map(function (ad) { var e = evalAD(ad, a, R, today); e.ad = ad; return e; });
        var w2 = evals.reduce(function (p, c) { return RANK[c.state] > RANK[p.state] ? c : (RANK[c.state] === RANK[p.state] && (c.dLeft != null && p.dLeft != null && c.dLeft < p.dLeft) ? c : p); });
        out.push(Object.assign(base, { state: w2.state, value: w2.value, overText: w2.overText, nonGroundingOverdue: !!w2.nonGroundingOverdue, detail: w2.detail + (ads.length > 1 ? ' · ' + ads.length + ' items tracked' : '') + (ignoredAds.length ? ' · ' + ignoredAds.length + ' ignored' : ''), ads: evals, ignoredAds: ignoredAds }));
      }
    });

    var open = (squawks || []).filter(function (s) { return s.aircraftId === a.id && s.status === 'open'; });
    var grounding = open.filter(function (s) { return s.grounding; });
    var reasons = [];
    out.forEach(function (i) { if (i.state === 'over') reasons.push((i.reasonShort || i.short) + ' OVERDUE' + (i.overText ? ' ' + i.overText : '')); });
    grounding.forEach(function (s) { reasons.push('Squawk: ' + s.text); });
    if (a.grounded) reasons.unshift('Grounded by maintenance' + (a.groundedReason ? ': ' + a.groundedReason : ''));
    var overall = 'ok', dueReasons = [];
    if (reasons.length) overall = 'grounded';
    else {
      out.forEach(function (i) {
        if (i.state === 'due' && i.nonGroundingOverdue) dueReasons.push((i.reasonShort || i.short) + ' OVERDUE (non-grounding): ' + i.value);
        else if (i.state === 'due') dueReasons.push((i.reasonShort || i.short) + ' due in ' + i.value);
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

  function reportTime(r) {
    var at = Date.parse(r && r.createdAt || '');
    return isNaN(at) ? null : at;
  }

  function oilAddedSince(reports, aircraftId, sinceIso, now) {
    reports = reports || [];
    var cut = sinceIso ? Date.parse(sinceIso) : null;
    if (cut != null && isNaN(cut)) cut = null;
    var end = now ? now.getTime() : Infinity;
    var sum = 0;
    reports.forEach(function (r) {
      if (aircraftId && r.aircraftId !== aircraftId) return;
      if (!r.oilAdded || r.oilQts == null) return;
      var at = reportTime(r);
      if (at == null) return;
      if (cut != null && at < cut) return;
      if (at > end) return;
      sum += Number(r.oilQts) || 0;
    });
    return Math.round(sum * 10) / 10;
  }

  function oilAddedLast30Days(reports, aircraftId, now) {
    now = now || new Date();
    return oilAddedSince(reports, aircraftId, new Date(now.getTime() - 30 * 86400000).toISOString(), now);
  }

  function lastFspImportAt(settings, aircraft) {
    var t = settings && settings.lastFspImportAt;
    if (t && !isNaN(Date.parse(t))) return t;
    var latest = null;
    (aircraft || []).forEach(function (a) {
      (a.log || []).forEach(function (e) {
        if (!e || !e.at || !e.what) return;
        if (!/^FSP import/i.test(String(e.what))) return;
        if (!latest || String(e.at) > String(latest)) latest = e.at;
      });
    });
    return latest;
  }

  function hoursFlownInRange(reports, aircraftId, meter, sinceMs, now) {
    var end = now ? now.getTime() : Date.now();
    var sum = 0, n = 0;
    (reports || []).forEach(function (r) {
      if (aircraftId && r.aircraftId !== aircraftId) return;
      var at = reportTime(r);
      if (at == null || at > end || (sinceMs != null && at < sinceMs)) return;
      var a = r[meter + 'Start'], b = r[meter + 'End'];
      if (a == null || b == null || a === '' || b === '') return;
      a = Number(a); b = Number(b);
      if (isNaN(a) || isNaN(b) || b < a) return;
      sum += (b - a);
      n++;
    });
    return { hours: Math.round(sum * 10) / 10, flights: n };
  }

  function oilRatePer10Hours(reports, aircraft, now) {
    if (!aircraft) return null;
    now = now || new Date();
    var meter = hasTach(aircraft) ? 'tach' : 'hobbs';
    var since = now.getTime() - 30 * 86400000;
    var qts = oilAddedSince(reports, aircraft.id, new Date(since).toISOString(), now);
    var flown = hoursFlownInRange(reports, aircraft.id, meter, since, now);
    if (!flown.hours) return null;
    return { meter: meter, qts: qts, hours: flown.hours, flights: flown.flights, rate: Math.round((qts / flown.hours) * 10 * 10) / 10 };
  }

  function oilSummary(reports, aircraft, settings, fleet, now) {
    now = now || new Date();
    var id = aircraft && aircraft.id;
    var last30cut = new Date(now.getTime() - 30 * 86400000).toISOString();
    var fspAt = lastFspImportAt(settings, fleet);
    return {
      last30: oilAddedSince(reports, id, last30cut, now),
      allTime: oilAddedSince(reports, id, null, now),
      sinceFsp: fspAt ? oilAddedSince(reports, id, fspAt, now) : null,
      fspAt: fspAt,
      rate: oilRatePer10Hours(reports, aircraft, now)
    };
  }

  function reportsFor(reports, aircraftId) {
    return (reports || []).filter(function (r) { return r.aircraftId === aircraftId; }).slice().sort(function (a, b) {
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
  }

  function flightLogSheetPayload(report, opt) {
    opt = opt || {};
    return {
      token: opt.token || '',
      reportId: report && report.id ? String(report.id) : '',
      createdAt: (report && report.createdAt) || '',
      tail: (report && report.tail) || '',
      location: opt.location || '',
      cfiName: (report && report.reportedBy) || '',
      cfiEmail: (report && report.reporterEmail) || '',
      student: (report && report.student) || '',
      tachStart: report ? report.tachStart : null,
      tachEnd: report ? report.tachEnd : null,
      hobbsStart: report ? report.hobbsStart : null,
      hobbsEnd: report ? report.hobbsEnd : null,
      oilAdded: !!(report && report.oilAdded),
      oilQts: report && report.oilAdded ? report.oilQts : null,
      squawkText: opt.squawkText || '',
      tachPhoto: opt.tachPhoto || '',
      hobbsPhoto: opt.hobbsPhoto || ''
    };
  }

  // ---- squawk de-duplication ----
  // Same squawk = same plane + same text ignoring case, spacing, curly quotes and trailing punctuation.
  function normSquawkText(t) {
    return String(t || '').toLowerCase().replace(/[\u2018\u2019\u201b`´]/g, "'").replace(/[\u201c\u201d]/g, '"')
      .replace(/\s+/g, ' ').replace(/[\s.!?,;:]+$/g, '').trim();
  }
  function squawkKey(s) { return String((s && (s.aircraftId || String(s.tail || '').toUpperCase().replace(/[\s-]/g, ''))) || '') + '|' + normSquawkText(s && s.text); }
  // Collapse exact duplicates for display: keep the oldest, remember the hidden ids in _dupIds
  // so clearing / editing the kept one also clears the copies.
  function collapseSquawks(list) {
    var seen = {}, out = [];
    (list || []).slice().sort(function (a, b) { return String(a.createdAt || '').localeCompare(String(b.createdAt || '')); }).forEach(function (s) {
      var k = squawkKey(s), keep = seen[k];
      if (!keep) { keep = seen[k] = Object.assign({}, s, { _dupIds: (s._dupIds || []).slice() }); out.push(keep); return; }
      if (keep.id !== s.id && keep._dupIds.indexOf(s.id) < 0) keep._dupIds.push(s.id);
      (s._dupIds || []).forEach(function (d) { if (keep._dupIds.indexOf(d) < 0) keep._dupIds.push(d); });
    });
    var order = (list || []).map(function (s) { return s.id; });
    return out.sort(function (a, b) { return order.indexOf(a.id) - order.indexOf(b.id); });
  }
  // Import check: is this FSP squawk already on the board? FSP id when known; otherwise same text and
  // (still open on the board, or the same FSP report date).
  function isDuplicateSquawk(sq, list) {
    var k = squawkKey(sq);
    return (list || []).some(function (s) {
      if (sq.fspId && s.fspId) return String(sq.fspId) === String(s.fspId);
      if (squawkKey(s) !== k) return false;
      if (s.status === 'open') return true;
      if (!sq.date) return true;
      if (s.fspDate) return String(s.fspDate).slice(0, 10) === sq.date;
      return String(s.createdAt || '').slice(0, 10) === sq.date;
    });
  }

  function meterDeltaHours(start, end) {
    if (start == null || end == null || start === '' || end === '') return null;
    var a = Number(start), b = Number(end);
    if (isNaN(a) || isNaN(b)) return null;
    return Math.round((b - a) * 10) / 10;
  }

  // Compare a snapped / typed meter reading to the aircraft's current board value.
  // Returns null when there is nothing to check.
  function meterPlausibility(reading, current, opt) {
    opt = opt || {};
    if (reading == null || reading === '' || isNaN(Number(reading))) return null;
    var v = Number(reading);
    if (current == null || current === '' || isNaN(Number(current))) return { ok: true, warn: false, message: '' };
    var cur = Number(current);
    var maxJump = opt.maxJump == null ? 10 : Number(opt.maxJump);
    var delta = Math.round((v - cur) * 10) / 10;
    if (v < cur) return { ok: false, warn: true, kind: 'low', delta: delta, message: 'This reading (' + v + ') is LOWER than the current board meter (' + cur + '). Check the photo or type the number yourself.' };
    if (delta > maxJump) return { ok: true, warn: true, kind: 'high', delta: delta, message: 'This reading is ' + delta + ' hours above the current board meter (' + cur + '). Confirm it is right before you submit.' };
    return { ok: true, warn: false, kind: 'ok', delta: delta, message: '' };
  }

  return { ITEMS: ITEMS, DEFAULT_RULES: DEFAULT_RULES, rules: rules, evaluate: evaluate, evalAD: evalAD,
    isGpsUpdate: isGpsUpdate, isOilChange: isOilChange, isIgnoredAD: isIgnoredAD, defaultOil50: defaultOil50, trackedADs: trackedADs, alertEvents: alertEvents,
    todayStr: todayStr, addDays: addDays, addCalMonths: addCalMonths, daysBetween: daysBetween, niceDate: niceDate, hoursText: hoursText,
    hoursLabel: hoursLabel, meterOf: meterOf, meterReading: meterReading, meterUpdated: meterUpdated, syncMeters: syncMeters,
    hasTach: hasTach, oilAddedLast30Days: oilAddedLast30Days, oilAddedSince: oilAddedSince, lastFspImportAt: lastFspImportAt,
    hoursFlownInRange: hoursFlownInRange, oilRatePer10Hours: oilRatePer10Hours, oilSummary: oilSummary, reportsFor: reportsFor,
    normSquawkText: normSquawkText, collapseSquawks: collapseSquawks, isDuplicateSquawk: isDuplicateSquawk,
    flightLogSheetPayload: flightLogSheetPayload, meterDeltaHours: meterDeltaHours, meterPlausibility: meterPlausibility };
})();
if (typeof module !== 'undefined') module.exports = PPAStatus;
