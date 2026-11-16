/* Data layer: DEMO (this device, localStorage) or LIVE (Firebase Firestore, shared by every screen). */
var Store = (function () {
  var KEY = 'ppa-mb-demo-v1';
  var cfg = (window.PPA_CONFIG && window.PPA_CONFIG.firebaseConfig) || null;
  var st = { mode: cfg ? 'live' : 'demo', ready: false, settings: null, alerts: null, aircraft: [], squawks: [], closedSquawks: [], flightReports: [], priv: {}, roles: [], accessRequests: [], myAccessRequest: null,
    user: null, role: 'public', name: '', fromCache: false, error: '', reportsError: '', lastSync: null };
  var listeners = [];
  function emit() { st.lastSync = new Date(); listeners.forEach(function (f) { try { f(st); } catch (e) { console.error(e); } }); }
  function now() { return new Date().toISOString(); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function normEmail(e) { return String(e || '').trim().toLowerCase(); }

  // ---------------- DEMO ----------------
  function demoLoad() {
    var raw = null; try { raw = localStorage.getItem(KEY); } catch (e) {}
    var d = raw ? JSON.parse(raw) : PPASample.build();
    if (!raw) try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {}
    st.settings = d.settings; st.alerts = d.alerts; st.aircraft = d.aircraft; st.squawks = d.squawks; st.closedSquawks = d.closedSquawks || [];
    st.flightReports = d.flightReports || []; st.priv = d.priv || {}; st.roles = d.roles || []; st.accessRequests = d.accessRequests || []; st.myAccessRequest = null;
    var r = localStorage.getItem('ppa-mb-demo-role') || 'editor'; st.role = r; st.user = { email: 'demo@example.com' }; st.name = r === 'cfi' ? 'Demo CFI' : 'Demo Owner';
  }
  function demoSave() {
    localStorage.setItem(KEY, JSON.stringify({ settings: st.settings, alerts: st.alerts, aircraft: st.aircraft, squawks: st.squawks, closedSquawks: st.closedSquawks, flightReports: st.flightReports, priv: st.priv, roles: st.roles, accessRequests: st.accessRequests || [] }));
    emit();
  }

  // ---------------- LIVE (Firestore) ----------------
  var db = null, auth = null, unsubs = [], privUnsubs = [];
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); }; document.head.appendChild(s); }); }
  function liveInit() {
    var V = '10.12.2', base = 'https://www.gstatic.com/firebasejs/' + V + '/';
    return loadScript(base + 'firebase-app-compat.js')
      .then(function () { return Promise.all([loadScript(base + 'firebase-auth-compat.js'), loadScript(base + 'firebase-firestore-compat.js')]); })
      .then(function () {
        firebase.initializeApp(cfg);
        db = firebase.firestore(); auth = firebase.auth();
        var em = window.PPA_CONFIG.emulator; // local testing only
        if (em) { db.useEmulator(em.host || '127.0.0.1', em.firestore || 8089); auth.useEmulator('http://' + (em.host || '127.0.0.1') + ':' + (em.auth || 9099)); }
        return db.enablePersistence({ synchronizeTabs: true }).catch(function () {});
      })
      .then(function () {
        st.settings = st.settings || PPASample.build().settings; st.settings.locations = st.settings.locations || [];
        unsubs.push(db.doc('config/public').onSnapshot(function (s) { st.settingsSaved = s.exists && !s.metadata.fromCache ? true : (s.exists || st.settingsSaved); if (s.exists) st.settings = s.data(); else st.settings = emptySettings(); st.fromCache = s.metadata.fromCache; st.ready = true; emit(); }, err));
        unsubs.push(db.collection('aircraft').onSnapshot(function (q) { st.aircraft = q.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); st.fromCache = q.metadata.fromCache; emit(); }, err));
        unsubs.push(db.collection('squawks').where('status', '==', 'open').onSnapshot(function (q) { st.squawks = q.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); emit(); }, err));
        auth.onAuthStateChanged(function (u) {
          privUnsubs.forEach(function (f) { f(); }); privUnsubs = [];
          st.user = u ? { email: normEmail(u.email), uid: u.uid } : null; st.role = u ? 'checking' : 'public'; st.name = '';
          if (!u) { emit(); return; }
          emit();
          var roleRef = db.doc('roles/' + normEmail(u.email));
          var getRole = function (tries) { return roleRef.get({ source: 'server' }).catch(function (e) { if (tries > 0) return new Promise(function (res) { setTimeout(res, 1500); }).then(function () { return getRole(tries - 1); }); return roleRef.get(); }); };
          getRole(3).then(function (r) {
            st.role = r.exists ? (r.data().role || 'public') : 'none'; st.name = r.exists ? (r.data().name || '') : '';
            if (st.role === 'editor') {
              // first editor sign-in on a new project: save default lists/locations so every screen shares them
              db.doc('config/public').get({ source: 'server' }).then(function (d) { if (!d.exists) { var e = emptySettings(); e.updatedAt = now(); return db.doc('config/public').set(e); } }).catch(function () {});
              db.doc('config/alerts').get({ source: 'server' }).then(function (d) { if (!d.exists) return db.doc('config/alerts').set(emptyAlerts()); }).catch(function () {});
              privUnsubs.push(db.collection('aircraftPrivate').onSnapshot(function (q) { var p = {}; q.docs.forEach(function (d) { p[d.id] = d.data(); }); st.priv = p; emit(); }, err));
              privUnsubs.push(db.doc('config/alerts').onSnapshot(function (s) { st.alerts = s.exists ? s.data() : emptyAlerts(); emit(); }, err));
              privUnsubs.push(db.collection('roles').onSnapshot(function (q) { st.roles = q.docs.map(function (d) { return Object.assign({ email: d.id }, d.data()); }); emit(); }, err));
              privUnsubs.push(db.collection('squawks').where('status', '==', 'closed').onSnapshot(function (q) { st.closedSquawks = q.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); emit(); }, err));
              privUnsubs.push(db.collection('flightReports').onSnapshot(function (q) {
                st.flightReports = q.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
                st.reportsError = '';
                emit();
              }, function (e) {
                console.error(e);
                st.reportsError = (e && e.code) === 'permission-denied'
                  ? 'Post-flight reports are not available yet. Publish the new Firestore rules (firebase/firestore.rules) in the Firebase console, then refresh.'
                  : ((e && e.message) || String(e));
                emit();
              }));
              privUnsubs.push(db.collection('accessRequests').onSnapshot(function (q) {
                st.accessRequests = q.docs.map(function (d) { return Object.assign({ email: d.id }, d.data()); });
                emit();
              }, function (e) {
                console.error(e);
                st.accessRequests = st.accessRequests || [];
                emit();
              }));
            }
            privUnsubs.push(db.doc('accessRequests/' + normEmail(u.email)).onSnapshot(function (s) {
              st.myAccessRequest = s.exists ? Object.assign({ email: s.id }, s.data()) : null;
              emit();
            }, function () { st.myAccessRequest = null; emit(); }));
            emit();
          }).catch(function (e) { st.role = 'none'; err(e); });
        });
      })
      .catch(function (e) { err(e); });
  }
  function err(e) { console.error(e); st.error = (e && e.message) || String(e); emit(); }
  function emptySettings() { var s = PPASample.build().settings; s.locations = [{ id: 'kecp', code: 'KECP', name: 'Northwest Florida Beaches — Panama City' }, { id: 'kcew', code: 'KCEW', name: 'Bob Sikes — Crestview' }, { id: 'kdhn', code: 'KDHN', name: 'Dothan Regional — Dothan' }]; return s; }
  function emptyAlerts() { return { enabled: false, onGrounded: true, onDueSoon: true, onReturn: true, digest: false, digestHour: 7, recipients: [] }; }

  // ---------------- public API ----------------
  var api = {
    state: st,
    on: function (f) { listeners.push(f); },
    init: function () {
      if (st.mode === 'demo') {
        demoLoad(); st.ready = true;
        window.addEventListener('storage', function (e) { if (e.key === KEY) { demoLoad(); emit(); } });
        setTimeout(emit, 0); return Promise.resolve();
      }
      return liveInit();
    },
    can: function (what) {
      if (what === 'edit') return st.role === 'editor';
      if (what === 'squawk') return st.role === 'editor' || st.role === 'cfi';
      return true;
    },
    setDemoRole: function (r) { localStorage.setItem('ppa-mb-demo-role', r); st.role = r; st.name = r === 'cfi' ? 'Demo CFI' : 'Demo Owner'; emit(); },
    login: function (email, pw) { return auth.signInWithEmailAndPassword(email.trim(), pw); },
    logout: function () { return auth ? auth.signOut() : Promise.resolve(); },
    resetPassword: function (email) { return auth.sendPasswordResetEmail(email.trim()); },
    signupError: function (err) {
      var c = (err && err.code) || '';
      if (c === 'auth/operation-not-allowed' || c === 'auth/admin-restricted-operation') {
        return 'Sign-up is turned off in Firebase. An editor needs to turn it on: Firebase console → Authentication → Settings → User actions → enable “Enable create (sign-up)”.';
      }
      if (c === 'auth/email-already-in-use') return 'That email already has an account. Sign in, or use Forgot password.';
      if (c === 'auth/weak-password') return 'Password must be at least 6 characters.';
      if (c === 'auth/invalid-email') return 'That email doesn\'t look right.';
      return (err && err.message) || String(err || 'Could not create the account');
    },
    requestAccess: function (name, email, password) {
      var e = normEmail(email);
      var nm = String(name || '').trim().slice(0, 80);
      if (!nm) return Promise.reject(new Error('Name is required'));
      if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return Promise.reject(new Error('Enter a valid email'));
      var alreadyIn = (st.user && st.user.email === e) || (auth && auth.currentUser && normEmail(auth.currentUser.email) === e);
      if (!alreadyIn && (!password || String(password).length < 6)) return Promise.reject(new Error('Password must be at least 6 characters'));
      var doc = { name: nm, email: e, requestedAt: now(), status: 'pending' };
      if (st.mode === 'demo') {
        st.accessRequests = (st.accessRequests || []).filter(function (x) { return x.email !== e; });
        st.accessRequests.push(doc);
        st.user = { email: e }; st.role = 'none'; st.name = nm; st.myAccessRequest = doc;
        demoSave(); emit();
        return Promise.resolve(doc);
      }
      var signedInAs = auth.currentUser && normEmail(auth.currentUser.email) === e;
      var start = signedInAs ? Promise.resolve() : auth.createUserWithEmailAndPassword(e, password);
      return start.then(function () {
        return db.doc('accessRequests/' + e).set(doc);
      }).then(function () {
        st.myAccessRequest = doc; emit(); return doc;
      }).catch(function (err) {
        throw new Error(api.signupError(err));
      });
    },
    approveAccess: function (email, role) {
      var e = normEmail(email);
      var r = role === 'editor' ? 'editor' : 'cfi';
      var req = ((st.accessRequests || []).filter(function (x) { return x.email === e; })[0]) || st.myAccessRequest || {};
      var name = req.name || '';
      var reviewed = { status: 'approved', approvedRole: r, reviewedAt: now(), reviewedBy: (st.user && st.user.email) || '' };
      if (st.mode === 'demo') {
        st.roles = (st.roles || []).filter(function (x) { return x.email !== e; });
        st.roles.push({ email: e, role: r, name: name });
        st.accessRequests = (st.accessRequests || []).map(function (x) { return x.email === e ? Object.assign({}, x, reviewed) : x; });
        demoSave(); return Promise.resolve();
      }
      return db.doc('roles/' + e).set({ role: r, name: name }).then(function () {
        return db.doc('accessRequests/' + e).set({
          name: name, email: e, requestedAt: req.requestedAt || now(),
          status: 'approved', approvedRole: r, reviewedAt: reviewed.reviewedAt, reviewedBy: reviewed.reviewedBy
        }, { merge: true });
      });
    },
    denyAccess: function (email) {
      var e = normEmail(email);
      var req = ((st.accessRequests || []).filter(function (x) { return x.email === e; })[0]) || {};
      var reviewed = { status: 'denied', reviewedAt: now(), reviewedBy: (st.user && st.user.email) || '' };
      if (st.mode === 'demo') {
        st.accessRequests = (st.accessRequests || []).map(function (x) { return x.email === e ? Object.assign({}, x, reviewed) : x; });
        demoSave(); return Promise.resolve();
      }
      return db.doc('accessRequests/' + e).set({
        name: req.name || '', email: e, requestedAt: req.requestedAt || now(),
        status: 'denied', reviewedAt: reviewed.reviewedAt, reviewedBy: reviewed.reviewedBy
      }, { merge: true });
    },
    pendingAccessCount: function () {
      return (st.accessRequests || []).filter(function (x) { return x.status === 'pending'; }).length;
    },

    saveAircraft: function (a) {
      a = clone(a); if (window.PPAStatus && PPAStatus.syncMeters) PPAStatus.syncMeters(a); a.updatedAt = now(); delete a._priv;
      if (st.mode === 'demo') { var i = st.aircraft.findIndex(function (x) { return x.id === a.id; }); if (i >= 0) st.aircraft[i] = a; else st.aircraft.push(a); demoSave(); return Promise.resolve(a); }
      var id = a.id; delete a.id; return db.doc('aircraft/' + id).set(a).then(function () { a.id = id; return a; });
    },
    deleteAircraft: function (id) {
      if (st.mode === 'demo') { st.aircraft = st.aircraft.filter(function (x) { return x.id !== id; }); delete st.priv[id]; st.squawks = st.squawks.filter(function (s) { return s.aircraftId !== id; }); st.flightReports = (st.flightReports || []).filter(function (r) { return r.aircraftId !== id; }); demoSave(); return Promise.resolve(); }
      return Promise.all([db.doc('aircraft/' + id).delete(), db.doc('aircraftPrivate/' + id).delete()]);
    },
    savePrivate: function (id, data) {
      if (st.mode === 'demo') { st.priv[id] = Object.assign({}, st.priv[id], data); demoSave(); return Promise.resolve(); }
      return db.doc('aircraftPrivate/' + id).set(data, { merge: true });
    },
    addSquawk: function (s) {
      var doc = { aircraftId: s.aircraftId, tail: s.tail, text: String(s.text).slice(0, 500), severity: s.severity, grounding: s.severity === 'grounding',
        status: 'open', reportedBy: String(s.reportedBy || '').slice(0, 80), createdAt: now() };
      if (st.mode === 'demo') { doc.id = PPASample.uid(); st.squawks.push(doc); demoSave(); return Promise.resolve(doc); }
      return db.collection('squawks').add(doc);
    },
    addFlightReport: function (s) {
      var oilAdded = !!s.oilAdded;
      var doc = {
        aircraftId: s.aircraftId, tail: s.tail,
        reporterEmail: String(s.reporterEmail || (st.user && st.user.email) || (st.mode === 'demo' ? 'demo@example.com' : '')).trim().toLowerCase(),
        reportedBy: String(s.reportedBy || '').slice(0, 80),
        student: String(s.student || '').slice(0, 80),
        oilAdded: oilAdded, oilQts: oilAdded ? Number(s.oilQts) : null,
        tachStart: s.tachStart == null || s.tachStart === '' ? null : Number(s.tachStart),
        tachEnd: s.tachEnd == null || s.tachEnd === '' ? null : Number(s.tachEnd),
        hobbsStart: s.hobbsStart == null || s.hobbsStart === '' ? null : Number(s.hobbsStart),
        hobbsEnd: s.hobbsEnd == null || s.hobbsEnd === '' ? null : Number(s.hobbsEnd),
        createdAt: now(), applied: false
      };
      if (st.mode === 'demo') { doc.id = PPASample.uid(); st.flightReports = st.flightReports || []; st.flightReports.unshift(doc); demoSave(); return Promise.resolve(doc); }
      return db.collection('flightReports').add(doc).then(function (ref) { doc.id = ref.id; return doc; });
    },
    markReportSheetSent: function (id) {
      if (st.mode === 'demo') {
        (st.flightReports || []).forEach(function (r) { if (r.id === id) r.sheetSent = true; });
        demoSave(); return Promise.resolve();
      }
      return db.doc('flightReports/' + id).update({ sheetSent: true });
    },
    sendFlightLogToSheet: function (report, extra) {
      extra = extra || {};
      var url = ((st.settings && st.settings.flightLogSheetUrl) || '').trim();
      var token = ((st.settings && st.settings.flightLogSheetToken) || '').trim();
      if (!url) return Promise.resolve({ skipped: true });
      var payload = PPAStatus.flightLogSheetPayload(report, {
        token: token,
        location: extra.location || '',
        squawkText: extra.squawkText || '',
        tachPhoto: extra.tachPhoto || '',
        hobbsPhoto: extra.hobbsPhoto || ''
      });
      var body = JSON.stringify(payload);
      // Apps Script web-app POSTs are capped around 50 MB; keep a tighter cap so a pair of JPEGs stays practical.
      if (body.length > 8 * 1024 * 1024) return Promise.resolve({ sent: false, error: 'The meter photos are too large to send to the Sheet. The report is still saved on the board.' });
      return fetch(url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body })
        .then(function () { return { sent: true }; })
        .catch(function (e) { return { sent: false, error: (e && e.message) || String(e) }; });
    },
    isDenied: function (e) {
      if (!e) return false;
      var c = e.code || e.name || '';
      return c === 'permission-denied' || /permission[- ]denied/i.test(String(e.message || e));
    },
    updateSquawk: function (s) {
      s = clone(s); s.grounding = s.severity === 'grounding';
      if (st.mode === 'demo') {
        st.squawks = st.squawks.filter(function (x) { return x.id !== s.id; }); st.closedSquawks = (st.closedSquawks || []).filter(function (x) { return x.id !== s.id; });
        if (s.status === 'open') st.squawks.push(s); else st.closedSquawks.unshift(s);
        st.closedSquawks = st.closedSquawks.slice(0, 200); demoSave(); return Promise.resolve();
      }
      var id = s.id; delete s.id; return db.doc('squawks/' + id).set(s);
    },
    saveSettings: function (s) {
      s = clone(s); s.updatedAt = now();
      if (st.mode === 'demo') { st.settings = s; demoSave(); return Promise.resolve(); }
      return db.doc('config/public').set(s);
    },
    saveAlerts: function (a) {
      a = clone(a);
      if (st.mode === 'demo') { st.alerts = a; demoSave(); return Promise.resolve(); }
      return db.doc('config/alerts').set(a);
    },
    saveRole: function (r) {
      var e = normEmail(r.email); if (!e) return Promise.reject(new Error('Email required'));
      if (st.mode === 'demo') { st.roles = st.roles.filter(function (x) { return x.email !== e; }); st.roles.push({ email: e, role: r.role, name: r.name || '' }); demoSave(); return Promise.resolve(); }
      return db.doc('roles/' + e).set({ role: r.role, name: r.name || '' });
    },
    deleteRole: function (email) {
      if (st.mode === 'demo') { st.roles = st.roles.filter(function (x) { return x.email !== email; }); demoSave(); return Promise.resolve(); }
      return db.doc('roles/' + email).delete();
    },
    resetDemo: function () { localStorage.removeItem(KEY); demoLoad(); emit(); },
    clearDemo: function () { var d = PPASample.build(); d.aircraft = []; d.squawks = []; d.flightReports = []; d.priv = {}; localStorage.setItem(KEY, JSON.stringify(d)); demoLoad(); emit(); },
    lastUpdated: function () {
      var t = [];
      st.aircraft.forEach(function (a) { if (a.updatedAt) t.push(a.updatedAt); });
      st.squawks.forEach(function (s) { if (s.createdAt) t.push(s.createdAt); });
      (st.flightReports || []).forEach(function (r) { if (r.createdAt) t.push(r.createdAt); });
      if (st.settings && st.settings.updatedAt) t.push(st.settings.updatedAt);
      t.sort(); return t.length ? new Date(t[t.length - 1]) : null;
    }
  };
  return api;
})();
