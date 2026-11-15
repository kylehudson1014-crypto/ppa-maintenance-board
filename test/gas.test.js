// Run alerts/Code.gs + js/status.js in Node with Apps Script mocks against the Firebase emulators.
const { execFileSync } = require('child_process'); const fs = require('fs'); const vm = require('vm');
const R = require('path').join(__dirname, '..') + '/';
const props = { FIREBASE_API_KEY: 'fake', FIREBASE_PROJECT: 'ppa-mb-test', BOT_EMAIL: 'bot@x.com', BOT_PASSWORD: 'botpass123', BOARD_URL: 'https://example/board/',
  AUTH_URL: 'http://127.0.0.1:9199/identitytoolkit.googleapis.com', FIRESTORE_URL: 'http://127.0.0.1:8089' };
const mail = [];
function curl(url, o = {}) {
  const args = ['-s', '-w', '\n%{http_code}', '-X', (o.method || 'get').toUpperCase(), url];
  Object.entries(o.headers || {}).forEach(([k, v]) => args.push('-H', k + ': ' + v));
  if (o.payload) args.push('-H', 'Content-Type: ' + (o.contentType || 'application/json'), '--data-binary', o.payload);
  const out = execFileSync('curl', args).toString(); const i = out.lastIndexOf('\n');
  return { getContentText: () => out.slice(0, i), getResponseCode: () => Number(out.slice(i + 1)) };
}
const ctx = { console, JSON, Date, Math, Number, String, Object, Array, Error, encodeURIComponent,
  UrlFetchApp: { fetch: curl },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
  MailApp: { sendEmail: m => mail.push(m) }, Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@x.com' }) },
  Utilities: { formatDate: (d, tz, f) => f === 'H' ? String(new Date(d.toLocaleString('en-US', { timeZone: tz })).getHours()) : new Date(d.toLocaleString('en-US', { timeZone: tz })).toISOString().slice(0, 10) },
  Logger: { log: m => console.log('  [Logger]', m) } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(R + 'js/status.js', 'utf8').replace('if (typeof module', 'this.PPAStatus = PPAStatus; if (typeof module'), ctx);
vm.runInContext(fs.readFileSync(R + 'alerts/Code.gs', 'utf8'), ctx);
const FS = 'http://127.0.0.1:8089/v1/projects/ppa-mb-test/databases/(default)/documents/';
function toFs(v) { if (v === null || v === undefined) return { nullValue: null }; if (typeof v === 'boolean') return { booleanValue: v }; if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v }; if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } }; return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toFs(x)])) } }; }
function put(path, obj) { const r = curl(FS + path, { method: 'patch', headers: { Authorization: 'Bearer owner' }, payload: JSON.stringify({ fields: toFs(obj).mapValue.fields }) }); if (r.getResponseCode() !== 200) throw new Error(r.getContentText()); }
const t = ctx.PPAStatus.todayStr(), ago = d => ctx.PPAStatus.addDays(t, -d);
const goodDates = { annual: ago(30), vor: ago(3), pitot: ago(30), xpdr: ago(30), elt: ago(30), eltBattery: ctx.PPAStatus.addDays(t, 500) };
// seed
curl('http://127.0.0.1:9199/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', { method: 'post', payload: JSON.stringify({ email: 'bot@x.com', password: 'botpass123', returnSecureToken: true }) });
put('roles/bot@x.com', { role: 'alerts' });
put('config/public', { locations: [{ id: 'kecp', code: 'KECP', name: 'Panama City' }], rules: {} });
put('config/alerts', { enabled: false, onGrounded: true, onDueSoon: true, onReturn: true, recipients: [{ name: 'CFI A', email: 'cfia@x.com', group: 'CFI', locations: ['kecp'], active: true }, { name: 'Other base', email: 'b@x.com', group: 'CFI', locations: ['kcew'], active: true }] });
put('aircraft/a1', { tail: 'N111AA', type: 'C172', location: 'kecp', hours: 1000.5, last100: 950, meter: 'tach', ifr: true, forHire: true, dates: goodDates, ads: [] });
put('aircraft/a2', { tail: 'N222BB', type: 'PA28', location: 'kecp', hours: 2000, last100: 1950, meter: 'tach', ifr: true, forHire: true, dates: goodDates, ads: [] });
let r = ctx.checkAndAlert(); console.log('RUN1 baseline:', r.baseline, 'mail', mail.length);
put('squawks/s1', { aircraftId: 'a2', tail: 'N222BB', text: 'Brake failure', severity: 'grounding', grounding: true, status: 'open', reportedBy: 'CFI A', createdAt: new Date().toISOString() });
r = ctx.checkAndAlert(); console.log('RUN2 (alerts OFF) wouldSend:', JSON.stringify(r.wouldSend), 'mail sent:', mail.length);
put('config/alerts', { enabled: true, onGrounded: true, onDueSoon: true, onReturn: true, recipients: [{ name: 'CFI A', email: 'cfia@x.com', group: 'CFI', locations: ['kecp'], active: true }, { name: 'Other base', email: 'b@x.com', group: 'CFI', locations: ['kcew'], active: true }] });
r = ctx.checkAndAlert(); console.log('RUN3 (ON, no change) sent:', r.sent.length, '(expect 0, no repeat)');
put('squawks/s1', { aircraftId: 'a2', tail: 'N222BB', text: 'Brake failure', severity: 'grounding', grounding: true, status: 'closed', reportedBy: 'CFI A', createdAt: new Date().toISOString() });
put('aircraft/a1', { tail: 'N111AA', type: 'C172', location: 'kecp', hours: 1045.5, last100: 950, meter: 'tach', ifr: true, forHire: true, dates: goodDates, ads: [] });
r = ctx.checkAndAlert(); console.log('RUN4 (ON) sent:', JSON.stringify(r.sent)); console.log('mails:', JSON.stringify(mail.map(m => ({ bcc: m.bcc, subject: m.subject })), null, 0)); console.log('body sample:\n' + (mail[0] || {}).body);
