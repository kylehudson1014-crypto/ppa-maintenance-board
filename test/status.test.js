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
ok('no VOR item', !S.ITEMS.some(i => i.key === 'vor') && !S.DEFAULT_RULES.vor);
let e = ev(plane({ dates: Object.assign(plane().dates, { vor: ago(400) }) }));
ok('old VOR date does not affect status', !item(e, 'vor') && e.overall === 'ok', e.reasons);

// 2. default 50-hr oil change
e = ev(plane());
let ads = item(e, 'ads');
ok('virtual oil change tracked when none exists', ads.ads.length === 1 && ads.ads[0].ad.virtual && ads.ads[0].ad.kind === 'oil50', ads);
ok('oil due at last100 + 50 (1010), 10 h left -> ok', ads.ads[0].dueHours === 1010 && ads.state === 'ok', ads.ads[0]);
e = ev(plane({ tach: 1007 }));
ok('3 h left -> amber due', item(e, 'ads').state === 'due' && e.overall === 'due', e.reasons);
e = ev(plane({ tach: 1030 }));
ok('overdue oil change is amber, never grounds', item(e, 'ads').state === 'due' && e.overall === 'due' && /50-hr oil OVERDUE \(non-grounding\)/.test(e.reasons.join(' ')), e.reasons);
e = ev(plane({ last100: null }));
ok('no starting point -> neutral, not needs-data', item(e, 'ads').state === 'none' && !e.reasons.some(r => /ADs/.test(r)), [item(e, 'ads'), e.reasons]);
const fspOil = { id: 'x1', number: '', desc: '50 Hour Oil Change', intervalHours: 50, lastDoneHours: 990, nonGrounding: true };
e = ev(plane({ ads: [fspOil] }));
ok('existing FSP oil change -> no duplicate', item(e, 'ads').ads.length === 1 && item(e, 'ads').ads[0].ad.id === 'x1');
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
ok('ignored oil change -> no virtual oil re-added', item(e, 'ads').ads.length === 0 && e.overall === 'ok', item(e, 'ads'));

// existing non-grounding behaviour still works
e = ev(plane({ ads: [{ id: 'n1', desc: 'Something (Non-Grounding)', nextDueDate: ago(2) }] }));
ok('desc "Non-Grounding" stays amber', e.overall === 'due', e.reasons);

if (failed) { console.error(failed + ' status test(s) failed'); process.exit(1); }
console.log('status tests passed');
