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
// VOR is back on the A V 1 A T E row (Kyle, 11/16/2026 evening): a dated FSP VOR check fills the V date, not an AD.
ok('VOR check imported as the V date (not an AD)', !a.ads.some(x => /VOR/i.test(x.desc)) && (a.dates || {}).vor === '2026-11-01', a);
ok('import warns about the skipped GPS item', res.warn.some(w => /GPS Database Updates/.test(w)), res.warn);
// re-import again: still one oil change
st.aircraft = [a];
const res2 = Set.buildFspImport(parsed([rem('50 Hour Oil Change (Non-Grounding)')]));
ok('second re-import keeps one oil change', res2.ops[0].a.ads.filter(S.isOilChange).length === 1, res2.ops[0].a.ads);

// N429L: added by hand, then a later FSP report that includes it -> updates the same plane, no duplicate.
st.aircraft = [{ id: 'm429', tail: 'N429L', type: 'Cessna 172S', location: 'kdhn', meter: 'tach', tach: null, dates: {}, na: {}, ads: [], log: [] }];
st.settings.locations.push({ id: 'kdhn', code: 'KDHN', name: 'Dothan' });
const p429 = { reportCreated: '2026-11-20', warnings: [], aircraft: [{ tail: 'N429L', type: 'Cessna 172S', locationCode: 'KDHN', meter: 'tach', meters: { tach: 10450.2 }, reminders: [], squawks: [], doubts: [] }] };
const r429 = Set.buildFspImport(p429);
ok('manual N429L + imported N429L -> one plane, updated in place', r429.ops.length === 1 && r429.ops[0].a.id === 'm429' && r429.ops[0].a.tach === 10450.2, r429.ops.map(o => [o.a.id, o.a.tail]));
// a report WITHOUT N429L tells the editor which board planes were missing
const rMiss = Set.buildFspImport(parsed([rem('50 Hour Oil Change (Non-Grounding)')]));
ok('import lists board planes not in the report (N429L)', rMiss.warn.some(w => /Not in this FSP report: N429L \(KDHN\)/.test(w)), rMiss.warn);
// away plane (N97459 by default) is still updated but flagged as hidden
st.aircraft = [];
const p459 = { reportCreated: '2026-11-20', warnings: [], aircraft: [{ tail: 'N97459', type: 'Cessna 172P', locationCode: 'KECP', meter: 'tach', meters: { tach: 5000 }, reminders: [], squawks: [], doubts: [] }] };
const r459 = Set.buildFspImport(p459);
ok('away N97459: imported data kept, warned it stays hidden', r459.ops.length === 1 && r459.warn.some(w => /N97459 is marked AWAY/.test(w)), r459.warn);

if (failed) { console.error(failed + ' merge test(s) failed'); process.exit(1); }
console.log('fsp merge tests passed');
