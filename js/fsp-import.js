/* Parse Flight Schedule Pro "Maintenance Status Report" PDFs (and equivalent text items). */
var PPAFspImport = (function () {
  var LOC_ALIAS = { ECP: 'KECP', CEW: 'KCEW', DHN: 'KDHN', KECP: 'KECP', KCEW: 'KCEW', KDHN: 'KDHN' };
  var REMINDER_START = /^(100\s*(Hour|HR)|50\s*(Hour|HR)|Annual\b|Altimeter\b|ELT\b|Transponder\b|GPS\b|AD\s+\d|Carbon\b|VOR\b|Pitot\b)/i;
  var CONTINUATION_NAME = /^(Inspection|System|Updates|Replacement|Monoxide|Detector|Change|Grounding\)?|Pressure|Switch\)?|Lines|and|Clamps\)|Injector|Oil|Only\)|Completed\)|hours\)|days\)|\(One-Time|\(Non-|\(Fuel|\(Engine|\(Ignition|\(Seat|\(Map|Map|Light|Switch|in|the|Left|Hand|Forward|Door|Post\)|Rail\/Track\)|Hour|HR|Inspection\))$/i;
  var METER_RE = /(Tach\s*2|Engine\s*2|Prop\s*2|Total\s*Time|Hobbs|Tach|Engine|Prop)\s*:\s*([0-9,]+(?:\.\d+)?)/gi;
  var PDFJS_VER = '4.10.38';
  var PDFJS_BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_VER + '/build/';

  function normGlyphs(s) {
    return String(s || '')
      .replace(/\uFB01/g, 'fi').replace(/\uFB02/g, 'fl')
      .replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"').replace(/\u00A0/g, ' ');
  }
  function squash(s) { return normGlyphs(s).replace(/\s+/g, ' ').trim(); }
  function num(v) {
    if (v === '' || v == null) return null;
    var n = Number(String(v).replace(/,/g, ''));
    return isNaN(n) ? null : n;
  }
  function parseDate(v) {
    v = squash(v);
    if (!v) return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    var m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m) return null;
    var y = +m[3]; if (y < 100) y += (y >= 80 ? 1900 : 2000);
    return y + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  }
  function locCode(raw) {
    var k = String(raw || '').toUpperCase().replace(/[^A-Z]/g, '');
    return LOC_ALIAS[k] || (k ? k : '');
  }

  function clusterLines(items, ytol) {
    ytol = ytol || 4;
    var list = items.slice().sort(function (a, b) { return a.page - b.page || a.y - b.y || a.x - b.x; });
    var lines = [], i, it, ym, last;
    for (i = 0; i < list.length; i++) {
      it = list[i];
      if (!it.str && it.str !== '0') continue;
      ym = it.y;
      last = lines[lines.length - 1];
      if (last && last.page === it.page && Math.abs(last.ym - ym) <= ytol) {
        last.words.push(it);
        last.ym = (last.ym * (last.words.length - 1) + ym) / last.words.length;
      } else {
        lines.push({ page: it.page, ym: ym, words: [it] });
      }
    }
    for (i = 0; i < lines.length; i++) {
      lines[i].words.sort(function (a, b) { return a.x - b.x; });
      lines[i].text = squash(lines[i].words.map(function (w) { return w.str; }).join(' '));
      lines[i].x0 = lines[i].words[0] ? lines[i].words[0].x : 0;
    }
    return lines.filter(function (ln) { return ln.text; });
  }

  function isNoise(text) {
    if (/^Flight Schedule Pro\b/i.test(text)) return true;
    if (/^Maintenance Status Report$/i.test(text)) return true;
    if (/^https?:\/\//i.test(text) || /\bPage\s+\d+\s+of\s+\d+\s*$/i.test(text)) return true;
    if (/^Patriot Pilot Academy\b/i.test(text) && /Report Created/i.test(text)) return false; // handled elsewhere
    if (/^Patriot Pilot Academy$/i.test(text)) return true;
    return false;
  }
  // An aircraft header is "N12345 <type> (<location> <operator>) - - - -". Older code only accepted ECP/CEW/DHN in the
  // parentheses, so a plane at any other FSP location (or a location named differently) was silently folded into
  // the plane above it. Now any parenthesized location works when the line looks like a header.
  var KNOWN_LOC_RE = /\((KECP|KCEW|KDHN|ECP|CEW|DHN)\b/i;
  function isAircraftHeader(text) {
    if (!/^N[A-Z0-9]{2,}\s+\S/.test(text) || /^for\s+/i.test(text)) return false;
    if (KNOWN_LOC_RE.test(text)) return true;
    if (!/^N[0-9][A-Z0-9]{0,5}\s/.test(text)) return false;
    // generic: ends with "(... )" optionally followed by the dash leader FSP prints after the header
    return /\([^()]{2,}\)\s*(?:-\s*){2,}$/.test(text) || /\([^()]*(Academy|Aviation|Flight|School|Airport|Regional|Field)[^()]*\)\s*$/i.test(text);
  }
  function parseHeader(text) {
    var m = text.match(/^(N[A-Z0-9]+)\s+(.+)$/);
    if (!m) return null;
    var tail = m[1], rest = m[2].replace(/(?:\s+-)+$/g, '').trim();
    var inactive = /\(inactive\)/i.test(rest);
    rest = rest.replace(/\s*\(inactive\)/ig, '').trim();
    var locM = rest.match(/\s*\((KECP|KCEW|KDHN|ECP|CEW|DHN)\b[^)]*\)\s*$/i), loc = '';
    if (locM) loc = locCode(locM[1]);
    else {
      // any other location: "(DTS Patriot Pilot Academy)", "(Dothan)", "(Crestview - PPA)"
      locM = rest.match(/\s*\(([^()]+)\)\s*$/);
      if (locM) {
        var inner = locM[1].trim(), byName = /dothan/i.test(inner) ? 'KDHN' : /crestview|bob sikes/i.test(inner) ? 'KCEW' : /panama city|beaches/i.test(inner) ? 'KECP' : '';
        var code = inner.match(/^(K?[A-Z0-9]{3,4})\b/);
        loc = byName || (code ? locCode(code[1]) : inner.replace(/\s*Patriot Pilot Academy\s*/i, '').trim() || inner);
      }
    }
    var type = locM ? rest.slice(0, locM.index).trim() : rest;
    return { tail: tail, type: type, locationCode: loc, inactive: inactive };
  }
  function parseMeterLine(text, meters) {
    METER_RE.lastIndex = 0;
    var m, found = false, key, map = {
      hobbs: 'hobbs', 'total time': 'totalTime', tach: 'tach', 'tach 2': 'tach2',
      engine: 'engine', 'engine 2': 'engine2', prop: 'prop', 'prop 2': 'prop2'
    };
    while ((m = METER_RE.exec(text))) {
      key = map[m[1].replace(/\s+/g, ' ').toLowerCase()];
      if (key) { meters[key] = num(m[2]); found = true; }
    }
    return found;
  }

  function midBounds(xs, fallback) {
    if (!xs || xs.length < 2) return fallback;
    var b = [0], i;
    for (i = 0; i < xs.length - 1; i++) b.push((xs[i] + xs[i + 1]) / 2);
    b.push(1e9);
    return b;
  }
  function colOf(x, bounds) {
    var i, col = 0;
    for (i = 0; i < bounds.length - 1; i++) if (x >= bounds[i]) col = i;
    return col;
  }
  function wordsInCols(line, bounds) {
    var buckets = [];
    var i, c;
    for (i = 0; i < bounds.length - 1; i++) buckets[i] = [];
    line.words.forEach(function (w) {
      c = colOf(w.x, bounds);
      if (!buckets[c]) buckets[c] = [];
      buckets[c].push(w.str);
    });
    return buckets.map(function (b) { return squash(b.join(' ')); });
  }

  // Reminder columns: Name, Date, Time, Cycles, Due (date/time/cycles + parentheticals)
  function reminderBoundsFrom(line) {
    var xs = {}, seen = {};
    line.words.forEach(function (w, i) {
      var t = w.str.toLowerCase(), n = line.words[i + 1] && line.words[i + 1].str.toLowerCase();
      if (t === 'name' && !seen.name) { xs.name = w.x; seen.name = 1; }
      else if (t === 'date' && !seen.date) { xs.date = w.x; seen.date = 1; }
      else if (t === 'time' && !seen.time) { xs.time = w.x; seen.time = 1; }
      else if (t === 'cycles' && !seen.cycles) { xs.cycles = w.x; seen.cycles = 1; }
      else if (t === 'due' && n === 'date' && !seen.due) { xs.due = w.x; seen.due = 1; }
    });
    var arr = [xs.name, xs.date, xs.time, xs.cycles, xs.due], fallback = [0, 115, 155, 205, 255, 1e9], i;
    if (arr.some(function (v) { return v == null; })) return fallback;
    for (i = 1; i < arr.length; i++) if (!(arr[i] > arr[i - 1] + 8)) return fallback;
    return midBounds(arr, fallback);
  }
  function squawkBoundsFrom(line) {
    var xs = { date: 42, gnd: 118, status: 184, desc: 285 };
    line.words.forEach(function (w) {
      var t = w.str.toLowerCase();
      if (t === 'date') xs.date = w.x;
      else if (t === 'groundable') xs.gnd = w.x;
      else if (t === 'status') xs.status = w.x;
      else if (t === 'description') xs.desc = w.x;
    });
    return midBounds([xs.date, xs.gnd, xs.status, xs.desc], [0, 115, 170, 270, 1e9]);
  }

  function parseDueBlob(text) {
    var out = { dueDate: '', dueInHours: null, dueInDays: null, expired: false, neverCompleted: false, raw: squash(text) };
    var s = out.raw;
    if (/\(Never Completed\)/i.test(s)) out.neverCompleted = true;
    var expH = s.match(/\(([\d.]+)\s*Hours?\s*Expired\)/i);
    if (expH) { out.expired = true; out.dueInHours = -num(expH[1]); }
    else if (/\(Expired\)/i.test(s)) out.expired = true;
    var due = s.match(/\(Due in ([\d.]+)\s*(hours?|hrs?|days?)\)/i);
    if (due) {
      var n = num(due[1]), unit = due[2].toLowerCase();
      if (unit.indexOf('day') === 0) out.dueInDays = n;
      else out.dueInHours = n;
    }
    var dm = s.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    if (dm) {
      var d = parseDate(dm[1]);
      if (d) out.dueDate = d;
    }
    return out;
  }

  function isDateToken(v) { return !!parseDate(squash(v)); }
  function isNumToken(v) { return num(v) != null && /[0-9]/.test(String(v)); }
  function absorbNameSpill(name, date, time, cycles) {
    function split(v, ok) {
      v = squash(v);
      if (!v) return { name: '', val: '' };
      if (ok(v)) return { name: '', val: v };
      return { name: v, val: '' };
    }
    var d = split(date, isDateToken), t = split(time, isNumToken), c = split(cycles, isNumToken);
    name = squash([name, d.name, t.name, c.name].filter(Boolean).join(' '));
    name = name.replace(/(\w)-\s+(\w)/g, '$1-$2');
    return { name: name, date: d.val, time: t.val, cycles: c.val };
  }
  function tidyName(n) { return squash(n).replace(/(\w)-\s+(\w)/g, '$1-$2'); }

  function startsReminder(name, hasValue) {
    name = squash(name);
    if (!name) return false;
    if (REMINDER_START.test(name)) return true;
    var first = name.split(/\s+/)[0].replace(/[()]/g, '');
    if (CONTINUATION_NAME.test(name) || CONTINUATION_NAME.test(first)) return false;
    if (hasValue && !/^[a-z]/.test(name) && !/^\(/.test(name)) return true;
    return false;
  }

  function emptyAc() {
    return { tail: '', type: '', locationCode: '', inactive: false, meters: {}, reminders: [], squawks: [], doubts: [] };
  }

  function parseItems(items, opts) {
    opts = opts || {};
    var warnings = [], reportCreated = '', operator = '';
    var lines = clusterLines(items, opts.ytol);
    var aircraft = [], cur = null, state = 'seek';
    var rBounds = reminderBoundsFrom({ words: [] }), sBounds = squawkBoundsFrom({ words: [] });
    var remCur = null, sqCur = null;

    function finishReminder() { if (remCur) { cur.reminders.push(finalizeReminder(remCur)); remCur = null; } }
    function finishSquawk() { if (sqCur) { cur.squawks.push(finalizeSquawk(sqCur)); sqCur = null; } }
    function finishAc() {
      finishReminder(); finishSquawk();
      if (cur && cur.tail) aircraft.push(cur);
      cur = null; state = 'seek';
    }

    lines.forEach(function (ln) {
      var t = ln.text;
      if (/Report Created\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i.test(t)) {
        var rc = t.match(/Report Created\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
        reportCreated = parseDate(rc[1]) || reportCreated;
        var op = t.match(/^(.*?)(?:\s+Report Created)/i);
        if (op && squash(op[1]) && !/^Maintenance/i.test(op[1])) operator = squash(op[1]);
      }
      if (isNoise(t)) return;
      if (/^#+$/.test(t) || t === '#') return;
      if (/^Patriot Pilot Academy$/i.test(t)) { operator = operator || 'Patriot Pilot Academy'; return; }

      if (isAircraftHeader(t)) {
        finishAc();
        cur = emptyAc();
        var h = parseHeader(t);
        cur.tail = h.tail; cur.type = h.type; cur.locationCode = h.locationCode; cur.inactive = h.inactive;
        state = 'aircraft';
        return;
      }
      if (!cur) return;

      if (/^Maintenance\b/i.test(t) && /Last Completed/i.test(t)) return;
      if (/^Reminders$/i.test(t) || /^for\s+N[A-Z0-9]+$/i.test(t)) return;

      if (/^Name\b/.test(t) && /\bDate\b/.test(t) && /\bTime\b/.test(t)) {
        finishReminder(); finishSquawk();
        rBounds = reminderBoundsFrom(ln);
        state = 'reminders';
        return;
      }
      if (/^Squawks for\s+N[A-Z0-9]+/i.test(t)) {
        finishReminder(); finishSquawk();
        state = 'squawks-head';
        return;
      }
      if (state === 'squawks-head' && /^Date\b/.test(t) && /Groundable/i.test(t)) {
        sBounds = squawkBoundsFrom(ln);
        state = 'squawks';
        return;
      }
      if (/^No maintenance reminders meet the selected criteria/i.test(t)) {
        finishReminder();
        state = 'aircraft';
        return;
      }
      if (/^No squawks meet the selected criteria/i.test(t)) {
        finishSquawk();
        state = 'aircraft';
        return;
      }

      if (parseMeterLine(t, cur.meters)) return;

      if (state === 'reminders') {
        var rc = wordsInCols(ln, rBounds);
        var due = rc.slice(4).join(' ');
        var sp = absorbNameSpill(rc[0] || '', rc[1] || '', rc[2] || '', rc[3] || '');
        var name = sp.name, lastDate = sp.date, lastTime = sp.time, lastCycles = sp.cycles;
        var hasVal = !!(lastDate || lastTime || lastCycles || /\d/.test(due) || /\(Expired\)|\(Never|\(Due/i.test(due));
        if (startsReminder(name, hasVal)) {
          finishReminder();
          remCur = { name: name, lastDate: lastDate, lastTime: lastTime, lastCycles: lastCycles, dueParts: [due] };
        } else if (remCur) {
          if (name) remCur.name = tidyName(remCur.name + ' ' + name);
          if (lastDate && !remCur.lastDate) remCur.lastDate = lastDate;
          if (lastTime && !remCur.lastTime) remCur.lastTime = lastTime;
          if (lastCycles && !remCur.lastCycles) remCur.lastCycles = lastCycles;
          if (due) remCur.dueParts.push(due);
        } else if (t && !/^Reference/i.test(t)) {
          warnings.push(cur.tail + ': leftover reminder line "' + t + '"');
        }
        return;
      }

      if (state === 'squawks') {
        var sc = wordsInCols(ln, sBounds);
        var d = sc[0] || '', g = sc[1] || '', stt = sc[2] || '', desc = sc[3] || '';
        if (/^\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(d)) {
          finishSquawk();
          sqCur = { datePart: d, groundable: g, status: stt, desc: desc };
        } else if (sqCur) {
          if (d) sqCur.datePart += ' ' + d;
          if (g && !sqCur.groundable) sqCur.groundable = g;
          if (stt) sqCur.status += ' ' + stt;
          if (desc) sqCur.desc += ' ' + desc;
        }
        return;
      }
    });
    finishAc();

    aircraft.forEach(function (a) { annotateAircraft(a, reportCreated, warnings); });
    return { reportCreated: reportCreated, operator: operator || 'Patriot Pilot Academy', aircraft: aircraft, warnings: warnings };
  }

  function finalizeReminder(r) {
    var due = parseDueBlob((r.dueParts || []).join(' '));
    var lastDate = parseDate(squash(r.lastDate)) || '';
    if (r.lastDate && squash(r.lastDate) && lastDate === '') lastDate = '';
    return {
      name: tidyName(r.name),
      lastDate: lastDate || '',
      lastTime: num(r.lastTime),
      lastCycles: num(r.lastCycles),
      dueDate: due.dueDate,
      dueInHours: due.dueInHours,
      dueInDays: due.dueInDays,
      expired: due.expired,
      neverCompleted: due.neverCompleted,
      rawDue: due.raw
    };
  }
  function finalizeSquawk(s) {
    var raw = squash(s.datePart);
    var dm = raw.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:-\s*)?(.*)$/);
    var date = dm ? parseDate(dm[1]) : '';
    var reporter = dm ? squash(dm[2]) : raw;
    reporter = reporter.replace(/\s*\((Inactive|Deleted)\)/ig, '').replace(/^-\s*/, '').trim();
    var status = squash(s.status), desc0 = squash(s.desc);
    var spill = /^(Issue|Maintenance|by|to|Reproduce|Review|Unable|\(Open\)|\(Closed\))\b/i;
    var mspill;
    while ((mspill = desc0.match(/^(\((?:Open|Closed)\)|[A-Za-z-]+)\s*/)) && spill.test(mspill[1])) {
      status = squash(status + ' ' + mspill[1]);
      desc0 = squash(desc0.slice(mspill[0].length));
    }
    s.desc = desc0;
    var tags = raw + ' ' + status;
    var deleted = /\(Deleted\)/i.test(tags) || /\(Deleted\)/i.test(s.datePart || '');
    var inactive = /\(Inactive\)/i.test(tags) || /\(Inactive\)/i.test(s.datePart || '');
    // tags on wrapped name lines already merged into datePart
    deleted = deleted || /\(Deleted\)/i.test(s.datePart);
    var tagM = (status + ' ' + squash(s.desc)).match(/\((Open|Closed)\)/i);
    if (tagM) {
      var tag = tagM[1][0].toUpperCase() + tagM[1].slice(1).toLowerCase();
      status = squash(status.replace(/\((Open|Closed)\)/ig, ''));
      s.desc = squash(s.desc.replace(/\((Open|Closed)\)/ig, ''));
      status = squash(status + ' (' + tag + ')');
    }
    var open = /\(Open\)/i.test(status) || (/^Awaiting Review\b/i.test(status) && !/Closed/i.test(status));
    if (/\(Closed\)/i.test(status) || /\bClosed\b/i.test(status)) open = false;
    var g = squash(s.groundable).toLowerCase();
    return {
      date: date,
      reportedBy: reporter,
      groundable: g === 'yes' || g === 'y' || g === 'true',
      status: status,
      open: open,
      description: squash(s.desc),
      deleted: deleted,
      inactive: inactive
    };
  }

  function classifyReminder(name) {
    var n = name.toLowerCase();
    if (/^100\s*(hour|hr)\b/.test(n) && /inspect/.test(n) || /^100\s*(hour|hr)$/i.test(name) || /^100\s*(hour|hr)\s+inspection$/i.test(n)) return 'hundred';
    if (/^100\s*(hour|hr)\b/.test(n)) return 'hundred';
    if (/^annual\b/.test(n)) return 'annual';
    if (/altimeter\/static|pitot\/static|pitot-static|altimeter\b/.test(n)) return 'pitot';
    if (/^transponder\b/.test(n)) return 'xpdr';
    if (/^elt\s+battery\b/.test(n)) return 'eltBattery';
    if (/^elt\b/.test(n)) return 'elt';
    // VOR checks are no longer tracked, and GPS / nav database updates are ignored (Chad, 11/16/2026).
    if (/\bvor\b/.test(n) && !/gps\s*\/?\s*nav/i.test(n)) return 'vor';
    if (/\bgps\b|nav\s*data|navigation\s*data|\bnav\s*db\b|\bdatabase\b|\bnavdata\b|jeppesen/i.test(name)) return 'gps';
    if (/^ad\s+/i.test(name)) return 'ad';
    return 'extra';
  }
  function adParts(name) {
    var m = name.match(/^AD\s+([0-9A-Z-]+)\s*(?:\((.*)\))?$/i);
    if (!m) return { number: '', desc: name };
    return { number: m[1], desc: squash(m[2] || '') };
  }
  function slug(name) {
    return squash(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
  }
  function inferredInterval(last, remaining, current) {
    if (last == null || remaining == null || current == null) return null;
    return Math.round(((current + remaining) - last) * 10) / 10;
  }
  function isNiceInterval(iv) {
    if (iv == null || iv < 10) return false;
    return Math.abs(iv - Math.round(iv / 25) * 25) < 0.2;
  }
  function pickMeter(meters, last, remaining) {
    var tach = meters.tach, hobbs = meters.hobbs;
    function err(cur) {
      if (cur == null || last == null || remaining == null) return Infinity;
      return Math.abs((cur + remaining) - last - 100);
    }
    var et = err(tach), eh = err(hobbs);
    if (et < Infinity || eh < Infinity) {
      if (et <= eh) return { meter: 'tach', err: et };
      return { meter: 'hobbs', err: eh };
    }
    if (tach != null) return { meter: 'tach', err: null };
    if (hobbs != null) return { meter: 'hobbs', err: null };
    return { meter: 'hobbs', err: null };
  }

  function annotateAircraft(a, reportCreated, warnings) {
    var hundred = a.reminders.filter(function (r) { return classifyReminder(r.name) === 'hundred'; })[0];
    var pick = { meter: a.meters.tach != null ? 'tach' : 'hobbs', err: null };
    if (hundred) pick = pickMeter(a.meters, hundred.lastTime, hundred.dueInHours);
    a.meter = pick.meter;
    if (hundred && pick.err != null && pick.err > 0.15) {
      var msg = a.tail + ': 100-hr interval vs ' + pick.meter + ' is off by ' + pick.err.toFixed(2) + ' hr (last ' + hundred.lastTime + ', due in ' + hundred.dueInHours + ', ' + pick.meter + ' ' + a.meters[pick.meter] + ')';
      a.doubts.push(msg); warnings.push(msg);
    }
    if (hundred && hundred.dueInHours != null && a.meters[pick.meter] != null) {
      a.hoursTo100 = Math.round(hundred.dueInHours * 10) / 10;
    } else a.hoursTo100 = null;
    if (a.meters.totalTime != null && a.meters.hobbs != null && Math.abs(a.meters.totalTime - a.meters.hobbs) > 0.05) {
      a.doubts.push(a.tail + ': FSP Total Time (' + a.meters.totalTime + ') does not match Hobbs (' + a.meters.hobbs + '); Hobbs/Tach labels were used and Total Time was ignored');
    }
    if (a.meters.tach2 != null && a.meters.tach != null && Math.abs(a.meters.tach2 - a.meters.tach) > 0.05) {
      a.doubts.push(a.tail + ': Tach 2 (' + a.meters.tach2 + ') differs from Tach (' + a.meters.tach + '); primary Tach was used');
    }
    a.reportDate = reportCreated || '';
  }

  function toBoardFields(a) {
    var dates = {}, ads = [], doubts = (a.doubts || []).slice(), skipped = [];
    var last100 = null, statusNote = a.inactive ? 'Inactive' : '';
    var overdue = [];
    a.reminders.forEach(function (r) {
      var kind = classifyReminder(r.name);
      if (kind === 'hundred') { last100 = r.lastTime; if (r.expired) overdue.push(r.name); return; }
      if (kind === 'annual' && r.lastDate) dates.annual = r.lastDate;
      else if (kind === 'vor' && r.lastDate) dates.vor = r.lastDate; // VOR is back on the card (Kyle, 11/16/2026)
      else if (kind === 'vor' || kind === 'gps') { skipped.push(r.name); return; }
      else if (kind === 'pitot' && r.lastDate) dates.pitot = r.lastDate;
      else if (kind === 'xpdr' && r.lastDate) dates.xpdr = r.lastDate;
      else if (kind === 'elt' && r.lastDate) dates.elt = r.lastDate;
      else if (kind === 'eltBattery' && r.dueDate) dates.eltBattery = r.dueDate;
      else if (kind === 'ad' || kind === 'extra') {
        var p = kind === 'ad' ? adParts(r.name) : { number: '', desc: r.name };
        var ad = {
          key: slug((p.number ? 'ad-' + p.number + ' ' : '') + (p.desc || r.name)),
          number: p.number, desc: p.desc || r.name,
          intervalMonths: null, intervalDays: null, intervalHours: null,
          lastDoneDate: r.lastDate || '', lastDoneHours: r.lastTime,
          nextDueDate: r.dueDate || '', nextDueHours: null,
          nonGrounding: /non\s*-?\s*grounding/i.test(r.name || '')
        };
        if (ad.nonGrounding) ad.desc = String(ad.desc || '').replace(/\s*\(?\s*non\s*-?\s*grounding\s*\)?/ig, '').trim() || ad.desc;
        var cur = a.meters[a.meter];
        if (r.lastTime != null && r.dueInHours != null && cur != null) {
          var iv = inferredInterval(r.lastTime, r.dueInHours, cur);
          if (iv != null && iv > 0 && isNiceInterval(iv)) ad.intervalHours = iv;
          else {
            ad.nextDueHours = Math.round((cur + r.dueInHours) * 10) / 10;
            doubts.push(a.tail + ': "' + r.name + '" last time ' + r.lastTime + ' does not yield a clean interval on ' + a.meter + ' ' + cur + ' (due in ' + r.dueInHours + ' hours) — stored the report\'s next-due hours only');
          }
        } else if (r.dueInHours != null && cur != null && r.lastTime == null) {
          ad.nextDueHours = Math.round((cur + r.dueInHours) * 10) / 10;
        }
        ads.push(ad);
      }
      if (r.expired) overdue.push(r.name);
    });
    var openSquawks = a.squawks.filter(function (s) { return s.open && !s.deleted; });
    return {
      tail: a.tail,
      type: a.type,
      location: a.locationCode,
      meter: a.meter,
      current_tach: a.meters.tach,
      tach_date: a.meters.tach != null ? a.reportDate : '',
      current_hobbs: a.meters.hobbs,
      hobbs_date: a.meters.hobbs != null ? a.reportDate : '',
      last_100hr_at: last100,
      ifr: '',
      for_hire: '',
      annual_done: dates.annual || '',
      vor_done: dates.vor || '',
      pitot_static_done: dates.pitot || '',
      transponder_done: dates.xpdr || '',
      elt_done: dates.elt || '',
      elt_battery_expires: dates.eltBattery || '',
      status_note: statusNote,
      expected_back: '',
      fsp_aircraft_id: '',
      dates: dates,
      ads: ads,
      skippedReminders: skipped,
      openSquawks: openSquawks,
      hoursTo100: a.hoursTo100,
      overdueNames: overdue,
      inactive: a.inactive,
      doubts: doubts,
      meters: a.meters,
      reminders: a.reminders,
      squawks: a.squawks
    };
  }

  function csvCell(v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  var CSV_COLS = ['tail', 'type', 'location', 'meter', 'current_tach', 'tach_date', 'current_hobbs', 'hobbs_date', 'current_hours', 'hours_date', 'ifr', 'for_hire', 'annual_done', 'last_100hr_at', 'pitot_static_done', 'transponder_done', 'elt_done', 'elt_battery_expires', 'status_note', 'expected_back', 'fsp_aircraft_id'];
  function toCsv(parsed) {
    var rows = [CSV_COLS.join(',')];
    (parsed.aircraft || []).forEach(function (a) {
      var f = toBoardFields(a);
      var hours = f.meter === 'hobbs' ? f.current_hobbs : f.current_tach;
      var hoursDate = f.meter === 'hobbs' ? f.hobbs_date : f.tach_date;
      rows.push([f.tail, f.type, f.location, f.meter, f.current_tach, f.tach_date, f.current_hobbs, f.hobbs_date, hours, hoursDate, f.ifr, f.for_hire, f.annual_done, f.last_100hr_at, f.pitot_static_done, f.transponder_done, f.elt_done, f.elt_battery_expires, f.status_note, f.expected_back, f.fsp_aircraft_id].map(csvCell).join(','));
    });
    return rows.join('\n') + '\n';
  }

  function extractPdfItems(pdf, pdfjsLib) {
    var Util = (pdfjsLib && pdfjsLib.Util) || (typeof pdfjsLib !== 'undefined' && pdfjsLib.Util);
    var pages = [];
    function one(p) {
      return pdf.getPage(p).then(function (page) {
        var viewport = page.getViewport({ scale: 1 });
        return page.getTextContent().then(function (tc) {
          var items = [];
          (tc.items || []).forEach(function (it) {
            var str = normGlyphs(it.str || '');
            if (!String(str).trim()) return;
            var tr = it.transform || [1, 0, 0, 1, 0, 0];
            var x, y;
            if (Util && Util.transform) {
              var m = Util.transform(viewport.transform, tr);
              x = m[4]; y = m[5];
            } else {
              // fallback: PDF space (y up) → top-down
              x = tr[4]; y = viewport.height - tr[5];
            }
            items.push({ str: str, x: x, y: y, page: p });
          });
          return items;
        });
      });
    }
    var i, chain = Promise.resolve([]);
    for (i = 1; i <= pdf.numPages; i++) {
      (function (p) {
        chain = chain.then(function (acc) { return one(p).then(function (its) { return acc.concat(its); }); });
      })(i);
    }
    return chain;
  }

  function parsePdfDocument(pdf, pdfjsLib) {
    return extractPdfItems(pdf, pdfjsLib).then(function (items) { return parseItems(items); });
  }

  function loadPdfjs() {
    if (typeof window !== 'undefined' && window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (typeof require === 'function') {
      try { return Promise.resolve(require('pdfjs-dist/legacy/build/pdf.js')); } catch (e1) {
        try { return Promise.resolve(require('pdfjs-dist')); } catch (e2) { return Promise.reject(e2); }
      }
    }
    return import(PDFJS_BASE + 'pdf.min.mjs').then(function (lib) {
      var L = lib && (lib.default || lib);
      if (L.GlobalWorkerOptions) L.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.mjs';
      if (typeof window !== 'undefined') window.pdfjsLib = L;
      return L;
    });
  }

  function parsePdfBuffer(buf, pdfjsLib) {
    var data;
    if (buf instanceof ArrayBuffer) data = new Uint8Array(buf);
    else data = new Uint8Array(buf); // copy so Node's Buffer (a Uint8Array subclass) is accepted by pdf.js
    return Promise.resolve(pdfjsLib.getDocument({ data: data, disableWorker: typeof window === 'undefined' }).promise)
      .then(function (pdf) { return parsePdfDocument(pdf, pdfjsLib); });
  }

  return {
    parseItems: parseItems,
    parsePdfBuffer: parsePdfBuffer,
    parsePdfDocument: parsePdfDocument,
    loadPdfjs: loadPdfjs,
    toBoardFields: toBoardFields,
    toCsv: toCsv,
    classifyReminder: classifyReminder,
    locCode: locCode,
    parseDate: parseDate,
    PDFJS_VER: PDFJS_VER
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PPAFspImport;
