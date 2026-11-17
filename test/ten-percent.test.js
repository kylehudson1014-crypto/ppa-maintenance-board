// 10% rule for 100-hr and 50-hr oil change, away aircraft, location sort/colors (Kyle, 11/16/2026 evening).
const S = require('../js/status.js');
let failed = 0;
function ok(name, cond, detail) { if (!cond) { failed++; console.error('FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); } else console.log('ok', name); }
const today = '2026-11-16';
const ago = d => S.addDays(today, -d);
function plane(extra) {
  return Object.assign({ id: 'p1', tail: 'N1', meter: 'tach', tach: 1000, tachUpdated: today, last100: 960, ifr: true, forHire: true, location: 'kecp',
    dates: { annual: ago(30), vor: ago(3), pitot: ago(30), xpdr: ago(30), elt: ago(30), eltBattery: S.addDays(today, 500) }, ads: [] }, extra || {});
}
const ev = (a, set) => S.evaluate(a, set || {}, [], today);
const item = (e, k) => e.items.find(i => i.key === k);

// 100-hr: interval 100 -> >10 h left green, <=10 h yellow, 0 grounded
let e = ev(plane({ tach: 1049.9, last100: 960 })); // 10.1 left
ok('100-hr 10.1 h left (10.1%) -> green', item(e, 'hundred').state === 'ok' && !e.reasons.some(r => /100-hr/.test(r)), item(e, 'hundred'));
e = ev(plane({ tach: 1050, last100: 960 })); // 10 left
ok('100-hr exactly 10% left -> yellow', item(e, 'hundred').state === 'due' && e.overall === 'due' && item(e, 'hundred').pctLeft === 10);
e = ev(plane({ tach: 1059.5, last100: 960 }));
ok('100-hr 0.5 h left -> yellow', item(e, 'hundred').state === 'due');
e = ev(plane({ tach: 1060, last100: 960 }));
ok('100-hr 0 h left (0%) -> GROUNDED', item(e, 'hundred').state === 'over' && e.overall === 'grounded', e.reasons);
e = ev(plane({ tach: 1065, last100: 960 }));
ok('100-hr overdue -> GROUNDED', e.overall === 'grounded' && /100-hr OVERDUE 5.0 hrs/.test(e.reasons.join()), e.reasons);
e = ev(plane({ tach: 1050, last100: 960 }), { rules: { hundred: { warnPct: 5 } } });
ok('warn % editable in Settings (5% -> 10 h left is green)', item(e, 'hundred').state === 'ok');

// 50-hr oil: interval 50 -> yellow at 5 h or less, overdue red but non-grounding
const oilAd = (last, extra) => Object.assign({ id: 'o', desc: '50 Hour Oil Change', intervalHours: 50, lastDoneHours: last, nonGrounding: true }, extra || {});
e = ev(plane({ ads: [oilAd(955)], tach: 999.9 })); // 5.1 left
ok('oil 5.1 h left -> green', item(e, 'oil50').state === 'ok', item(e, 'oil50'));
e = ev(plane({ ads: [oilAd(955)], tach: 1000 })); // 5 left
ok('oil 5 h left (10%) -> yellow, not grounded', item(e, 'oil50').state === 'due' && e.overall === 'due');
e = ev(plane({ ads: [oilAd(950)], tach: 1000 })); // 0 left
ok('oil 0 h left -> red pill, NOT grounded (non-grounding)', item(e, 'oil50').state === 'over' && e.overall === 'due', e.reasons);
e = ev(plane({ ads: [oilAd(950, { nonGrounding: false })], tach: 1001 }));
ok('oil marked grounding by editor -> grounds when overdue', e.overall === 'grounded', e.reasons);
e = ev(plane({ ads: [oilAd(940, { intervalHours: 25 })], tach: 962 })); // 3 left of 25 -> 12% green
ok('oil % uses the item interval (25 h -> 2.5 h)', item(e, 'oil50').state === 'ok');
e = ev(plane({ ads: [], tach: 1006 })); // default oil from last100 960 -> due 1010, 4 left
ok('default oil (from last 100-hr) uses 10% rule', item(e, 'oil50').state === 'due' && item(e, 'oil50').hoursLeft === 4);

// Away aircraft
ok('N97459 away by default', S.isAway({ tail: 'N97459' }, {}) && !S.isAway({ tail: 'N429L' }, {}));
ok('Restore = remove from settings.awayTails', !S.isAway({ tail: 'N97459' }, { awayTails: [] }));
ok('away list is editable and tolerant of spacing/case', S.isAway({ tail: 'n645ep' }, { awayTails: ['N645 EP'] }));
ok('activeAircraft hides away planes', S.activeAircraft([{ tail: 'N97459' }, { tail: 'N429L' }], {}).map(a => a.tail).join() === 'N429L');

// Location sort + colors
const set = { locations: [{ id: 'kecp', code: 'KECP' }, { id: 'kcew', code: 'KCEW' }, { id: 'kdhn', code: 'KDHN' }, { id: 'kvps', code: 'KVPS', color: '#123456' }, { id: 'x', code: 'XYZ' }] };
const list = [{ id: 'a', tail: 'N9', location: 'kdhn' }, { id: 'b', tail: 'N2', location: 'kecp' }, { id: 'c', tail: 'N1', location: 'kcew' }, { id: 'd', tail: 'N0', location: 'kecp' }, { id: 'g', tail: 'N00', location: 'kecp' }];
const evs = { a: { overall: 'ok' }, b: { overall: 'due' }, c: { overall: 'ok' }, d: { overall: 'ok' }, g: { overall: 'grounded' } };
ok('sorted by location (Settings order) then tail, grounded last', S.sortFleet(list, evs, set).map(a => a.tail).join() === 'N0,N2,N1,N9,N00', S.sortFleet(list, evs, set).map(a => a.tail));
const cols = ['kecp', 'kcew', 'kdhn', 'kvps', 'x'].map(id => S.locColor(set, id));
ok('each location has its own color; custom color wins', new Set(cols).size === 5 && cols[3] === '#123456', cols);

// N429L duplicated in the data -> shown once (newest copy)
const dup = [{ id: 'm', tail: 'N429L', updatedAt: '2026-11-16T10:00:00Z' }, { id: 'x', tail: 'N5520N' }, { id: 'i', tail: 'n429l', updatedAt: '2026-11-17T04:00:00Z' }];
ok('duplicate tail shown once, newest copy wins', S.dedupeByTail(dup).map(a => a.id).join() === 'i,x' && S.duplicateTails(dup).join() === 'N429L', S.dedupeByTail(dup));
if (failed) { console.error(failed + ' ten-percent test(s) failed'); process.exit(1); }
console.log('ten-percent / away / location tests passed');
