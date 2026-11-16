// FSP import merge (js/settings.js buildFspImport): one 50-hr oil change per plane, ignored ADs stay ignored,
// GPS / nav database reminders never come in. Runs settings.js with tiny stubs (no DOM needed for the merge).
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const R = path.join(__dirname, '..') + '/';
const S = require('../js/status.js');
const Imp = require('../js/fsp-import.js');
let failed = 0;
function ok(name, cond, detail) { if (!cond) { failed++; console.error('FAIL', name, detail === undefined ? '' : JSON.stringify(detail, null, 1)); } else console.log('ok', name); }
const st = { settings: { locations: [{ id: 'kecp', code: 'KECP', name: 'ECP' }], types: ['Cessna 172S'], ignoreTails: [] }, aircraft: [], squawks: [], closedSquawks: [] };
let n = 0;
const ctx = { console, JSON, Date, Math, Number, String, Object, Array, Error, RegExp,
  window: { PPAUI: { esc: x => x, $: () => null, $$: () => [], toast() {} }, PPAFspImport: Imp },
  PPAViews: { opt() {}, clone: o => JSON.parse(JSON.stringify(o)) }, PPAStatus: S, Store: { state: st }, PPASample: { uid: () => 'id' + (++n) } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(R + 'js/settings.js', 'utf8') + '\nthis.PPASettings = PPASettings;', ctx);
const Set = ctx.PPASettings;
function rem(name, extra) { return Object.assign({ name, lastDate: '2026-11-01', lastTime: 990, dueDate: '', dueInHours: 40, expired: false }, extra || {}); }
function parsed(reminders) { return { reportCreated: '2026-11-16', warnings: [], aircraft: [{ tail: 'N645EP', type: 'Cessna 172S', locationCode: 'KECP', meter: 'tach', meters: { tach: 1000 }, reminders, squawks: [], doubts: [] }] }; }

// existing plane already has the default oil change saved from the editor (kind oil50) and an ignored AD
st.aircraft = [{ id: 'p1', tail: 'N645EP', meter: 'tach', tach: 1000, dates: {}, na: {}, log: [],
  ads: [{ id: 'o1', kind: 'oil50', desc: '50-hr oil change', intervalHours: 50, lastDoneHours: 960, nonGrounding: true },
        { id: 'a1', number: '2011-10-09', desc: 'Seat rails', nextDueDate: '2026-10-01', ignored: true }] }];
const res = Set.buildFspImport(parsed([rem('50 Hour Oil Change (Non-Grounding)'), rem('AD 2011-10-09 (Seat rails)', { lastTime: null, dueInHours: null, dueDate: '2026-12-01' }), rem('GPS Database Updates', { lastTime: null, dueInHours: null, dueDate: '2026-11-26' }), rem('VOR Check', { lastTime: null, dueInHours: null })]));
ok('no error', !res.error, res.error);
const a = res.ops[0].a;
const oils = a.ads.filter(S.isOilChange);
ok('only one oil change after FSP import', oils.length === 1 && oils[0].id === 'o1', a.ads);
ok('FSP oil values merged into the existing item', oils[0].lastDoneHours === 990 && oils[0].nonGrounding === true, oils[0]);
const seat = a.ads.find(x => x.number === '2011-10-09');
ok('ignored AD stays ignored after re-import', seat && seat.ignored === true, seat);
ok('GPS reminder not imported', !a.ads.some(x => /GPS/i.test(x.desc)), a.ads);
ok('VOR not imported', !a.ads.some(x => /VOR/i.test(x.desc)) && !(a.dates || {}).vor, a);
ok('import warns about the skipped items', res.warn.some(w => /GPS Database Updates/.test(w) && /VOR Check/.test(w)), res.warn);
// re-import again: still one oil change
st.aircraft = [a];
const res2 = Set.buildFspImport(parsed([rem('50 Hour Oil Change (Non-Grounding)')]));
ok('second re-import keeps one oil change', res2.ops[0].a.ads.filter(S.isOilChange).length === 1, res2.ops[0].a.ads);

if (failed) { console.error(failed + ' merge test(s) failed'); process.exit(1); }
console.log('fsp merge tests passed');
