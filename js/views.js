/* PPA Maintenance Board — squawk form, editor, settings, CSV. */
var PPAViews = (function () {
  var U = window.PPAUI, S = PPAStatus, st = Store.state, app = document.getElementById('app');
  var esc = U.esc, $ = U.$, $$ = U.$$, toast = U.toast, remember = U.remember;
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function today() { return S.todayStr(); }
  function reading(a, which) { return S.meterReading(a, which); }
  function updated(a, which) { return S.meterUpdated(a, which); }
  function hrsVal(a, which) { var v = reading(a, which); return v == null ? '' : v; }
  function meterName(m) { return m === 'hobbs' ? 'Hobbs' : 'Tach'; }
  function opt(v, label, sel) { return '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(label) + '</option>'; }
  function locOptions(sel, blank) { return (blank ? opt('', blank, sel) : '') + (st.settings.locations || []).map(function (l) { return opt(l.id, l.code + ' — ' + l.name, sel); }).join(''); }
  function typeOptions(sel) { var t = (st.settings.types || []).slice(); if (sel && t.indexOf(sel) < 0) t.unshift(sel); return t.map(function (x) { return opt(x, x, sel); }).join('') + opt('__new', '+ Add a new type…', ''); }
  function byId(id) { return st.aircraft.filter(function (a) { return a.id === id; })[0]; }
  function who() { return st.name || (st.user && st.user.email) || 'unknown'; }
  function logEntry(a, what) { a.log = a.log || []; a.log.unshift({ at: new Date().toISOString(), by: who(), what: what }); a.log = a.log.slice(0, 60); }
  // Away / parked aircraft live in settings.awayTails (default N97459). Restore removes the tail.
  function setAway(tail, on) {
    var s = clone(st.settings), l = S.awayTails(st.settings), t = S.normTail(tail);
    l = l.filter(function (x) { return x !== t; }); if (on) l.push(t);
    s.awayTails = l;
    return Store.saveSettings(s).then(function () { toast(on ? tail + ' marked away — hidden from the board' : tail + ' restored to the board'); U.render(true); }).catch(function (e) { toast(e.message, true); });
  }
  var SEV = [
    { v: 'grounding', c: 's-over', t: '⛔ Unsafe — GROUND the plane', d: 'Plane shows GROUNDED until a mechanic clears it.' },
    { v: 'open', c: 's-due', t: '⚑ Needs fixing — still safe to fly', d: 'Shows as an open squawk.' },
    { v: 'info', c: 's-na', t: 'ℹ️ Minor / cosmetic', d: 'For the mechanic\'s list.' }
  ];

  // ================= POST-FLIGHT + SQUAWK FORM =================
  var sqDone = null, sqDraft = null;
  var QTS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
  function emptyDraft() {
    return { loc: remember('sqLoc') || '', ac: remember('sqAc') || '', oil: 'no', qts: 1,
      tachStart: '', tachEnd: '', hobbsStart: '', hobbsEnd: '', txt: '', sev: 'open', name: remember('sqName') || '', student: '', acFilled: '',
      snaps: { tach: null, hobbs: null } };
  }
  function pullForm() {
    if (!sqDraft) sqDraft = emptyDraft();
    var oilYes = $('#oil-yes');
    if (oilYes) sqDraft.oil = oilYes.classList.contains('on') ? 'yes' : 'no';
    if ($('#oilqts')) sqDraft.qts = Number($('#oilqts').value) || sqDraft.qts;
    if ($('#ts')) sqDraft.tachStart = $('#ts').value;
    if ($('#te')) sqDraft.tachEnd = $('#te').value;
    if ($('#hs')) sqDraft.hobbsStart = $('#hs').value;
    if ($('#he')) sqDraft.hobbsEnd = $('#he').value;
    if ($('#txt')) sqDraft.txt = $('#txt').value;
    var sev = $('input[name=sev]:checked'); if (sev) sqDraft.sev = sev.value;
    if ($('#nm')) sqDraft.name = $('#nm').value;
    if ($('#stu')) sqDraft.student = $('#stu').value;
    var b = $('.acpick button.on'); if (b) sqDraft.ac = b.dataset.id;
    return sqDraft;
  }
  function parseHr(v) {
    v = String(v == null ? '' : v).trim();
    if (v === '') return null;
    var n = Number(v);
    return isNaN(n) ? NaN : n;
  }
  function updTimes() {
    function pair(sEl, eEl, out) {
      if (!out) return;
      var a = parseHr(sEl && sEl.value), b = parseHr(eEl && eEl.value);
      if (a == null || b == null) { out.textContent = ''; out.className = 'ftime'; return; }
      if (isNaN(a) || isNaN(b)) { out.textContent = 'Enter a number'; out.className = 'ftime bad'; return; }
      var d = Math.round((b - a) * 10) / 10;
      if (b < a) { out.textContent = 'End is earlier than start'; out.className = 'ftime bad'; }
      else if (d > 10) { out.textContent = 'Flight time ' + d.toFixed(1) + ' hrs — check this, it is over 10 hours'; out.className = 'ftime warn'; }
      else { out.textContent = 'Flight time ' + d.toFixed(1) + ' hrs'; out.className = 'ftime'; }
    }
    pair($('#ts'), $('#te'), $('#tflight'));
    pair($('#hs'), $('#he'), $('#hflight'));
  }
  function fillStarts(id, force) {
    var a = byId(id); if (!a || !sqDraft) return;
    if (force || sqDraft.acFilled !== id) {
      var t = S.meterReading(a, 'tach'), h = S.meterReading(a, 'hobbs');
      sqDraft.tachStart = t == null ? '' : t;
      sqDraft.hobbsStart = h == null ? '' : h;
      sqDraft.tachEnd = '';
      sqDraft.hobbsEnd = '';
      sqDraft.snaps = { tach: null, hobbs: null };
      sqDraft.acFilled = id;
    }
    if ($('#ts')) { $('#ts').value = sqDraft.tachStart; $('#te').value = sqDraft.tachEnd; }
    if ($('#hs')) { $('#hs').value = sqDraft.hobbsStart; $('#he').value = sqDraft.hobbsEnd; }
    if ($('#tachwrap')) $('#tachwrap').classList.toggle('hide', !S.hasTach(a));
    var hint = $('#curhrs');
    if (hint) {
      var bits = [];
      if (S.hasTach(a)) bits.push('Tach ' + S.hoursLabel(S.meterReading(a, 'tach')));
      bits.push('Hobbs ' + S.hoursLabel(S.meterReading(a, 'hobbs')));
      hint.textContent = 'Board now shows ' + bits.join(' · ') + '. Start is filled in for you — enter or snap the ending times.';
    }
    updTimes();
  }
  function rulesDeniedMsg() {
    return 'The post-flight report could not be saved because the new Firestore rules have not been published yet. In the Firebase console open Firestore → Rules, paste the contents of firebase/firestore.rules, and click Publish. Then submit the report again. Any squawk you included may already be on the board.';
  }
  function reportDay(r) {
    if (!r || !r.createdAt) return '';
    var d = new Date(r.createdAt);
    if (isNaN(d.getTime())) return String(r.createdAt).slice(0, 10);
    return S.todayStr(d);
  }
  function reportLine(r) {
    var bits = [], dt = r.createdAt ? S.niceDate(reportDay(r)) : '';
    if (r.tachEnd != null) bits.push('Tach ' + S.hoursLabel(r.tachStart) + ' → ' + S.hoursLabel(r.tachEnd));
    if (r.hobbsEnd != null) bits.push('Hobbs ' + S.hoursLabel(r.hobbsStart) + ' → ' + S.hoursLabel(r.hobbsEnd));
    if (r.oilAdded) bits.push('+' + r.oilQts + ' qt oil');
    else bits.push('no oil added');
    var who = esc(r.reportedBy || r.reporterEmail || 'CFI') + (r.student ? ' / student ' + esc(r.student) : '');
    return (dt ? dt + ' · ' : '') + who + (bits.length ? ' · ' + bits.join(' · ') : '');
  }
  function oilCell(a) {
    var o = S.oilSummary(st.flightReports, a, st.settings, st.aircraft);
    var rate = o.rate ? (o.rate.rate + ' qt / 10 ' + (o.rate.meter === 'hobbs' ? 'Hobbs' : 'Tach') + ' hrs') : '';
    var fsp = o.fspAt
      ? (o.sinceFsp + ' qt since FSP')
      : (o.allTime ? o.allTime + ' qt all time' : '');
    return '<div class="oilcol" title="From CFI post-flight reports"><span>Oil (CFI reports)</span><b>' + (o.last30 ? o.last30 + ' qt' : 'none') + ' / 30d</b>' +
      (fsp ? '<span>' + esc(fsp) + '</span>' : '') + (rate ? '<span>' + esc(rate) + '</span>' : '') + '</div>';
  }
  function oilDetail(a) {
    var o = S.oilSummary(st.flightReports, a, st.settings, st.aircraft);
    var fspDate = o.fspAt ? S.niceDate(String(o.fspAt).slice(0, 10)) : '';
    var rate = o.rate
      ? (o.rate.rate + ' qt per 10 ' + (o.rate.meter === 'hobbs' ? 'Hobbs' : 'Tach') + ' hrs (last 30 days, ' + o.rate.hours + ' hrs in CFI reports)')
      : 'Not enough CFI-reported hours in the last 30 days to compute a rate';
    return '<div class="oil-detail"><p class="sub" style="color:var(--mute)">Oil totals below are from CFI post-flight reports, not Flight Schedule Pro.</p>' +
      '<div class="kv" style="grid-template-columns:auto 1fr"><span>Last 30 days</span><b>' + (o.last30 ? o.last30 + ' qt' : 'none') + '</b>' +
      (o.fspAt ? '<span>Since last FSP import' + (fspDate ? ' (' + esc(fspDate) + ')' : '') + '</span><b>' + (o.sinceFsp ? o.sinceFsp + ' qt' : 'none') + '</b>' : '') +
      '<span>All time (on this board)</span><b>' + (o.allTime ? o.allTime + ' qt' : 'none') + '</b>' +
      '<span>Rate</span><b>' + esc(rate) + '</b></div></div>';
  }

  function squawk() {
    if (st.mode === 'live' && !Store.can('squawk')) { if (U.needRole('squawk', '#squawk')) return; }
    if (!sqDraft) sqDraft = emptyDraft();
    if (sqDone) {
      var a0 = byId(sqDone.aircraftId), e0 = a0 ? S.evaluate(a0, st.settings, st.squawks) : null;
      app.innerHTML = U.topbar('Report sent') + '<div class="wrap" style="max-width:640px">' + U.demoBanner() +
        (sqDone.reportError ? '<div class="banner red">' + esc(sqDone.reportError) + '</div>' : '') +
        (sqDone.sheetError ? '<div class="banner">' + esc(sqDone.sheetError) + '</div>' : '') +
        '<div class="card"><h2>' + (sqDone.reportError && !sqDone.text ? 'Report not saved' : '✓ Recorded for ' + esc(sqDone.tail)) + '</h2>' +
        (sqDone.report && !sqDone.reportError ? '<p>' + reportLine(sqDone.report) + '</p>' : '') +
        (sqDone.report && !sqDone.reportError ? '<p class="sub" style="color:var(--mute)">' + (Store.preview ? '🧪 TEST PREVIEW — this report was NOT saved to the live board and NOT sent to the Flight Log Sheet.' : sqDone.sheetSkipped ? 'Saved to the flight log on the board. Connect a billing Sheet in Settings to send rows there automatically.' : (sqDone.sheetError ? 'The report is saved on the board. An editor can resend it to the billing Sheet from Settings.' : 'Saved to the flight log. If the billing Sheet is connected, this row was also sent (an editor can resend it from Settings if it does not show up).')) + '</p>' : '') +
        (sqDone.text ? '<p>Squawk: "' + esc(sqDone.text) + '"' + (e0 ? ' — the board now shows <span class="ostat s-' + e0.overall + '">' + U.LABEL[e0.overall] + '</span>' : '') + '</p>' : '<p>No squawk filed.</p>') +
        '<button class="btn pri big" id="again">Submit another</button><br><br><a class="btn big ghost" href="#board">See fleet status</a></div></div>';
      $('#again').onclick = function () { sqDone = null; sqDraft = emptyDraft(); U.render(true); }; return;
    }
    var d = sqDraft;
    var locF = d.loc || '', pick = d.ac || '', sev = d.sev || 'open';
    var ev = U.evalAll();
    var list = S.sortFleet(U.active().filter(function (a) { return !locF || a.location === locF; }), ev, st.settings, { groundedLast: false });
    var picked = pick ? byId(pick) : null;
    var qtsOpts = QTS.map(function (q) { return opt(q, q + ' quart' + (q === 1 ? '' : 's'), d.qts); }).join('');
    var showTach = !picked || S.hasTach(picked);
    var curHint = picked
      ? 'Board now shows ' + (S.hasTach(picked) ? 'Tach ' + S.hoursLabel(S.meterReading(picked, 'tach')) + ' · ' : '') + 'Hobbs ' + S.hoursLabel(S.meterReading(picked, 'hobbs')) + '. Start is filled in for you — enter or snap the ending times.'
      : 'Pick an airplane and the starting Tach and Hobbs will fill in from the board.';
    if (picked && d.acFilled !== pick) fillStarts(pick, true);
    function snapBits(kind) {
      var snap = d.snaps && d.snaps[kind];
      var cls = snap && !snap.confirmed ? ' snapfill' : (snap && snap.confirmed ? ' snapok' : '');
      var warn = snap && snap.warning ? '<div class="ftime warn">' + esc(snap.warning) + '</div>' : '';
      var conf = snap && !snap.confirmed ? '<div class="row" style="margin-top:6px"><button type="button" class="btn ok sm" data-confirm-snap="' + kind + '">Confirm reading</button><span class="sub" style="color:var(--mute)">Check the number (edit if needed) before you submit.</span></div>' : (snap && snap.confirmed ? '<div class="sub" style="color:var(--ok);margin-top:4px">Reading confirmed</div>' : '');
      return { cls: cls, warn: warn, conf: conf };
    }
    var tSnap = snapBits('tach'), hSnap = snapBits('hobbs');
    app.innerHTML = U.topbar('Post-flight report', 'Replaces the paper log in the aircraft book') + '<div class="wrap" style="max-width:760px">' + U.demoBanner() +
      '<div class="card"><h2>1 · Which airplane?</h2><div class="chips" id="sl"><button type="button" data-l="" class="' + (!locF ? 'on' : '') + '">All</button>' + (st.settings.locations || []).map(function (l) { return '<button type="button" data-l="' + l.id + '" class="' + (locF === l.id ? 'on' : '') + '">' + esc(l.code) + '</button>'; }).join('') + '</div>' +
      '<div class="acpick">' + list.map(function (a) { return '<button type="button" data-id="' + a.id + '" class="s-' + ev[a.id].overall + (pick === a.id ? ' on' : '') + '"><b>' + esc(a.tail) + '</b><span>' + esc(a.type) + ' · ' + U.locTag(a.location, 'loc inl') + '</span></button>'; }).join('') + '</div></div>' +

      '<div class="card"><h2>2 · Oil added?</h2><div class="oilpick"><button type="button" id="oil-no" class="' + (d.oil !== 'yes' ? 'on' : '') + '">No</button><button type="button" id="oil-yes" class="yes ' + (d.oil === 'yes' ? 'on' : '') + '">Yes</button></div>' +
      '<div id="qtswrap" class="' + (d.oil === 'yes' ? '' : 'hide') + '"><label class="f">How many quarts?<select id="oilqts">' + qtsOpts + '</select></label></div></div>' +

      '<div class="card"><h2>3 · Tach and Hobbs</h2><p class="sub" id="curhrs" style="color:var(--mute)">' + esc(curHint) + '</p><p class="sub" style="color:var(--mute)">These times go to the flight log for billing. Flight Schedule Pro stays the official record, and they never change the hours on the board.</p>' +
      '<div class="meters">' +
      '<div id="tachwrap" class="' + (showTach ? '' : 'hide') + '"><div class="row"><label class="f">Start Tach<input type="number" step="0.1" inputmode="decimal" id="ts" value="' + esc(d.tachStart) + '"></label>' +
      '<label class="f">End Tach<input type="number" step="0.1" inputmode="decimal" id="te" class="' + tSnap.cls.trim() + '" value="' + esc(d.tachEnd) + '"></label></div>' +
      '<div class="row" style="margin-top:6px"><button type="button" class="btn sm" id="snaptach">📷 Snap meter</button><input type="file" id="snaptachfile" accept="image/*" class="hide"></div>' +
      '<div class="ftime" id="tflight"></div>' + tSnap.warn + tSnap.conf + '</div>' +
      '<div><div class="row"><label class="f">Start Hobbs<input type="number" step="0.1" inputmode="decimal" id="hs" value="' + esc(d.hobbsStart) + '"></label>' +
      '<label class="f">End Hobbs<input type="number" step="0.1" inputmode="decimal" id="he" class="' + hSnap.cls.trim() + '" value="' + esc(d.hobbsEnd) + '"></label></div>' +
      '<div class="row" style="margin-top:6px"><button type="button" class="btn sm" id="snaphobbs">📷 Snap meter</button><input type="file" id="snaphobbsfile" accept="image/*" class="hide"></div>' +
      '<div class="ftime" id="hflight"></div>' + hSnap.warn + hSnap.conf + '</div>' +
      '</div></div>' +

      '<div class="card"><h2>4 · Squawk? <span class="sub" style="font-weight:600;color:var(--mute)">optional — leave blank if nothing is wrong</span></h2><div class="chips" id="pre">' + (st.settings.squawkPresets || []).map(function (p) { return '<button type="button" data-p="' + esc(p) + '">' + esc(p) + '</button>'; }).join('') + '</div>' +
      '<textarea id="txt" placeholder="Tap a common item above or type details (where, when, what you saw)">' + esc(d.txt || '') + '</textarea>' +
      '<h3>If you added a squawk: can it fly?</h3><div class="sevs">' + SEV.map(function (s) { return '<label class="sev ' + s.c + (s.v === sev ? ' on' : '') + '"><input type="radio" name="sev" value="' + s.v + '"' + (s.v === sev ? ' checked' : '') + '><div>' + s.t + '<div class="sub" style="color:var(--mute);font-weight:500">' + s.d + '</div></div></label>'; }).join('') + '</div></div>' +

      '<div class="card"><h2>5 · Who flew?</h2><div class="row"><label class="f">Instructor name' + (st.mode === 'live' ? '<input type="text" id="nm" value="' + esc(who()) + '" readonly>' : '<input type="text" id="nm" value="' + esc(d.name || '') + '" placeholder="First and last name">') + '</label>' +
      '<label class="f">Student name <span style="font-weight:600">(optional)</span><input type="text" id="stu" value="' + esc(d.student || '') + '" placeholder="First and last name"></label></div></div>' +
      '<button class="btn pri big" id="send">Submit report</button><p class="disclaimer">' + U.DISCLAIMER + '</p></div>';
    updTimes();
    $$('#sl button').forEach(function (b) { b.onclick = function () { pullForm(); sqDraft.loc = b.dataset.l; remember('sqLoc', b.dataset.l); U.render(true); }; });
    $$('.acpick button').forEach(function (b) {
      b.onclick = function () {
        $$('.acpick button').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        pullForm(); sqDraft.ac = b.dataset.id; remember('sqAc', b.dataset.id);
        fillStarts(b.dataset.id, true);
      };
    });
    function setOil(yes) {
      $('#oil-yes').classList.toggle('on', yes);
      $('#oil-no').classList.toggle('on', !yes);
      $('#qtswrap').classList.toggle('hide', !yes);
      sqDraft.oil = yes ? 'yes' : 'no';
    }
    $('#oil-yes').onclick = function () { setOil(true); };
    $('#oil-no').onclick = function () { setOil(false); };
    if ($('#oilqts')) $('#oilqts').onchange = function () { sqDraft.qts = Number(this.value); };
['ts', 'te', 'hs', 'he'].forEach(function (id) {
      var el = $('#' + id);
      if (!el) return;
      el.oninput = function () {
        if (id === 'te' || id === 'he') {
          var kind = id === 'te' ? 'tach' : 'hobbs';
          if (sqDraft.snaps && sqDraft.snaps[kind]) sqDraft.snaps[kind].confirmed = true;
        }
        updTimes();
      };
    });
    $$('[data-confirm-snap]').forEach(function (b) {
      b.onclick = function () {
        pullForm();
        var kind = b.dataset.confirmSnap;
        if (sqDraft.snaps && sqDraft.snaps[kind]) sqDraft.snaps[kind].confirmed = true;
        U.render(true);
      };
    });
    function bindSnap(kind, btnId, fileId) {
      var btn = $('#' + btnId), file = $('#' + fileId);
      if (!btn || !file) return;
      btn.onclick = function () {
        var acBtn = $('.acpick button.on');
        if (!acBtn) return toast('Pick the airplane first', true);
        file.click();
      };
      file.onchange = function () {
        var f = file.files && file.files[0];
        file.value = '';
        if (!f) return;
        openSnapReader(kind, f);
      };
    }
    bindSnap('tach', 'snaptach', 'snaptachfile');
    bindSnap('hobbs', 'snaphobbs', 'snaphobbsfile');
    $$('#pre button').forEach(function (b) { b.onclick = function () { var t = $('#txt'); t.value = t.value ? t.value + '; ' + b.dataset.p : b.dataset.p; }; });
    $$('input[name=sev]').forEach(function (r) { r.onchange = function () { $$('.sev').forEach(function (l) { l.classList.toggle('on', l.querySelector('input').checked); }); }; });
    $('#send').onclick = function () {
      pullForm();
      var b = $('.acpick button.on');
      if (!b) return toast('Pick the airplane first', true);
      var a = byId(b.dataset.id); if (!a) return toast('Airplane not found', true);
      var oilYes = sqDraft.oil === 'yes';
      var oilQts = oilYes ? Number(sqDraft.qts) : null;
      if (oilYes && QTS.indexOf(oilQts) < 0) return toast('Pick how many quarts of oil', true);
      var pending = [];
      ['tach', 'hobbs'].forEach(function (kind) {
        if (!S.hasTach(a) && kind === 'tach') return;
        var snap = sqDraft.snaps && sqDraft.snaps[kind];
        if (snap && !snap.confirmed) pending.push(kind === 'tach' ? 'Tach' : 'Hobbs');
      });
      if (pending.length) return toast('Confirm or edit the snapped ' + pending.join(' and ') + ' reading first', true);
      function pair(kind, startEl, endEl, shown) {
        if (!shown) return { start: null, end: null };
        var s = parseHr(startEl.value), e = parseHr(endEl.value);
        if (isNaN(s) || isNaN(e)) { toast('Enter ' + kind + ' as a number', true); return false; }
        if (e == null) return { start: null, end: null };
        if (s == null) { toast('Enter the starting ' + kind + ' too', true); return false; }
        if (s < 0 || e < 0) { toast(kind + ' can’t be negative', true); return false; }
        if (e < s) { toast('End ' + kind + ' is earlier than start', true); return false; }
        if (e - s > 10 && !confirm('End ' + kind + ' is ' + (Math.round((e - s) * 10) / 10) + ' hours above start. Submit anyway?')) return false;
        return { start: s, end: e };
      }
      var tach = pair('Tach', $('#ts'), $('#te'), S.hasTach(a)); if (tach === false) return;
      var hobbs = pair('Hobbs', $('#hs'), $('#he'), true); if (hobbs === false) return;
      var txt = ($('#txt').value || '').trim();
      var sv = ($('input[name=sev]:checked') || {}).value || 'open';
      var nm = st.mode === 'live' ? who() : (($('#nm') && $('#nm').value.trim()) || 'CFI');
      if (st.mode !== 'live') remember('sqName', nm);
      if (!oilYes && tach.end == null && hobbs.end == null && !txt) return toast('Add oil, ending hours, or a squawk first', true);
      if (txt && sv === 'grounding' && !confirm('This will show ' + a.tail + ' as GROUNDED on every screen until a mechanic clears it. Continue?')) return;
      var stu = (($('#stu') && $('#stu').value) || '').trim().slice(0, 80);
      var report = {
        aircraftId: a.id, tail: a.tail, reportedBy: nm, student: stu,
        reporterEmail: st.user && st.user.email ? st.user.email : (st.mode === 'demo' ? 'demo@example.com' : ''),
        oilAdded: oilYes, oilQts: oilQts,
        tachStart: tach.start, tachEnd: tach.end, hobbsStart: hobbs.start, hobbsEnd: hobbs.end
      };
      var Ocr = window.PPAMeterOcr;
      var tachPhoto = (sqDraft.snaps && sqDraft.snaps.tach && Ocr) ? Ocr.dataUrlToRawBase64(sqDraft.snaps.tach.photo) : '';
      var hobbsPhoto = (sqDraft.snaps && sqDraft.snaps.hobbs && Ocr) ? Ocr.dataUrlToRawBase64(sqDraft.snaps.hobbs.photo) : '';
      var sendBtn = $('#send'); sendBtn.disabled = true; sendBtn.textContent = 'Submitting…';
      var squawkP = txt ? Store.addSquawk({ aircraftId: a.id, tail: a.tail, text: txt, severity: sv, reportedBy: nm }) : Promise.resolve(null);
      squawkP.then(function () {
        return Store.addFlightReport(report).then(function (saved) {
          if (saved && saved.id) report.id = saved.id;
          var extra = { location: U.locCode(a.location), squawkText: txt, tachPhoto: tachPhoto, hobbsPhoto: hobbsPhoto };
          return Store.sendFlightLogToSheet(saved || report, extra).then(function (sheet) {
            var sheetError = '', sheetSkipped = !!(sheet && sheet.skipped);
            if (sheet && sheet.sent === false) sheetError = sheet.error || 'The billing Sheet could not be reached.';
            sqDone = { aircraftId: a.id, tail: a.tail, text: txt, report: report, reportError: '', sheetError: sheetError, sheetSkipped: sheetSkipped };
            sqDraft = null; U.render(true);
          });
        }).catch(function (e) {
          sqDone = { aircraftId: a.id, tail: a.tail, text: txt, report: report, reportError: Store.isDenied(e) ? rulesDeniedMsg() : ((e && e.message) || String(e)) };
          sqDraft = null; U.render(true);
        });
      }).catch(function (e) {
        sendBtn.disabled = false; sendBtn.textContent = 'Submit report';
        toast((e && e.message) || String(e), true);
      });
    };
  }

  function openSnapReader(kind, file) {
    var Ocr = window.PPAMeterOcr;
    if (!Ocr) return toast('Meter reader failed to load. Refresh the page and try again.', true);
    pullForm();
    var a = byId(sqDraft.ac);
    var label = kind === 'tach' ? 'Tach' : 'Hobbs';
    var overlay = document.createElement('div');
    overlay.className = 'sheet';
    overlay.innerHTML = '<div class="in snapreader"><h2>📷 Snap ' + label + ' meter</h2>' +
      '<p class="sub" style="color:var(--mute)">Frame the digits in the box. The board reads them on this phone — nothing is uploaded until you submit the report, and photos are not stored in the aircraft record.</p>' +
      '<div class="snapstage"><canvas id="snapcan"></canvas><div id="snapcrop" class="snapcrop"></div></div>' +
      '<div id="snapstat" class="ftime">Preparing photo…</div>' +
      '<div class="row" style="margin-top:10px"><button type="button" class="btn ghost" id="snapx">Cancel</button></div></div>';
    document.body.appendChild(overlay);
    function close() { overlay.remove(); }
    $('#snapx', overlay).onclick = close;
    Ocr.downscaleBlob(file).then(function (img) {
      var can = $('#snapcan', overlay);
      can.width = img.width; can.height = img.height;
      can.getContext('2d').drawImage(img.canvas, 0, 0);
      var crop = Ocr.defaultCrop(img.width, img.height);
      var box = $('#snapcrop', overlay);
      var stage = $('.snapstage', overlay);
      function placeBox() {
        var r = can.getBoundingClientRect(), sr = stage.getBoundingClientRect();
        var sx = r.width / img.width, sy = r.height / img.height;
        box.style.left = (r.left - sr.left + crop.x * sx) + 'px';
        box.style.top = (r.top - sr.top + crop.y * sy) + 'px';
        box.style.width = (crop.w * sx) + 'px';
        box.style.height = (crop.h * sy) + 'px';
      }
      placeBox();
      $('#snapstat', overlay).textContent = 'Reading digits…';
      return Ocr.recognizeBest(img.canvas, crop).then(function (out) {
        if (!out.parsed) {
          $('#snapstat', overlay).textContent = 'Could not read a number. Try a closer, sharper photo of just the digits, or type the time yourself.';
          var again = document.createElement('button');
          again.type = 'button'; again.className = 'btn'; again.textContent = 'Type it instead';
          again.onclick = close;
          $('.row', overlay).appendChild(again);
          return;
        }
        var value = out.parsed.value;
        var current = a ? S.meterReading(a, kind) : null;
        var chk = S.meterPlausibility(value, current);
        var warn = chk && chk.warn ? chk.message : '';
        sqDraft.snaps = sqDraft.snaps || { tach: null, hobbs: null };
        sqDraft.snaps[kind] = { photo: img.dataUrl, value: value, confirmed: false, warning: warn, raw: out.parsed.raw };
        if (kind === 'tach') sqDraft.tachEnd = value;
        else sqDraft.hobbsEnd = value;
        close();
        U.render(true);
        toast((warn ? 'Check this ' : 'Read ') + label + ': ' + value + (warn ? '' : ' — confirm or edit it'));
      });
    }).catch(function (e) {
      close();
      toast((e && e.message) || String(e), true);
    });
  }

  // ================= EDIT LIST =================
  function editList() {
    var ev = U.evalAll(), f = remember('edLoc') || '', q = (remember('edQ') || '').toLowerCase(), sort = remember('edSort2') || 'location';
    var match = function (a) { return (!f || a.location === f) && (!q || (a.tail + ' ' + a.type).toLowerCase().indexOf(q) >= 0); };
    var list = U.sorted(U.active().filter(match), ev, sort);
    var away = st.aircraft.filter(function (a) { return S.isAway(a, st.settings) && match(a); }).sort(function (a, b) { return a.tail.localeCompare(b.tail); });
    var splitG = sort === 'location' || sort === 'tail';
    var flying = splitG ? list.filter(function (a) { return ev[a.id].overall !== 'grounded'; }) : list, down = splitG ? list.filter(function (a) { return ev[a.id].overall === 'grounded'; }) : [];
    var c = U.counts(ev, U.active());
    var demoRole = st.mode === 'demo' ? '<div class="row" style="margin-bottom:10px"><span class="sub" style="color:var(--mute)">Demo as:</span><select id="dr" style="width:auto">' + opt('editor', 'Owner / Mechanic (edit all)', st.role) + opt('cfi', 'CFI (post-flight report)', st.role) + '</select></div>' : '';
    app.innerHTML = U.topbar('Edit fleet', 'Owner & mechanic · changes save automatically') + '<div class="wrap">' + U.demoBanner() + (st.reportsError ? '<div class="banner red">' + esc(st.reportsError) + '</div>' : '') + demoRole + U.sumChips(c) +
      '<div class="row" style="margin:12px 0"><input type="text" id="q" placeholder="Search tail or type" value="' + esc(remember('edQ') || '') + '" style="max-width:220px"><select id="lf" style="max-width:260px">' + locOptions(f, 'All locations') + '</select>' +
      '<select id="so" style="max-width:200px">' + opt('location', 'Sort: location (grounded last)', sort) + opt('status', 'Sort: problems first', sort) + opt('tail', 'Sort: tail number (grounded last)', sort) + opt('custom', 'Sort: TV order', sort) + '</select><span style="flex:1"></span><button class="btn" id="flogout">⬇ Export flight log CSV</button><button class="btn pri" id="add">+ Add aircraft</button></div>' +
      flying.map(rowHtml).join('') +
      (down.length ? '<div class="gsec"><h2>⛔ Grounded (' + down.length + ') <span>do not fly</span></h2>' + down.map(rowHtml).join('') + '</div>' : '') +
      (list.length ? '' : '<div class="card">No aircraft match. Tap + Add aircraft.</div>') +
      (away.length ? '<div class="awaysec"><h2>✈️ Away from Patriot (' + away.length + ') <span>hidden from the fleet board, TV, report form and alerts</span></h2>' + away.map(function (a) {
        return '<div class="li awayrow"><b>' + esc(a.tail) + '</b> <span class="sub" style="color:var(--mute)">' + esc(a.type || '') + ' · ' + U.locTag(a.location, 'loc inl') + '</span><span style="flex:1"></span><a class="btn sm" href="#edit/' + a.id + '">Open ›</a><button class="btn pri restorebtn" data-unaway="' + esc(a.tail) + '">↩ Restore to board</button></div>';
      }).join('') + '</div>' : '') +
      '<p class="disclaimer">' + U.DISCLAIMER + '</p></div>';
    function rowHtml(a) {
        var e = ev[a.id];
        return '<div class="erow s-' + e.overall + '"><div><div class="t">' + esc(a.tail) + (a.sample ? ' <span class="chip s-due" style="font-size:10px">SAMPLE</span>' : '') + '</div><div class="ty">' + U.locTag(a.location, 'loc inl') + ' ' + esc(a.type) + '</div><span class="ostat s-' + e.overall + '" style="font-size:12px">' + U.LABEL[e.overall] + '</span>' + (e.openSquawks ? ' <span class="chip s-' + (e.groundingSquawks ? 'over' : 'due') + '">⚑ ' + e.openSquawks + '</span>' : '') + '</div>' +
          U.pillsHTML(e) +
          '<div class="hrs">' + ['tach', 'hobbs'].map(function (m) {
            var ud = updated(a, m), staleM = ud && S.daysBetween(ud, today()) > S.rules(st.settings).staleHoursDays;
            return '<div class="hmeter"><span>' + meterName(m) + '</span><input type="number" step="0.1" inputmode="decimal" data-hrs="' + a.id + '" data-meter="' + m + '" value="' + esc(hrsVal(a, m)) + '" title="Current ' + meterName(m) + '"><span class="sub" style="color:' + (staleM ? 'var(--due)' : 'var(--mute)') + ';font-size:11px">' + (ud ? S.niceDate(ud) : 'never') + '</span></div>';
          }).join('') + '</div>' +
          oilCell(a) +
          '<div class="row">' + (sort === 'custom' ? '<button class="iconbtn" data-up="' + a.id + '">↑</button><button class="iconbtn" data-dn="' + a.id + '">↓</button>' : '') + '<a class="btn" href="#edit/' + a.id + '">Open ›</a></div></div>';
    }
    if ($('#dr')) $('#dr').onchange = function () { Store.setDemoRole(this.value); if (this.value === 'cfi') location.hash = '#squawk'; };
    $('#q').onchange = function () { remember('edQ', this.value); U.render(true); };
    $('#lf').onchange = function () { remember('edLoc', this.value); U.render(true); };
    $('#so').onchange = function () { remember('edSort2', this.value); U.render(true); };
    $$('[data-unaway]').forEach(function (b) { b.onclick = function () { setAway(b.dataset.unaway, false); }; });
    $('#add').onclick = addSheet;
    if ($('#flogout')) $('#flogout').onclick = function () { PPASettings.exportFlightLog(); };
    $$('[data-hrs]').forEach(function (i) {
      function save() {
        var a = clone(byId(i.dataset.hrs)), m = i.dataset.meter || 'tach', v = i.value === '' ? null : Number(i.value), prev = reading(a, m);
        if (v === prev || (v == null && prev == null)) return;
        if (prev != null && v != null && v < prev && !confirm('New ' + meterName(m) + ' (' + v + ') is LOWER than before (' + prev + '). Save anyway?')) { i.value = prev; return; }
        a[m] = v; a[m + 'Updated'] = today(); logEntry(a, meterName(m) + ' set to ' + v);
        Store.saveAircraft(a).then(function () { toast(a.tail + ' ' + meterName(m) + ' saved'); });
      }
      i.onchange = save; i.onkeydown = function (k) { if (k.key === 'Enter') i.blur(); };
    });
    function move(id, d) {
      var l = U.sorted(st.aircraft, ev, 'custom'), i = l.findIndex(function (a) { return a.id === id; }), j = i + d; if (j < 0 || j >= l.length) return;
      var t = l[i]; l[i] = l[j]; l[j] = t; l.forEach(function (a, k) { if (a.order !== k) { var c2 = clone(a); c2.order = k; Store.saveAircraft(c2); } });
    }
    $$('[data-up]').forEach(function (b) { b.onclick = function () { move(b.dataset.up, -1); }; });
    $$('[data-dn]').forEach(function (b) { b.onclick = function () { move(b.dataset.dn, 1); }; });
  }
  function addSheet() {
    var d = document.createElement('div'); d.className = 'sheet';
    d.innerHTML = '<div class="in"><h2>Add aircraft</h2><label class="f">Tail number<input type="text" id="nt" placeholder="N12345" autocapitalize="characters"></label><br>' +
      '<label class="f">Type<select id="ny">' + typeOptions(remember('lastType') || (st.settings.types || [])[0]) + '</select></label><br>' +
      '<label class="f">Location<select id="nl">' + locOptions(remember('lastLoc') || ((st.settings.locations || [])[0] || {}).id) + '</select></label><br>' +
      '<div class="row"><label class="chk"><input type="checkbox" id="ni" checked> IFR certified</label><label class="chk"><input type="checkbox" id="nh" checked> Used for hire / instruction (100-hr applies)</label></div>' +
      '<div class="row"><button class="btn pri" id="ok">Create</button><button class="btn ghost" id="cn">Cancel</button></div></div>';
    document.body.appendChild(d);
    $('#ny', d).onchange = function () { if (this.value === '__new') { var t = prompt('New aircraft type (e.g. Cessna 172S)'); if (t) { var s = clone(st.settings); s.types = (s.types || []).concat([t.trim()]); Store.saveSettings(s); this.innerHTML = typeOptions(t.trim()); } else this.selectedIndex = 0; } };
    $('#cn', d).onclick = function () { d.remove(); };
    $('#ok', d).onclick = function () {
      var tail = $('#nt', d).value.trim().toUpperCase(); if (!tail) return toast('Tail number required', true);
      if (st.aircraft.some(function (a) { return a.tail.toUpperCase() === tail; })) return toast(tail + ' already exists', true);
      remember('lastType', $('#ny', d).value); remember('lastLoc', $('#nl', d).value);
      var a = { id: PPASample.uid(), tail: tail, type: $('#ny', d).value, location: $('#nl', d).value, meter: remember('lastMeter') || 'tach', hours: null, last100: null, hoursUpdated: '',
        tach: null, hobbs: null, tachUpdated: '', hobbsUpdated: '',
        ifr: $('#ni', d).checked, forHire: $('#nh', d).checked, dates: {}, na: {}, ads: [], statusNote: '', expectedBack: '', grounded: false, groundedReason: '', fspAircraftId: '', order: st.aircraft.length, log: [] };
      logEntry(a, 'Aircraft added');
      Store.saveAircraft(a).then(function () { d.remove(); location.hash = '#edit/' + a.id; });
    };
    setTimeout(function () { $('#nt', d).focus(); }, 50);
  }

  // ================= EDIT ONE =================
  function setPath(o, path, v) { var p = path.split('.'), x = o; for (var i = 0; i < p.length - 1; i++) { x[p[i]] = x[p[i]] || {}; x = x[p[i]]; } x[p[p.length - 1]] = v; }
  function getPath(o, path) { return path.split('.').reduce(function (x, k) { return x == null ? undefined : x[k]; }, o); }
  function reportsCard(id) {
    var recents = S.reportsFor(st.flightReports, id);
    var a = byId(id);
    var html = '<div class="card"><h2>CFI-reported flight log</h2>';
    if (st.reportsError) html += '<div class="banner red">' + esc(st.reportsError) + '</div>';
    html += '<p class="sub" style="color:var(--mute)">This log is the paper-book replacement for billing. Flight Schedule Pro stays the official hours record — CFI-reported times never change Tach or Hobbs on the board.</p>';
    if (a) html += oilDetail(a);
    if (!recents.length) html += '<p class="sub" style="color:var(--mute)">No CFI reports yet for this aircraft.</p></div>';
    else html += recents.slice(0, 12).map(function (r) {
      var bits = [];
      if (r.tachEnd != null) bits.push('CFI-reported Tach ' + S.hoursLabel(r.tachStart) + ' → ' + S.hoursLabel(r.tachEnd));
      if (r.hobbsEnd != null) bits.push('CFI-reported Hobbs ' + S.hoursLabel(r.hobbsStart) + ' → ' + S.hoursLabel(r.hobbsEnd));
      bits.push(r.oilAdded ? ('Oil +' + r.oilQts + ' qt') : 'No oil added');
      if (r.sheetSent) bits.push('sent to Sheet');
      return '<div class="reprow"><div class="meta"><span class="chip s-due">CFI-reported</span> <b>' + esc(reportDay(r)) + '</b> · ' + esc(r.reportedBy || r.reporterEmail || 'CFI') + (r.student ? ' / ' + esc(r.student) : '') +
        '<div>' + bits.join(' · ') + '</div></div></div>';
    }).join('') + '</div>';
    return html;
  }
  function editOne(id) {
    var a = byId(id); if (!a) { app.innerHTML = U.topbar('Not found') + '<div class="wrap"><a href="#edit">← Back</a></div>'; return; }
    var e = S.evaluate(a, st.settings, st.squawks), R = S.rules(st.settings);
    var priv = st.priv[id] || {};
    function fld(path, type, extra) { var v = getPath(a, path); return '<input type="' + type + '" data-f="' + path + '" value="' + esc(v == null ? '' : v) + '"' + (extra || '') + '>'; }
    function chk(path, label) { return '<label class="chk"><input type="checkbox" data-f="' + path + '"' + (getPath(a, path) ? ' checked' : '') + '> ' + label + '</label>'; }
    var it = {}; e.items.forEach(function (i) { it[i.key] = i; });
    var adList = S.trackedADs(a, R), ignoredN = adList.filter(S.isIgnoredAD).length;
    var adOrder = adList.map(function (x, k) { return k; }).sort(function (x, y) { return (S.isIgnoredAD(adList[x]) ? 1 : 0) - (S.isIgnoredAD(adList[y]) ? 1 : 0) || x - y; });
    // Editing the default 50-hr oil change saves it onto the aircraft as a real item.
    function adAt(c, k) {
      c.ads = c.ads || [];
      if (k >= c.ads.length) { var v = S.defaultOil50(c, R); delete v.virtual; delete v.assumedFrom100; v.id = PPASample.uid(); c.ads.push(v); return c.ads[c.ads.length - 1]; }
      return c.ads[k];
    }
    function itemRow(key, inner, doneBtn) {
      var i = it[key];
      return '<div class="itemrow s-' + i.state + '"><div class="lab"><b>' + i.letter + '</b>' + esc(i.short) + '</div><div>' + inner + '</div><div>' + doneBtn + '</div><div>' + chkNA(key) + '</div>' +
        '<div class="res"><span class="chip s-' + i.state + '">' + esc(i.state === 'na' ? 'N/A' : i.value) + '</span> ' + esc(i.detail) + '</div></div>';
    }
    function chkNA(key) { if (key === 'oil50') return '<span class="sub" style="color:var(--mute);font-size:12px">always tracked</span>'; return '<label class="chk" title="Not applicable to this aircraft"><input type="checkbox" data-f="na.' + key + '"' + ((a.na || {})[key] ? ' checked' : '') + '> N/A</label>'; }
    function dateItem(key, label) { return itemRow(key, '<label class="f">' + label + fld('dates.' + key, 'date') + '</label>', '<button class="btn ok" data-done="' + key + '">✓ Done today</button>'); }
    function adRow(k) {
        var ad = adList[k], ign = S.isIgnoredAD(ad), ng = ad.nonGrounding || (S.isOilChange(ad) && ad.nonGrounding !== false);
        var ae = ign ? null : (it.ads.ads || []).concat((it.oil50 && it.oil50.ads) || []).filter(function (x) { return x.ad.id === ad.id; })[0];
        var unit = ad.intervalMonths ? 'months' : ad.intervalDays ? 'days' : '';
        return '<div class="li' + (ign ? ' ignrow' : '') + '" style="flex-direction:column;align-items:stretch"><div class="row">' + (ign ? '<span class="chip s-na">IGNORED</span>' : ae ? '<span class="chip s-' + ae.state + '">' + esc(ae.value) + '</span>' : '') + (ad.virtual ? '<span class="chip s-na">default · not saved yet</span>' : '') +
          '<label class="f">AD number<input type="text" data-ad="' + k + '.number" value="' + esc(ad.number || '') + '" placeholder="2011-10-09"></label>' +
          '<label class="f" style="flex:2">Description<input type="text" data-ad="' + k + '.desc" value="' + esc(ad.desc || '') + '"></label></div><div class="row">' +
          '<label class="f">Repeats every<input type="number" data-ad="' + k + '.intervalN" value="' + esc(ad.intervalMonths || ad.intervalDays || '') + '"></label>' +
          '<label class="f">Unit<select data-ad="' + k + '.intervalUnit">' + opt('', 'no calendar repeat', unit) + opt('months', 'calendar months', unit) + opt('days', 'days', unit) + '</select></label>' +
          '<label class="f">and/or every (hours)<input type="number" step="0.1" data-ad="' + k + '.intervalHours" value="' + esc(ad.intervalHours || '') + '"></label>' +
          '<label class="f">Last done date<input type="date" data-ad="' + k + '.lastDoneDate" value="' + esc(ad.lastDoneDate || '') + '"></label>' +
          '<label class="f">Last done at hours<input type="number" step="0.1" data-ad="' + k + '.lastDoneHours" value="' + esc(ad.lastDoneHours == null ? '' : ad.lastDoneHours) + '"></label></div><div class="row">' +
          '<label class="f">One-time: next due date<input type="date" data-ad="' + k + '.nextDueDate" value="' + esc(ad.nextDueDate || '') + '"></label>' +
          '<label class="f">One-time: next due hours<input type="number" step="0.1" data-ad="' + k + '.nextDueHours" value="' + esc(ad.nextDueHours == null ? '' : ad.nextDueHours) + '"></label>' +
          '<label class="f" style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" data-adng="' + k + '"' + (ng ? ' checked' : '') + '> Non-grounding (overdue shows amber, plane stays available)</label>' +
          (ign ? '' : '<button class="btn ok" data-addone="' + k + '">✓ Complied today</button>') + (S.isOilChange(ad) ? '' : (ign ? '<button class="btn pri restorebtn" data-adign="' + k + '">↩ Restore</button>' : '<button class="btn sm" data-adign="' + k + '">🚫 Ignore</button>')) + (ad.virtual ? '' : '<button class="iconbtn" data-adrm="' + k + '" title="Remove">✕</button>') + '</div>' + (ign ? '<div class="sub" style="color:var(--mute);font-size:13px">Ignored — not counted in status or shown on the fleet view' + (S.isGpsUpdate(ad) && ad.ignored !== true ? ' (GPS / nav database update)' : '') + '.</div>' : ae ? '<div class="sub" style="color:#cfdcf0;font-size:13px">' + esc(ae.detail) + '</div>' : '') + '</div>';
    }
    var sqs = st.squawks.filter(function (s) { return s.aircraftId === id; });
    var closed = (st.closedSquawks || []).filter(function (s) { return s.aircraftId === id; }).slice(0, 15);
    var notePre = (st.settings.notePresets || []);
    app.innerHTML = U.topbar(a.tail, 'Changes save automatically') + '<div class="wrap" style="max-width:980px">' + U.demoBanner() +
      '<div class="row" style="margin-bottom:10px"><a class="btn sm ghost" href="#edit">← Fleet</a><span class="ostat s-' + e.overall + '" style="font-size:18px">' + U.LABEL[e.overall] + '</span><span>' + esc(e.reasons.join(' · ')) + '</span></div>' +

      '<div class="card"><h2>Status shown to CFIs & customers</h2><div class="row">' +
      '<label class="f">Status note<select data-note="1">' + opt('', '— none —', '') + notePre.map(function (p) { return opt(p, p, a.statusNote); }).join('') + opt('__c', 'Custom text…', '') + '</select></label>' +
      '<label class="f">Note text' + fld('statusNote', 'text', ' placeholder="e.g. Alternator on order"') + '</label>' +
      '<label class="f">Expected back in service' + fld('expectedBack', 'date') + '</label></div>' +
      '<div class="row">' + chk('grounded', '<b style="color:#ff8a95">Ground this aircraft</b> (manual hold)') +
      '<label class="f" style="max-width:320px">Reason<select data-f="groundedReason">' + opt('', '—', a.groundedReason) + (st.settings.groundPresets || []).map(function (p) { return opt(p, p, a.groundedReason); }).join('') + '</select></label></div></div>' +

      '<div class="card"><h2>Aircraft</h2><div class="row">' +
      '<label class="f">Tail number' + fld('tail', 'text', ' autocapitalize="characters"') + '</label>' +
      '<label class="f">Type<select data-f="type">' + typeOptions(a.type) + '</select></label>' +
      '<label class="f">Location<select data-f="location">' + locOptions(a.location) + '</select></label></div><div class="row">' +
      '<label class="f" style="max-width:280px">100-hr tracked by<select data-f="meter">' + opt('tach', 'Tach', a.meter) + opt('hobbs', 'Hobbs', a.meter) + '</select></label>' + '<label class="chk"><input type="checkbox" data-f="hasTach"' + (S.hasTach(a) ? ' checked' : '') + '> This aircraft has a Tach meter</label></div>' +
      '<div class="row">' +
      ['tach', 'hobbs'].filter(function (m) { return m === 'hobbs' || S.hasTach(a); }).map(function (m) {
        var ud = updated(a, m), staleM = ud && S.daysBetween(ud, today()) > S.rules(st.settings).staleHoursDays;
        return '<label class="f">Current ' + meterName(m) + '<input type="number" step="0.1" inputmode="decimal" data-f="' + m + '" value="' + esc(hrsVal(a, m)) + '"><span class="sub" style="color:' + (staleM ? 'var(--due)' : 'var(--mute)') + '">Updated ' + (ud ? S.niceDate(ud) : 'never') + '</span></label>';
      }).join('') + '</div>' +
      '<div class="row">' + chk('ifr', 'IFR certified (tracks VOR + pitot-static)') + chk('forHire', 'Used for hire / instruction (100-hr applies)') + '</div></div>' +

      reportsCard(id) +

      '<div class="card"><h2>A V 1 A T E · 50 HR · 100 HR</h2>' + U.pillsHTML(e) +
      dateItem('annual', 'Annual — last done') +
      dateItem('vor', 'VOR check (91.171, every 30 days for IFR) — last done') +
      itemRow('hundred', '<label class="f">Last 100-hr done at (' + esc(S.meterOf(a)) + ')' + fld('last100', 'number', ' step="0.1" inputmode="decimal"') + '</label>', '<button class="btn ok" data-done="hundred">✓ Done at ' + esc(reading(a) == null ? '?' : reading(a)) + '</button>') +
      dateItem('pitot', 'Altimeter/pitot-static (91.411) — last done') +
      dateItem('xpdr', 'Transponder (91.413) — last done') +
      itemRow('elt', '<div class="row"><label class="f">ELT inspection — last done' + fld('dates.elt', 'date') + '</label><label class="f">ELT battery expires' + fld('dates.eltBattery', 'date') + '</label></div>', '<button class="btn ok" data-done="elt">✓ Inspected today</button>') +
      itemRow('ads', '<span class="sub" style="color:var(--mute)">' + adList.length + ' item(s) below' + (ignoredN ? ' (' + ignoredN + ' ignored)' : '') + '. The worst tracked one sets this color.</span>', '') +
      itemRow('oil50', '<span class="sub" style="color:var(--mute)">50-hr oil change (non-grounding by default). Always tracked on every plane (it cannot be ignored). Edit it or mark it complied in the ADs &amp; tracked reminders card below.</span>', '') +
      '<p class="sub" style="color:var(--mute);font-size:12px">Calendar-month items are due through the last day of the month (e.g. annual done Mar 10 → due Mar 31 next year). Yellow thresholds are in Settings. 100-hr: the 10-hour overfly allowance (91.409(b)) is info only and never extends the due on this board.</p></div>' +

      '<div class="card"><h2>ADs &amp; tracked reminders (+ 50 HR oil change)</h2>' + (ignoredN ? '<a class="ignnote" href="javascript:void(0)" onclick="document.getElementById(\'ignsec\').scrollIntoView({behavior:\'smooth\'})">🚫 ' + ignoredN + ' ignored item' + (ignoredN > 1 ? 's' : '') + ' — jump to Restore ↓</a>' : '') + '<p class="sub" style="color:var(--mute);font-size:12px;margin-top:0">ADs no longer have a letter on the card, but an overdue AD still grounds the plane and shows in its status line. The 50-hr oil change is edited here but shows as the <b>50 HR</b> pill (non-grounding unless you uncheck the box). Tap <b>Ignore</b> to stop tracking an item without deleting it (the oil change cannot be ignored); FSP re-imports keep it ignored. GPS / nav database updates are ignored automatically.</p><div class="listed">' + adOrder.filter(function (k) { return !S.isIgnoredAD(adList[k]); }).map(adRow).join('') + '</div>' +
        (ignoredN ? '<div id="ignsec" class="ignsec"><h3>🚫 Ignored items (' + ignoredN + ') <span class="sub">not counted in status · tap <b>↩ Restore</b> to track again</span></h3><div class="listed">' + adOrder.filter(function (k) { return S.isIgnoredAD(adList[k]); }).map(adRow).join('') + '</div></div>' : '') +
        '<br><button class="btn" id="addad">+ Add AD</button></div>' +

      '<div class="card"><h2>Squawks (' + sqs.length + ' open)</h2><div class="listed">' + sqs.map(function (s) {
        return '<div class="li"><select data-sqsev="' + s.id + '" style="max-width:250px">' + SEV.map(function (x) { return opt(x.v, x.t, s.severity || (s.grounding ? 'grounding' : 'open')); }).join('') + '</select><div style="flex:3;min-width:200px"><b>' + esc(s.text) + '</b><div class="sub" style="color:var(--mute);font-size:12px">' + esc(s.reportedBy || '') + ' · ' + esc((s.createdAt || '').slice(0, 10)) + '</div></div><button class="btn ok sm" data-fix="' + s.id + '">✓ Fixed</button></div>';
      }).join('') + '</div><div class="row" style="margin-top:10px"><input type="text" id="nsq" placeholder="Add a squawk (mechanic)" style="flex:2"><select id="nsv" style="max-width:240px">' + SEV.map(function (x) { return opt(x.v, x.t, 'open'); }).join('') + '</select><button class="btn" id="addsq">Add</button></div>' +
      (closed.length ? '<details style="margin-top:10px"><summary>Recently fixed (' + closed.length + ')</summary>' + closed.map(function (s) { return '<div class="li"><span style="flex:1">' + esc(s.text) + ' — <i>' + esc(s.fix || 'fixed') + '</i> (' + esc((s.closedAt || '').slice(0, 10)) + ', ' + esc(s.closedBy || '') + ')</span><button class="btn sm" data-reopen="' + s.id + '">Reopen</button></div>'; }).join('') + '</details>' : '') + '</div>' +

      '<div class="card"><h2>Internal note <span class="chip s-na">staff only — never shown on TV or customer view</span></h2><textarea id="inote">' + esc(priv.internalNote || '') + '</textarea></div>' +
      '<div class="card"><h2>Integration</h2><div class="row"><label class="f">Flight Schedule Pro aircraft ID (for future auto-sync)' + fld('fspAircraftId', 'text', ' placeholder="optional"') + '</label></div></div>' +
      '<details class="card"><summary><b>Change history</b> (' + (a.log || []).length + ')</summary>' + (a.log || []).map(function (l) { return '<div class="sub" style="color:#cfdcf0;font-size:13px;padding:3px 0">' + esc(new Date(l.at).toLocaleString()) + ' · ' + esc(l.by) + ' · ' + esc(l.what) + '</div>'; }).join('') + '</details>' +
      '<div class="card"><h2>Away from Patriot</h2>' + (S.isAway(a, st.settings) ?
        '<div class="banner">✈️ ' + esc(a.tail) + ' is marked AWAY — hidden from the fleet board, TV, report form and alerts. Its data is kept and FSP imports still update it.</div><button class="btn pri restorebtn" id="awaybtn">↩ Restore ' + esc(a.tail) + ' to the board</button>' :
        '<p class="sub" style="color:var(--mute)">Use this when the plane leaves Patriot for a while (e.g. on lease or at another shop). It disappears from every status screen until you tap Restore. Nothing is deleted.</p><button class="btn" id="awaybtn">✈️ Mark ' + esc(a.tail) + ' away (hide from board)</button>') + '</div>' +
      '<div class="card"><button class="btn bad" id="del">Delete ' + esc(a.tail) + '</button></div><p class="disclaimer">' + U.DISCLAIMER + '</p></div>';

    function save(mut, msg) { var c = clone(byId(id)); mut(c); return Store.saveAircraft(c).then(function () { toast(msg || 'Saved ✓'); U.render(true); }).catch(function (er) { toast(er.message, true); }); }
    $$('[data-f]').forEach(function (el) {
      el.onchange = function () {
        var path = el.dataset.f, v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value;
        if (path === 'type' && v === '__new') { var t = prompt('New aircraft type'); if (!t) { U.render(true); return; } t = t.trim(); var s = clone(st.settings); s.types = (s.types || []).concat([t]); Store.saveSettings(s); v = t; }
        if (path === 'tail') { v = String(v).trim().toUpperCase(); if (!v) { U.render(true); return; } }
        if ((path === 'tach' || path === 'hobbs')) {
          var prev = reading(a, path);
          if (prev != null && v != null && v < prev && !confirm('New ' + meterName(path) + ' is LOWER than before (' + prev + '). Save anyway?')) { U.render(true); return; }
        }
        save(function (c) {
          setPath(c, path, v);
          if (path === 'tach' || path === 'hobbs') c[path + 'Updated'] = today();
          if (path === 'meter') remember('lastMeter', v);
          if (path === 'location') remember('lastLoc', v);
          if (path === 'grounded' && v && !c.groundedReason) c.groundedReason = (st.settings.groundPresets || [])[0] || '';
          logEntry(c, (path === 'tach' || path === 'hobbs' ? meterName(path) : path) + ' → ' + (v === true ? 'yes' : v === false ? 'no' : v));
        });
      };
    });
    $('[data-note]').onchange = function () { var v = this.value; if (v === '__c') { $('[data-f=statusNote]').focus(); return; } save(function (c) { c.statusNote = v; logEntry(c, 'Status note → ' + (v || 'none')); }); };
    $$('[data-done]').forEach(function (b) {
      b.onclick = function () {
        var k = b.dataset.done;
        save(function (c) {
          if (k === 'hundred') { var cur = reading(c); if (cur == null) { toast('Enter current ' + S.meterOf(c) + ' first', true); return; } c.last100 = cur; logEntry(c, '100-hr done at ' + cur + ' ' + S.meterOf(c)); }
          else { c.dates = c.dates || {}; c.dates[k] = today(); logEntry(c, k + ' done ' + today()); }
          if (c.na) c.na[k] = false;
        }, '✓ Marked done — next due rolled forward');
      };
    });
    // ADs
    $$('[data-ad]').forEach(function (el) {
      el.onchange = function () {
        var p = el.dataset.ad.split('.'), k = +p[0], f = p[1], v = el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value;
        save(function (c) {
          var ad = adAt(c, k);
          if (f === 'intervalN' || f === 'intervalUnit') {
            var n = f === 'intervalN' ? v : (ad.intervalMonths || ad.intervalDays || null), u = f === 'intervalUnit' ? v : (ad.intervalMonths ? 'months' : ad.intervalDays ? 'days' : (n ? 'months' : ''));
            ad.intervalMonths = u === 'months' ? n : null; ad.intervalDays = u === 'days' ? n : null;
          } else ad[f] = v;
          logEntry(c, 'AD ' + (ad.number || '') + ' ' + f + ' → ' + v);
        });
      };
    });
    $('#addad').onclick = function () { save(function (c) { c.ads = c.ads || []; c.ads.push({ id: PPASample.uid(), number: '', desc: '', intervalMonths: null, intervalDays: null, intervalHours: null, lastDoneDate: '', lastDoneHours: null, nextDueDate: '', nextDueHours: null }); }, 'AD added — fill in the details'); };
    $$('[data-adng]').forEach(function (el) { el.onchange = function () { save(function (c) { var ad = adAt(c, +el.dataset.adng); ad.nonGrounding = el.checked; logEntry(c, 'AD ' + (ad.number || ad.desc || '') + (el.checked ? ' set non-grounding' : ' set grounding')); }); }; });
    $$('[data-adign]').forEach(function (b) { b.onclick = function () { save(function (c) { var ad = adAt(c, +b.dataset.adign); var was = S.isIgnoredAD(ad); ad.ignored = !was; logEntry(c, (ad.number || ad.desc || 'AD') + (was ? ' restored (tracked again)' : ' ignored')); }, 'Saved ✓'); }; });
    $$('[data-adrm]').forEach(function (b) { b.onclick = function () { if (!confirm('Remove this AD from tracking?')) return; save(function (c) { var r = c.ads.splice(+b.dataset.adrm, 1)[0]; logEntry(c, 'AD removed ' + (r.number || '')); }); }; });
    $$('[data-addone]').forEach(function (b) { b.onclick = function () { save(function (c) { var ad = adAt(c, +b.dataset.addone); ad.lastDoneDate = today(); var cur = reading(c); if (cur != null) ad.lastDoneHours = cur; if (!ad.intervalMonths && !ad.intervalDays && !ad.intervalHours) { ad.nextDueDate = ''; ad.nextDueHours = null; ad.inactive = true; } logEntry(c, 'AD ' + (ad.number || '') + ' complied ' + today()); }, '✓ AD complied — next due rolled forward'); }; });
    // squawks
    $$('[data-sqsev]').forEach(function (el) { el.onchange = function () { var s = clone(st.squawks.filter(function (x) { return x.id === el.dataset.sqsev; })[0]); s.severity = el.value; Store.updateSquawk(s).then(function () { toast('Squawk updated'); U.render(true); }); }; });
    $$('[data-fix]').forEach(function (b) { b.onclick = function () { var fix = prompt('What was done? (optional)', ''); if (fix === null) return; var s = clone(st.squawks.filter(function (x) { return x.id === b.dataset.fix; })[0]); s.status = 'closed'; s.fix = fix; s.closedAt = new Date().toISOString(); s.closedBy = who(); Store.updateSquawk(s).then(function () { toast('Squawk cleared'); U.render(true); }); }; });
    $$('[data-reopen]').forEach(function (b) { b.onclick = function () { var s = clone(st.closedSquawks.filter(function (x) { return x.id === b.dataset.reopen; })[0]); s.status = 'open'; Store.updateSquawk(s).then(function () { U.render(true); }); }; });
    $('#addsq').onclick = function () { var t = $('#nsq').value.trim(); if (!t) return; Store.addSquawk({ aircraftId: id, tail: a.tail, text: t, severity: $('#nsv').value, reportedBy: who() }).then(function () { toast('Squawk added'); U.render(true); }); };
    $('#inote').onchange = function () { Store.savePrivate(id, { internalNote: this.value }).then(function () { toast('Internal note saved'); }); };
    $('#awaybtn').onclick = function () { setAway(a.tail, !S.isAway(a, st.settings)); };
    $('#del').onclick = function () { var t = prompt('Type ' + a.tail + ' to delete this aircraft and its data'); if (t && t.trim().toUpperCase() === a.tail.toUpperCase()) Store.deleteAircraft(id).then(function () { location.hash = '#edit'; }); };
  }

  return { squawk: squawk, editList: editList, editOne: editOne, settings: function () { PPASettings.view(); }, opt: opt, locOptions: locOptions, clone: clone };
})();
