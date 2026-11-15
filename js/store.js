/* Data layer: DEMO (this device, localStorage) or LIVE (Firebase Firestore, shared by every screen). */
var Store = (function () {
  var KEY = 'ppa-mb-demo-v1';
  var cfg = (window.PPA_CONFIG && window.PPA_CONFIG.firebaseConfig) || null;
  var st = { mode: cfg ? 'live' : 'demo', ready: false, settings: null, alerts: null, aircraft: [], squawks: [], closedSquawks: [], priv: {}, roles: [],
    user: null, role: 'public', name: '', fromCache: false, error: '', lastSync: null };
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
    st.priv = d.priv || {}; st.roles = d.roles || [];
    var r = localStorage.getItem('ppa-mb-demo-role') || 'editor'; st.role = r; st.user = { email: 'demo@example.com' }; st.name = r === 'cfi' ? 'Demo CFI' : 'Demo Owner';
  }
  function demoSave() {
    localStorage.setItem(KEY, JSON.stringify({ settings: st.settings, alerts: st.alerts, aircraft: st.aircraft, squawks: st.squawks, closedSquawks: st.closedSquawks, priv: st.priv, roles: st.roles }));
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
          st.user = u ? { email: normEmail(u.email), uid: u.uid } : null; st.role = 'public'; st.name = '';
          if (!u) { emit(); return; }
          db.doc('roles/' + normEmail(u.email)).get().then(function (r) {
            st.role = r.exists ? (r.data().role || 'public') : 'none'; st.name = r.exists ? (r.data().name || '') : '';
            if (st.role === 'editor') {
              // first editor sign-in on a new project: save default lists/locations so every screen shares them
              db.doc('config/public').get({ source: 'server' }).then(function (d) { if (!d.exists) { var e = emptySettings(); e.updatedAt = now(); return db.doc('config/public').set(e); } }).catch(function () {});
              db.doc('config/alerts').get({ source: 'server' }).then(function (d) { if (!d.exists) return db.doc('config/alerts').set(emptyAlerts()); }).catch(function () {});
              privUnsubs.push(db.collection('aircraftPrivate').onSnapshot(function (q) { var p = {}; q.docs.forEach(function (d) { p[d.id] = d.data(); }); st.priv = p; emit(); }, err));
              privUnsubs.push(db.doc('config/alerts').onSnapshot(function (s) { st.alerts = s.exists ? s.data() : emptyAlerts(); emit(); }, err));
              privUnsubs.push(db.collection('roles').onSnapshot(function (q) { st.roles = q.docs.map(function (d) { return Object.assign({ email: d.id }, d.data()); }); emit(); }, err));
              privUnsubs.push(db.collection('squawks').where('status', '==', 'closed').onSnapshot(function (q) { st.closedSquawks = q.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); emit(); }, err));
            }
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

    saveAircraft: function (a) {
      a = clone(a); a.updatedAt = now(); delete a._priv;
      if (st.mode === 'demo') { var i = st.aircraft.findIndex(function (x) { return x.id === a.id; }); if (i >= 0) st.aircraft[i] = a; else st.aircraft.push(a); demoSave(); return Promise.resolve(a); }
      var id = a.id; delete a.id; return db.doc('aircraft/' + id).set(a).then(function () { a.id = id; return a; });
    },
    deleteAircraft: function (id) {
      if (st.mode === 'demo') { st.aircraft = st.aircraft.filter(function (x) { return x.id !== id; }); delete st.priv[id]; st.squawks = st.squawks.filter(function (s) { return s.aircraftId !== id; }); demoSave(); return Promise.resolve(); }
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
    clearDemo: function () { var d = PPASample.build(); d.aircraft = []; d.squawks = []; d.priv = {}; localStorage.setItem(KEY, JSON.stringify(d)); demoLoad(); emit(); },
    lastUpdated: function () {
      var t = [];
      st.aircraft.forEach(function (a) { if (a.updatedAt) t.push(a.updatedAt); });
      st.squawks.forEach(function (s) { if (s.createdAt) t.push(s.createdAt); });
      if (st.settings && st.settings.updatedAt) t.push(st.settings.updatedAt);
      t.sort(); return t.length ? new Date(t[t.length - 1]) : null;
    }
  };
  return api;
})();
