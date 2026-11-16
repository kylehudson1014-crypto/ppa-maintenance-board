const PPAStatus = require('../js/status.js');
let failed = 0;
function ok(name, cond, detail) {
  if (cond) console.log('PASS', name);
  else { failed++; console.log('FAIL', name, detail === undefined ? '' : detail); }
}
function eq(name, a, b) {
  const as = JSON.stringify(a), bs = JSON.stringify(b);
  ok(name, as === bs, as + ' !== ' + bs);
}

ok('plane has tach by default', PPAStatus.hasTach({ type: 'Cessna 172S', tail: 'N734PA' }) === true);
ok('Redbird type hides tach', PPAStatus.hasTach({ type: 'Redbird FMX', tail: 'NB58RB' }) === false);
ok('AATD in type hides tach', PPAStatus.hasTach({ type: 'Redbird AATD', tail: 'N181RB' }) === false);
ok('explicit hasTach true wins on a sim', PPAStatus.hasTach({ type: 'Redbird FMX', hasTach: true }) === true);
ok('explicit hasTach false wins on a plane', PPAStatus.hasTach({ type: 'Cessna 172S', hasTach: false }) === false);
ok('noTach flag hides tach', PPAStatus.hasTach({ type: 'Cessna 172S', noTach: true }) === false);

const acId = 'a1';
const now = new Date('2026-11-15T18:00:00Z');
const reports = [
  { id: 'r1', aircraftId: acId, applied: false, tachEnd: 100.2, hobbsEnd: 200.4, oilAdded: true, oilQts: 1.5, createdAt: '2026-11-15T12:00:00Z', reportedBy: 'Pat' },
  { id: 'r0', aircraftId: acId, applied: false, tachEnd: 99.0, hobbsEnd: 199.0, oilAdded: true, oilQts: 1, createdAt: '2026-11-14T12:00:00Z', reportedBy: 'Sam' },
  { id: 'ro', aircraftId: acId, applied: true, oilAdded: true, oilQts: 2, createdAt: '2026-09-01T12:00:00Z' },
  { id: 'rx', aircraftId: 'other', applied: false, oilAdded: true, oilQts: 4, createdAt: '2026-11-15T12:00:00Z' }
];
const latest = PPAStatus.latestUnapplied(reports, acId);
eq('latest unapplied is newest with end hours', latest && latest.id, 'r1');
eq('oil last 30 days excludes old and other tails', PPAStatus.oilAddedLast30Days(reports, acId, now), 2.5);
eq('reportsFor newest first', PPAStatus.reportsFor(reports, acId).map(r => r.id), ['r1', 'r0', 'ro']);

if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.log('flight-report tests passed');
