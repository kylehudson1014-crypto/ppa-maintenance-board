/* PPA Maintenance Board — UI. Tracking aid only; the aircraft logbooks are the legal record. */
(function () {
  var S = PPAStatus, st = Store.state, app = document.getElementById('app');
  var DISCLAIMER = 'Tracking aid only. The aircraft maintenance logbooks are the legal record of airworthiness. Pilot in command makes the final airworthiness determination (14 CFR 91.7).';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function toast(msg, bad) { var t = document.createElement('div'); t.className = 'toast' + (bad ? ' err' : ''); t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.style.opacity = 0; }, 1600); setTimeout(function () { t.remove(); }, 2000); }
  function remember(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem('ppa-mb-' + k)); localStorage.setItem('ppa-mb-' + k, JSON.stringify(v)); } catch (e) { return null; } }
  function locById(id) { return (st.settings.locations || []).filter(function (l) { return l.id === id; })[0]; }
  function locCode(id) { var l = locById(id); return l ? l.code : '—'; }
  function evalAll() { var m = {}; st.aircraft.forEach(function (a) { m[a.id] = S.evaluate(a, st.settings, st.squawks); }); return m; }
  var ORDER = { grounded: 0, due: 1, ok: 2 };
  function sorted(list, ev, mode) {
    mode = mode || 'status';
    return list.slice().sort(function (a, b) {
      if (mode === 'status') { var d = ORDER[ev[a.id].overall] - ORDER[ev[b.id].overall]; if (d) return d; }
      if (mode === 'location') { var l = locCode(a.location).localeCompare(locCode(b.location)); if (l) return l; }
      if (mode === 'custom') { var o = (a.order || 0) - (b.order || 0); if (o) return o; }
      return String(a.tail).localeCompare(String(b.tail));
    });
  }
  var LABEL = { grounded: 'GROUNDED', due: 'DUE SOON', ok: 'AIRWORTHY' };
  function counts(ev, list) { var c = { ok: 0, due: 0, grounded: 0 }; list.forEach(function (a) { c[ev[a.id].overall]++; }); return c; }
  function sumChips(c) { return '<div class="sum"><span class="chip s-ok">● ' + c.ok + ' AIRWORTHY</span><span class="chip s-due">● ' + c.due + ' DUE SOON</span><span class="chip s-grounded">● ' + c.grounded + ' GROUNDED</span></div>'; }
  function noteText(a) {
    var n = a.statusNote || '';
    if (a.expectedBack) { var d = S.daysBetween(S.todayStr(), a.expectedBack); var wd = new Date(a.expectedBack + 'T12:00:00'); var lab = d === 0 ? 'today' : d === 1 ? 'tomorrow' : wd.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); if (d >= 0) n = (n ? n + ' · ' : '') + 'Back in service ' + lab; }
    return n;
  }
  function relTime(d) { if (!d) return 'never'; var s = Math.round((Date.now() - d.getTime()) / 1000); if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return d.toLocaleDateString(); }

  // ---------- tile (TV + customer) ----------
  function tileHTML(a, e, opt) {
    opt = opt || {};
    var sq = e.openSquawks ? '<span class="' + (e.groundingSquawks ? 'bad' : 'warn') + '">⚑ ' + e.openSquawks + ' squawk' + (e.openSquawks > 1 ? 's' : '') + (e.groundingSquawks ? ' (' + e.groundingSquawks + ' grounding)' : '') + '</span>' : '<span>✓ No open squawks</span>';
    var h = e.hundred;
    var hund = h && h.state !== 'na' ? '<span class="' + (h.state === 'over' ? 'bad' : h.state === 'due' ? 'warn' : '') + '">100-hr: ' + esc(h.value) + (h.state === 'over' ? '' : ' left') + '</span>' : '';
    var hrs = '<span>Tach ' + S.hoursLabel(S.meterReading(a, 'tach')) + ' · Hobbs ' + S.hoursLabel(S.meterReading(a, 'hobbs')) + '</span>';
    var stale = e.hoursStale ? '<span class="warn">⏱ ' + esc(S.meterOf(a)) + ' ' + e.staleDays + 'd old</span>' : '';
    var why = e.reasons.length ? '<div class="why">' + esc(e.reasons.slice(0, 3).join(' · ')) + '</div>' : '';
    var note = noteText(a);
    var sqText = '';
    if (opt.squawkText && e.squawkList.length) sqText = '<div class="why" style="color:#d8e3f4">' + e.squawkList.slice(0, 2).map(function (s) { return (s.grounding ? '⛔ ' : '• ') + esc(s.text); }).join('<br>') + '</div>';
    return '<div class="tile s-' + e.overall + '" data-id="' + a.id + '">' +
      '<div class="hd"><span class="tail">' + esc(a.tail) + '</span><span class="ostat s-' + e.overall + '">' + LABEL[e.overall] + '</span><span class="loc">' + esc(locCode(a.location)) + '</span></div>' +
      '<div class="type">' + esc(a.type || '') + (a.ifr === false ? ' · VFR only' : ' · IFR') + '</div>' + why +
      '<div class="pills">' + e.items.map(function (i) { return '<div class="pill s-' + i.state + '" title="' + esc(i.label + ': ' + i.detail) + '"><b>' + i.letter + '</b><span>' + esc(i.value) + '</span></div>'; }).join('') + '</div>' +
      '<div class="meta">' + hrs + hund + sq + stale + '</div>' + (opt.squawkText && !e.groundingSquawks ? sqText : '') +
      (note ? '<div class="note">' + esc(note) + '</div>' : '') + (a.sample ? '<div class="samp">SAMPLE</div>' : '') + '</div>';
  }
  function topbar(title, sub) {
    var r = location.hash.split('/')[0] || '#';
    function n(h, t) { return '<a href="' + h + '" class="' + (r === h ? 'on' : '') + '">' + t + '</a>'; }
    var who = st.mode === 'live' ? (st.user ? esc(st.user.email) + ' · ' + esc(st.role) + ' <a href="#logout">Sign out</a>' : '<a href="#login">Staff sign in</a>') : 'DEMO mode';
    return '<div class="topbar"><div class="logo-plate"><img src="img/ppa-logo.png" alt="Patriot Pilot Academy"></div><div><h1>' + esc(title) + '</h1><div class="sub">' + (sub || 'Patriot Pilot Academy · Maintenance Board') + '</div></div><div class="sp"></div>' +
      (st.mode === 'live' && !Store.can('squawk') ? '<nav class="nav row">' + n('#board', 'Fleet') + (st.user ? '' : n('#login', 'Staff sign in')) + '</nav>' :
      st.mode === 'live' && !Store.can('edit') ? '<nav class="nav row">' + n('#board', 'Fleet') + n('#squawk', 'Report') + '</nav>' :
      '<nav class="nav row">' + n('#board', 'Fleet') + n('#squawk', 'Report') + n('#edit', 'Edit') + n('#settings', 'Settings' + (Store.can('edit') && Store.pendingAccessCount() ? ' <span class="reqbadge">' + Store.pendingAccessCount() + '</span>' : '')) + n('#tv', 'TV') + '</nav>') + '<div class="sub who">' + who + '</div></div>';
  }
  function demoBanner() {
    if (st.mode !== 'demo') return st.error ? '<div class="banner red">Connection problem: ' + esc(st.error) + '</div>' : '';
    return '<div class="banner">DEMO MODE — SAMPLE aircraft, not PPA\'s real fleet. Changes save on this device only, so the TV and phones don\'t share data until the free Firebase project is connected (see Settings → Go live).</div>';
  }

  // ---------- HOME ----------
  function viewHome() {
    app.innerHTML = topbar('Maintenance Board') + '<div class="wrap">' + demoBanner() +
      '<div class="home">' +
      '<a href="#tv"><b>📺 TV display</b><span>Full-screen board for the lobby or dispatch. Auto-refresh, no controls.</span></a>' +
      '<a href="#board"><b>📱 Fleet status</b><span>Read-only view for customers, renters and CFIs.</span></a>' +
      '<a href="#squawk"><b>⚑ Post-flight report</b><span>Oil, Tach/Hobbs, and an optional squawk. Any CFI.</span></a>' +
      '<a href="#edit"><b>🔧 Edit fleet</b><span>Owner and mechanic: update hours, mark items done, clear squawks.</span></a>' +
      '<a href="#settings"><b>⚙️ Settings</b><span>Locations, lists, due thresholds, alerts, CSV import/export.</span></a>' +
      '</div><p class="disclaimer">' + DISCLAIMER + '</p></div>';
  }

  // ---------- TV ----------
  var tvTimer = null, tvPage = 0, tvClock = null;
  function tvParams() { var q = (location.hash.split('?')[1] || ''); var p = {}; q.split('&').forEach(function (kv) { if (kv) { var x = kv.split('='); p[decodeURIComponent(x[0])] = decodeURIComponent(x[1] || ''); } }); return p; }
  function viewTV() {
    document.body.classList.add('tv');
    var p = tvParams(), tv = st.settings.tv || {}, ev = evalAll();
    var list = st.aircraft.filter(function (a) { return !p.loc || locCode(a.location).toLowerCase() === p.loc.toLowerCase() || a.location === p.loc; });
    list = sorted(list, ev, tv.sort || 'status');
    var W = window.innerWidth - 36, H = window.innerHeight - 92 - 34 - 24, n = Math.max(1, list.length), GAP = 12;
    var best = null;
    for (var cc = 2; cc <= 6; cc++) {
      var rr = Math.ceil(n / cc), th = (H - GAP * (rr - 1)) / rr, tw = (W - GAP * (cc - 1)) / cc;
      if (th < 190 || tw < 320) continue;
      var k = Math.min(tw / 340, th / 200);
      if (!best || k > best.k) best = { cols: cc, rows: rr, k: k, th: th };
    }
    var cols, rows, per, tileH, scale;
    if (best) { cols = best.cols; rows = best.rows; per = n; tileH = best.th; scale = Math.min(1.7, Math.max(1, best.k)); }
    else { cols = W >= 1700 ? 5 : W >= 1300 ? 4 : W >= 900 ? 3 : 2; rows = Math.max(1, Math.floor((H + GAP) / (200 + GAP))); per = cols * rows; tileH = (H - GAP * (rows - 1)) / rows; scale = 1; }
    var pages = Math.max(1, Math.ceil(list.length / per));
    if (tvPage >= pages) tvPage = 0;
    var show = list.slice(tvPage * per, tvPage * per + per);
    var c = counts(ev, list), lu = Store.lastUpdated();
    var locName = p.loc ? (locById((st.settings.locations || []).filter(function (l) { return l.code.toLowerCase() === p.loc.toLowerCase(); }).map(function (l) { return l.id; })[0]) || {}).name : '';
    app.innerHTML = (tv.watermark !== false ? '<div class="wm"></div>' : '') +
      '<div class="tvhead">' + (tv.logo !== false ? '<div class="logo-plate"><img src="img/ppa-logo.png" alt="Patriot Pilot Academy"></div>' : '') +
      '<div><h1>FLEET MAINTENANCE STATUS' + (p.loc ? ' · ' + esc(p.loc.toUpperCase()) : '') + '</h1><div class="sub">' + esc(locName || 'All locations') + ' · A 1 A T E D' + (st.mode === 'demo' ? ' · <b style="color:#ffcf5a">SAMPLE DATA — DEMO</b>' : '') + '</div></div>' +
      sumChips(c) + '<div class="tvclock"><div class="t" id="tvclock"></div><div class="u" id="tvupd"></div></div></div>' +
      '<div class="tvgrid" style="--k:' + scale.toFixed(2) + ';grid-template-columns:repeat(' + cols + ',1fr);grid-template-rows:repeat(' + rows + ',' + Math.floor(tileH) + 'px)">' + (show.map(function (a) { return tileHTML(a, ev[a.id], { squawkText: tv.showSquawkText !== false }); }).join('') || '<div class="card">No aircraft yet. Add them in Edit.</div>') + '</div>' +
      '<div class="tvfoot"><span class="legend"><span class="chip s-ok">current</span><span class="chip s-due">coming due</span><span class="chip s-over">overdue</span><span class="chip s-na">N/A</span></span><span><b>A</b>nnual · <b>1</b>00-hr · <b>A</b>ltimeter/pitot · <b>T</b>ransponder · <b>E</b>LT · A<b>D</b>s + 50-hr oil</span><span>Tracking aid only — aircraft logbooks are the legal record.</span><span class="dots">' + (pages > 1 ? 'Page ' + (tvPage + 1) + ' / ' + pages : '') + '</span></div>';
    function tick() {
      var el = $('#tvclock'); if (!el) return;
      var d = new Date(); el.textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      var off = (st.mode === 'live' && (st.fromCache || !navigator.onLine));
      $('#tvupd').innerHTML = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ' · Updated ' + relTime(Store.lastUpdated()) + (off ? ' · <b style="color:#ffb300">OFFLINE — showing saved data</b>' : '');
    }
    tick(); clearInterval(tvClock); tvClock = setInterval(tick, 15000);
    clearTimeout(tvTimer);
    if (pages > 1) tvTimer = setTimeout(function () { tvPage = (tvPage + 1) % pages; render(); }, (Number(tv.pageSeconds) || 15) * 1000);
  }
  // reload TV every 6 hours to pick up app updates; re-evaluate dates at least every 10 minutes
  setInterval(function () { if (location.hash.indexOf('#tv') === 0) render(); }, 600000);
  setInterval(function () { if (location.hash.indexOf('#tv') === 0 && navigator.onLine) location.reload(); }, 6 * 3600000);
  window.addEventListener('resize', function () { if (location.hash.indexOf('#tv') === 0) render(); });

  // ---------- CUSTOMER / FLEET VIEW ----------
  function viewBoard() {
    var ev = evalAll(), f = remember('boardLoc') || '';
    var list = sorted(st.aircraft.filter(function (a) { return !f || a.location === f; }), ev, 'status');
    var c = counts(ev, list);
    app.innerHTML = topbar('Fleet status', 'Read-only · tap a plane for details') + '<div class="wrap">' + demoBanner() + sumChips(c) +
      '<div class="chips" id="locs"><button data-l="" class="' + (!f ? 'on' : '') + '">All</button>' + (st.settings.locations || []).map(function (l) { return '<button data-l="' + l.id + '" class="' + (f === l.id ? 'on' : '') + '">' + esc(l.code) + '</button>'; }).join('') + '</div>' +
      '<div class="grid">' + list.map(function (a) { return tileHTML(a, ev[a.id], { squawkText: (st.settings.public || {}).showSquawkText !== false }); }).join('') + '</div>' +
      '<p class="disclaimer">' + DISCLAIMER + '<br>Updated ' + relTime(Store.lastUpdated()) + '</p></div>';
    $$('#locs button').forEach(function (b) { b.onclick = function () { remember('boardLoc', b.dataset.l); render(); }; });
    $$('.tile').forEach(function (t) { t.onclick = function () { detailSheet(t.dataset.id, ev); }; });
  }
  function detailSheet(id, ev) {
    var a = st.aircraft.filter(function (x) { return x.id === id; })[0], e = ev[id]; if (!a) return;
    var showSq = (st.settings.public || {}).showSquawkText !== false;
    var d = document.createElement('div'); d.className = 'sheet';
    d.innerHTML = '<div class="in"><div class="row"><h2 style="margin:0;font-size:24px">' + esc(a.tail) + '</h2><span class="ostat s-' + e.overall + '">' + LABEL[e.overall] + '</span><span class="sp" style="flex:1"></span><button class="btn sm" id="x">Close</button></div>' +
      '<p class="sub" style="color:var(--mute)">' + esc(a.type) + ' · ' + esc((locById(a.location) || {}).name || '') + '</p>' +
      '<p class="sub" style="color:#d3def0">Tach ' + S.hoursLabel(S.meterReading(a, 'tach')) + (S.meterUpdated(a, 'tach') ? ' (' + S.niceDate(S.meterUpdated(a, 'tach')) + ')' : '') + ' · Hobbs ' + S.hoursLabel(S.meterReading(a, 'hobbs')) + (S.meterUpdated(a, 'hobbs') ? ' (' + S.niceDate(S.meterUpdated(a, 'hobbs')) + ')' : '') + '</p>' +
      (e.reasons.length ? '<div class="banner ' + (e.overall === 'grounded' ? 'red' : '') + '">' + esc(e.reasons.join(' · ')) + '</div>' : '') +
      (noteText(a) ? '<div class="note" style="margin-bottom:10px">' + esc(noteText(a)) + '</div>' : '') +
      '<div class="kv">' + e.items.map(function (i) { return '<div class="l s-' + i.state + '"><b>' + i.letter + '</b>' + esc(i.label) + '</div><div style="color:#cfdcf0">' + esc(i.detail.split(' (The 10-hr')[0]) + '</div><span class="chip s-' + i.state + '">' + esc(i.value) + '</span>'; }).join('') + '</div>' +
      '<h3>Open squawks (' + e.openSquawks + ')</h3>' + (e.squawkList.length ? (showSq ? e.squawkList.map(function (s) { return '<div class="li">' + (s.grounding ? '⛔ <b>GROUNDING</b> ' : s.severity === 'info' ? 'ℹ️ ' : '⚑ ') + esc(s.text) + '</div>'; }).join('') : '<p>' + e.openSquawks + ' open') : '<p>None</p>') +
      '<p class="disclaimer">' + DISCLAIMER + '</p></div>';
    document.body.appendChild(d);
    d.onclick = function (x) { if (x.target === d || x.target.id === 'x') d.remove(); };
  }

  // ---------- LOGIN ----------
  function viewLogin() {
    var requesting = (location.hash.split('?')[0] === '#request');
    if (st.mode === 'demo' && !requesting && location.hash.split('?')[0] !== '#login') { location.hash = '#edit'; return; }
    if (!requesting) {
      app.innerHTML = topbar('Staff sign in') + '<div class="wrap" style="max-width:460px">' + (st.mode === 'demo' ? demoBanner() : '') + '<div class="card"><h2>Sign in</h2>' +
        '<label class="f">Email<input type="email" id="em" autocomplete="username" value="' + esc(remember('lastEmail') || '') + '"></label><br>' +
        '<label class="f">Password<input type="password" id="pw" autocomplete="current-password"></label><br>' +
        '<button class="btn pri big" id="go">Sign in</button><p><a href="#" id="fp">Forgot password?</a></p>' +
        '<p><a class="btn big" href="#request">Request access</a></p>' +
        '<p class="sub" style="color:var(--mute)">CFIs can request a login here. An editor approves it under Settings → People &amp; roles. Customers don\'t need to sign in. Use <a href="#board">Fleet status</a>.</p></div></div>';
      $('#go').onclick = function () { var em = $('#em').value; remember('lastEmail', em); Store.login(em, $('#pw').value).then(function () { location.hash = remember('afterLogin') || '#edit'; }).catch(function (e) { toast(e.message, true); }); };
      $('#pw').onkeydown = function (k) { if (k.key === 'Enter') $('#go').click(); };
      if ($('#fp')) $('#fp').onclick = function (x) { x.preventDefault(); if (st.mode === 'demo') { toast('Password reset is only used in live mode'); return; } Store.resetPassword($('#em').value).then(function () { toast('Reset email sent'); }).catch(function (e) { toast(e.message, true); }); };
      return;
    }
    app.innerHTML = topbar('Request access') + '<div class="wrap" style="max-width:460px">' + (st.mode === 'demo' ? demoBanner() : '') + '<div class="card"><h2>Request access</h2>' +
      '<p class="sub" style="color:var(--mute)">Create a login. An editor (Kyle or Chad) will approve you as a CFI or editor. Customers don\'t need a login — use <a href="#board">Fleet status</a>.</p>' +
      '<label class="f">Name<input type="text" id="rn" autocomplete="name" maxlength="80" placeholder="Your name"></label><br>' +
      '<label class="f">Email<input type="email" id="em" autocomplete="username" value="' + esc(remember('lastEmail') || '') + '"></label><br>' +
      '<label class="f">Password<input type="password" id="pw" autocomplete="new-password" minlength="6" placeholder="At least 6 characters"></label><br>' +
      '<label class="f">Confirm password<input type="password" id="pw2" autocomplete="new-password"></label><br>' +
      '<button class="btn pri big" id="reqgo">Request access</button>' +
      '<p><a href="#login">Already have an account? Sign in</a></p></div></div>';
    function submitReq() {
      var name = ($('#rn').value || '').trim(), em = ($('#em').value || '').trim(), pw = $('#pw').value || '', pw2 = $('#pw2').value || '';
      if (!name) return toast('Enter your name', true);
      if (pw !== pw2) return toast('The passwords don\'t match', true);
      remember('lastEmail', em);
      Store.requestAccess(name, em, pw).then(function () { location.hash = remember('afterLogin') || '#edit'; }).catch(function (e) { toast(e.message, true); });
    }
    $('#reqgo').onclick = submitReq;
    $('#pw2').onkeydown = function (k) { if (k.key === 'Enter') submitReq(); };
  }
  function needRole(what, route) {
    if (Store.can(what)) return false;
    if (st.mode === 'live' && st.user && st.role === 'checking') { app.innerHTML = topbar('Signing in') + '<div class="wrap"><div class="card"><h2>Checking your access…</h2></div></div>'; return true; }
    var req = st.myAccessRequest || ((st.accessRequests || []).filter(function (x) { return st.user && x.email === st.user.email; })[0]);
    if (st.user && st.role !== 'checking' && req && (req.status === 'pending' || req.status === 'denied')) {
      if (req.status === 'pending') {
        app.innerHTML = topbar('Request pending') + '<div class="wrap" style="max-width:520px">' + (st.mode === 'demo' ? demoBanner() : '') +
          '<div class="card"><h2>Your request is pending approval</h2>' +
          '<p>Thanks, ' + esc(req.name || st.name || st.user.email) + '. An editor will approve your access under Settings → People &amp; roles. You can close this page and sign in again later.</p>' +
          '<p class="sub" style="color:var(--mute)">Signed in as ' + esc(st.user.email) + '.</p>' +
          (st.mode === 'demo' ? '<button class="btn" id="be">Return to demo as Owner / Mechanic</button> ' : '') +
          '<a class="btn" href="#logout">Sign out</a></div></div>';
      } else {
        app.innerHTML = topbar('Request denied') + '<div class="wrap" style="max-width:520px">' + (st.mode === 'demo' ? demoBanner() : '') +
          '<div class="card"><h2>Your request was denied</h2>' +
          '<p>The account ' + esc(st.user.email) + ' was not approved. Ask the owner if you need access.</p>' +
          (st.mode === 'demo' ? '<button class="btn" id="be">Return to demo as Owner / Mechanic</button> ' : '') +
          '<a class="btn" href="#logout">Sign out</a></div></div>';
      }
      if ($('#be')) $('#be').onclick = function () { Store.setDemoRole('editor'); location.hash = '#settings'; };
      return true;
    }
    if (st.mode === 'demo') {
      app.innerHTML = topbar('Demo') + '<div class="wrap">' + demoBanner() + '<div class="card"><h2>You are viewing the demo as: ' + esc(st.role.toUpperCase()) + '</h2><p>CFIs can only report squawks. Switch the demo role to try other screens.</p><button class="btn pri" id="be">Demo as Owner / Mechanic</button></div></div>';
      $('#be').onclick = function () { Store.setDemoRole('editor'); }; return true;
    }
    remember('afterLogin', route);
    if (!st.user) { location.hash = '#login'; return true; }
    app.innerHTML = topbar('No access') + '<div class="wrap" style="max-width:520px"><div class="card"><h2>Your account (' + esc(st.user.email) + ') doesn\'t have access to this screen.</h2><p>You can request access here. An editor will approve you under Settings → People &amp; roles.</p><button class="btn pri" id="reqnow">Request access</button> <a class="btn" href="#logout">Sign out</a></div></div>';
    if ($('#reqnow')) $('#reqnow').onclick = function () {
      var nm = st.name || (st.user.email || '').split('@')[0];
      Store.requestAccess(nm, st.user.email, '').then(function () { window.PPAUI.render(true); }).catch(function (e) { toast(e.message, true); });
    };
    return true;
  }

  // export helpers for part 2
  window.PPAUI = { esc: esc, $: $, $$: $$, toast: toast, remember: remember, locById: locById, locCode: locCode, evalAll: evalAll, sorted: sorted, LABEL: LABEL, counts: counts, sumChips: sumChips,
    topbar: topbar, demoBanner: demoBanner, needRole: needRole, noteText: noteText, tileHTML: tileHTML, DISCLAIMER: DISCLAIMER, relTime: relTime };

  // ---------- router ----------
  var lastRoute = '';
  function render(force) {
    var h = location.hash || '#';
    var route = h.split('?')[0];
    if (!st.ready || !st.settings) { app.innerHTML = '<div class="wrap"><p>Loading…</p></div>'; return; }
    // don't clobber a form while someone is typing (live updates arrive in background)
    var ae = document.activeElement;
    if (!force && route === lastRoute && ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName) && !/#tv|#board/.test(route)) return;
    if (route !== lastRoute) { window.scrollTo(0, 0); $$('.sheet').forEach(function (x) { x.remove(); }); }
    var y = window.scrollY;
    var same = route === lastRoute; lastRoute = route;
    if (route.indexOf('#tv') !== 0) { document.body.classList.remove('tv'); clearTimeout(tvTimer); clearInterval(tvClock); }
    if (route === '#logout') { Store.logout().then(function () { location.hash = '#board'; }); return; }
    if (route.indexOf('#tv') === 0) viewTV();
    else if (route === '#board') viewBoard();
    else if (route === '#login' || route === '#request') viewLogin();
    else if (route === '#squawk') PPAViews.squawk();
    else if (route === '#edit') { if (!needRole('edit', route)) PPAViews.editList(); }
    else if (route.indexOf('#edit/') === 0) { if (!needRole('edit', route)) PPAViews.editOne(route.slice(6)); }
    else if (route === '#settings') { if (!needRole('edit', route)) PPAViews.settings(); }
    else viewHome();
    if (same) window.scrollTo(0, y);
  }
  window.PPAUI.render = render;
  window.addEventListener('hashchange', function () { render(true); });
  var rt = null, ptrDown = false;
  document.addEventListener('pointerdown', function () { ptrDown = true; }, true);
  document.addEventListener('pointerup', function () { setTimeout(function () { ptrDown = false; }, 50); }, true);
  function soon() { clearTimeout(rt); rt = setTimeout(function () { if (ptrDown) return soon(); render(false); }, 250); }
  Store.on(soon);
  function previewBar() {
    if (!Store.preview || document.getElementById('previewbar')) return;
    document.title = 'TEST · ' + document.title;
    var b = document.createElement('div'); b.id = 'previewbar'; b.className = 'previewbar';
    b.innerHTML = '<b>🧪 TEST / PREVIEW</b> <span>Real fleet data, read-only. Edits and reports here are <b>NOT saved</b> to the live board or the Flight Log Sheet (kept on this device only).</span> <button type="button" id="pvreset">Reset test changes</button> <a href="https://kylehudson1014-crypto.github.io/ppa-maintenance-board/">Live board ↗</a>';
    document.body.insertBefore(b, document.body.firstChild);
    document.getElementById('pvreset').onclick = function () { if (confirm('Throw away all test changes on this device?')) Store.resetPreview(); };
  }
  document.addEventListener('DOMContentLoaded', function () { previewBar(); Store.init().then(function () { render(true); }); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
})();
