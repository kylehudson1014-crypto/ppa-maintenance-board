// Status logic tests (Chad's feedback 11/16/2026): no VOR, default non-grounding 50-hr oil change,
// GPS / nav database updates ignored, one-tap Ignore / Restore per AD.
const S = require('../js/status.js');
let failed = 0;
function ok(name, cond, detail) { if (!cond) { failed++; console.error('FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); } else console.log('ok', name); }
const today = '2026-11-16';
const ago = d => S.addDays(today, -d);
function plane(extra) {
  return Object.assign({ id: 'p1', tail: 'N645EP', meter: 'tach', tach: 1000, tachUpdated: today, last100: 960, ifr: true, forHire: true,
    dates: { annual: ago(30), pitot: ago(30), xpdr: ago(30), elt: ago(30), eltBattery: S.addDays(today, 500) }, ads: [] }, extra || {});
}
const ev = (a, sq) => S.evaluate(a, {}, sq || [], today);
const item = (e, k) => e.items.find(i => i.key === k);

// 1. VOR removed
// (11/16/2026 late: Kyle put VOR back on the A V 1 A T E row; it is non-grounding and optional.)
let e = ev(plane());
ok('VOR back; no VOR date -> optional, plane stays green', item(e, 'vor').state === 'missing' && e.overall === 'ok', e.reasons);
e = ev(plane({ dates: Object.assign(plane().dates, { vor: ago(400) }) }));
ok('overdue VOR is red on its letter but never grounds', item(e, 'vor').state === 'over' && e.overall === 'due' && /VOR check OVERDUE \(non-grounding/.test(e.reasons.join(' ')), e.reasons);
e = ev(plane({ ifr: false, dates: Object.assign(plane().dates, { vor: ago(400) }) }));
ok('VFR-only plane: VOR N/A', item(e, 'vor').state === 'na' && e.overall === 'ok');

// 2. default 50-hr oil change
e = ev(plane());
let oil = item(e, 'oil50');
ok('card row is A V 1 A T E (no D letter), then 50 / 100 hour pills', S.ROW_LETTERS === 'A V 1 A T E' && S.ITEMS.find(i => i.key === 'ads').row === 'none' && oil.letter === '50' && S.ITEMS.find(i => i.key === 'oil50').row === 'hours');
ok('virtual oil change tracked when none exists', oil.ads.length === 1 && oil.ads[0].ad.virtual && oil.ads[0].ad.kind === 'oil50', oil);
ok('oil not counted under D', item(e, 'ads').state === 'none' && item(e, 'ads').ads.length === 0, item(e, 'ads'));
ok('oil due at last100 + 50 (1010), 10 h left -> ok', oil.ads[0].dueHours === 1010 && oil.state === 'ok', oil.ads[0]);
e = ev(plane({ tach: 1007 }));
ok('3 h left -> amber due', item(e, 'oil50').state === 'due' && e.overall === 'due', e.reasons);
e = ev(plane({ tach: 1030 }));
ok('overdue oil change is red on its pill, never grounds', item(e, 'oil50').state === 'over' && item(e, 'oil50').nonGrounding && e.overall === 'due' && /50-hr oil OVERDUE \(non-grounding\)/.test(e.reasons.join(' ')), e.reasons);
e = ev(plane({ last100: null }));
ok('no starting point -> neutral, not needs-data', item(e, 'oil50').state === 'none' && !e.reasons.some(r => /oil/.test(r)), [item(e, 'oil50'), e.reasons]);
const fspOil = { id: 'x1', number: '', desc: '50 Hour Oil Change', intervalHours: 50, lastDoneHours: 990, nonGrounding: true };
e = ev(plane({ ads: [fspOil] }));
ok('existing FSP oil change -> no duplicate', item(e, 'oil50').ads.length === 1 && item(e, 'oil50').ads[0].ad.id === 'x1' && item(e, 'ads').ads.length === 0);
e = ev(plane({ tach: 1060, last100: 1050, ads: [Object.assign({}, fspOil, { nonGrounding: undefined })] }));
ok('oil change is non-grounding by default even without the flag', e.overall === 'due', e.reasons);
e = ev(plane({ tach: 1060, last100: 1050, ads: [Object.assign({}, fspOil, { nonGrounding: false })] }));
ok('editor can make the oil change grounding (unchecked)', e.overall === 'grounded', e.reasons);
ok('isOilChange variants', ['50 Hour Oil Change', '50 HR Oil Change (Non-Grounding)', 'Oil change', '50-hr oil change'].every(d => S.isOilChange({ desc: d })) && !S.isOilChange({ desc: '100 Hour Inspection' }));

// 3. GPS / nav database updates ignored
const gps = { id: 'g1', number: '', desc: 'GPS Database Update', nextDueDate: ago(5) };
e = ev(plane({ ads: [gps] }));
ok('overdue GPS update does not ground or show', e.overall === 'ok' && item(e, 'ads').ads.every(x => x.ad.id !== 'g1') && item(e, 'ads').ignoredAds.length === 1, e.reasons);
ok('isGpsUpdate variants', ['GPS Database Update', 'GPS/NAV Database', 'Nav data update', 'Garmin navigation database'].every(d => S.isGpsUpdate({ desc: d })) && !S.isGpsUpdate({ desc: '50 Hour Oil Change' }));
e = ev(plane({ ads: [Object.assign({}, gps, { ignored: false })] }));
ok('restored GPS item counts again', e.overall === 'grounded', e.reasons);

// 4. Ignore / Restore any AD
const ad = { id: 'a1', number: '2011-10-09', desc: 'Seat rails', nextDueDate: ago(3) };
e = ev(plane({ ads: [ad] }));
ok('overdue AD grounds', e.overall === 'grounded');
e = ev(plane({ ads: [Object.assign({}, ad, { ignored: true })] }));
ok('ignored AD does not ground, listed as ignored', e.overall === 'ok' && item(e, 'ads').ignoredAds.length === 1, e.reasons);
e = ev(plane({ ads: [Object.assign({}, fspOil, { ignored: true })], tach: 1060, last100: 1050 }));
ok('oil change can never be ignored: old ignored flag overridden (N645EP/N9559D case)', item(e, 'oil50').state === 'over' && item(e, 'oil50').nonGroundingOverdue && item(e, 'oil50').ads.length === 1 && e.overall === 'due', item(e, 'oil50'));
ok('GPS pattern never matches an oil change', !S.isGpsUpdate({ desc: '50 Hour Oil Change (Non-Grounding)' }) && !S.isIgnoredAD({ desc: '50 Hour Oil Change', ignored: true }) && !S.isIgnoredAD({ desc: 'GPS database oil change' }));
e = ev(plane({ na: { oil50: true }, tach: 1030 }));
ok('N/A flag on 50 is overridden: oil change always tracked', item(e, 'oil50').state === 'over' && e.overall === 'due', e.reasons);

// existing non-grounding behaviour still works
e = ev(plane({ ads: [{ id: 'n1', desc: 'Something (Non-Grounding)', nextDueDate: ago(2) }] }));
ok('desc "Non-Grounding" stays amber', e.overall === 'due', e.reasons);

if (failed) { console.error(failed + ' status test(s) failed'); process.exit(1); }
console.log('status tests passed');
