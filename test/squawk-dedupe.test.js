// Squawk de-duplication: FSP re-import never adds the same squawk twice; existing copies collapse in the display.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const S = require('../js/status.js'); const Imp = require('../js/fsp-import.js');
let failed = 0;
function ok(name, cond, detail) { if (!cond) { failed++; console.error('FAIL', name, detail === undefined ? '' : JSON.stringify(detail, null, 1)); } else console.log('ok', name); }
const TXT = "Top right vent doesn't open and let air thru. Coleson sweats like a stuck pig on a rotisserie!";
// The real N8274E case: board copy was stored with the import time (UTC), not the FSP date.
const boardSq = { id: '6UzY', aircraftId: 'jbai3c6e', tail: 'N8274E', status: 'open', text: TXT, reportedBy: 'Chad Kotajarvi', createdAt: '2026-11-16T00:38:05.528Z' };
ok('re-import of the same open squawk is a duplicate (different stored date)', S.isDuplicateSquawk({ aircraftId: 'jbai3c6e', tail: 'N8274E', text: TXT, date: '2026-11-10' }, [boardSq]));
ok('case / spacing / curly quote / trailing punctuation ignored', S.isDuplicateSquawk({ aircraftId: 'jbai3c6e', text: '  TOP right vent doesn’t open and let air   thru. Coleson sweats like a stuck pig on a rotisserie ' }, [boardSq]));
ok('other plane is not a duplicate', !S.isDuplicateSquawk({ aircraftId: 'other', tail: 'N1', text: TXT, date: '2026-11-10' }, [boardSq]));
const closed = Object.assign({}, boardSq, { status: 'closed', fspDate: '2026-10-01' });
ok('fixed squawk that comes back with a NEW FSP date is added again', !S.isDuplicateSquawk({ aircraftId: 'jbai3c6e', text: TXT, date: '2026-11-10' }, [closed]));
ok('fixed squawk with the SAME FSP date is not re-added', S.isDuplicateSquawk({ aircraftId: 'jbai3c6e', text: TXT, date: '2026-10-01' }, [closed]));
ok('FSP id wins when both have one', S.isDuplicateSquawk({ aircraftId: 'x', text: 'different', fspId: '77' }, [{ aircraftId: 'y', text: 'z', fspId: '77', status: 'closed' }]) && !S.isDuplicateSquawk({ aircraftId: 'jbai3c6e', text: TXT, fspId: '78' }, [Object.assign({}, boardSq, { fspId: '77' })]));
// display collapse
const dup = Object.assign({}, boardSq, { id: 'elPa', createdAt: '2026-11-16T23:01:21.940Z' });
const other = { id: 'o1', aircraftId: 'jbai3c6e', status: 'open', text: 'Different squawk', createdAt: '2026-11-16T01:00:00Z' };
const col = S.collapseSquawks([boardSq, dup, other]);
ok('existing duplicate collapses to one (oldest kept)', col.length === 2 && col[0].id === '6UzY' && JSON.stringify(col[0]._dupIds) === '["elPa"]', col);
ok('collapse is stable when run again', JSON.stringify(S.collapseSquawks(col)) === JSON.stringify(col));

// import merge through settings.js
const st = { settings: { locations: [{ id: 'kecp', code: 'KECP', name: 'ECP' }], types: [], ignoreTails: [] }, aircraft: [{ id: 'jbai3c6e', tail: 'N8274E', meter: 'tach', tach: 1000, dates: {}, na: {}, ads: [], log: [] }], squawks: [boardSq], closedSquawks: [] };
let n = 0;
const ctx = { console, JSON, Date, Math, Number, String, Object, Array, Error, RegExp, window: { PPAUI: { esc: x => x, $: () => null, $$: () => [], toast() {} }, PPAFspImport: Imp },
  PPAViews: { opt() {}, clone: o => JSON.parse(JSON.stringify(o)) }, PPAStatus: S, Store: { state: st }, PPASample: { uid: () => 'id' + (++n) } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/settings.js'), 'utf8') + '\nthis.PPASettings = PPASettings;', ctx);
const sqFsp = { date: '2026-11-10', reportedBy: 'Chad Kotajarvi', groundable: false, status: 'Non-Grounding Issue (Open)', open: true, description: TXT, deleted: false };
const parsed = { reportCreated: '2026-11-16', warnings: [], aircraft: [{ tail: 'N8274E', type: 'Cessna 172S', locationCode: 'KECP', meter: 'tach', meters: { tach: 1001 }, reminders: [], squawks: [sqFsp, Object.assign({}, sqFsp)], doubts: [] }] };
const res = ctx.PPASettings.buildFspImport(parsed);
ok('re-import adds no squawk for N8274E', res.squawkOps.length === 0 && res.warn.some(w => /skipped duplicate squawk/.test(w)), [res.squawkOps, res.warn]);
st.squawks = [];
const res2 = ctx.PPASettings.buildFspImport(parsed);
ok('same squawk listed twice in one report is added once, with its FSP date', res2.squawkOps.length === 1 && res2.squawkOps[0].fspDate === '2026-11-10', res2.squawkOps);

if (failed) { console.error(failed + ' squawk test(s) failed'); process.exit(1); }
console.log('squawk dedupe tests passed');
