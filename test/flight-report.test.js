const PPAStatus = require('../js/status.js');
const PPAMeterOcr = require('../js/meter-ocr.js');
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
const fspAt = '2026-11-05T12:00:00Z';
const reports = [
  { id: 'r1', aircraftId: acId, applied: false, tachStart: 98.8, tachEnd: 100.2, hobbsStart: 198.8, hobbsEnd: 200.4, oilAdded: true, oilQts: 1.5, createdAt: '2026-11-15T12:00:00Z', reportedBy: 'Pat' },
  { id: 'r0', aircraftId: acId, applied: false, tachStart: 97.0, tachEnd: 99.0, hobbsStart: 197.0, hobbsEnd: 199.0, oilAdded: true, oilQts: 1, createdAt: '2026-11-14T12:00:00Z', reportedBy: 'Sam' },
  { id: 'ro', aircraftId: acId, applied: true, oilAdded: true, oilQts: 2, tachStart: 80, tachEnd: 82, createdAt: '2026-09-01T12:00:00Z' },
  { id: 'rx', aircraftId: 'other', applied: false, oilAdded: true, oilQts: 4, createdAt: '2026-11-15T12:00:00Z' }
];
eq('oil last 30 days excludes old and other tails', PPAStatus.oilAddedLast30Days(reports, acId, now), 2.5);
eq('oil all time includes older reports for this tail', PPAStatus.oilAddedSince(reports, acId, null, now), 4.5);
eq('oil since last FSP import', PPAStatus.oilAddedSince(reports, acId, fspAt, now), 2.5);
eq('reportsFor newest first', PPAStatus.reportsFor(reports, acId).map(r => r.id), ['r1', 'r0', 'ro']);

const plane = { id: acId, type: 'Cessna 172S', tail: 'N734PA' };
const rate = PPAStatus.oilRatePer10Hours(reports, plane, now);
ok('oil rate uses tach when the plane has a tach', rate && rate.meter === 'tach');
eq('oil rate hours last 30 days', rate && rate.hours, 3.4); // (100.2-98.8) + (99.0-97.0) = 1.4+2.0
eq('oil rate qt per 10 tach hrs', rate && rate.rate, 7.4); // 2.5 / 3.4 * 10 = 7.352 → 7.4

const sim = { id: acId, type: 'Redbird AATD', tail: 'N181RB' };
const simRate = PPAStatus.oilRatePer10Hours(reports, sim, now);
ok('oil rate uses hobbs when there is no tach', simRate && simRate.meter === 'hobbs');

const noHours = PPAStatus.oilRatePer10Hours(
  [{ id: 'x', aircraftId: acId, oilAdded: true, oilQts: 1, createdAt: '2026-11-15T12:00:00Z' }],
  plane, now);
ok('oil rate is null without flown hours', noHours == null);

eq('lastFspImportAt from settings', PPAStatus.lastFspImportAt({ lastFspImportAt: fspAt }, []), fspAt);
eq('lastFspImportAt falls back to aircraft log', PPAStatus.lastFspImportAt({}, [
  { log: [{ at: '2026-10-01T00:00:00Z', what: 'CSV import: x' }, { at: '2026-11-01T08:00:00Z', what: 'FSP import: tach → 100' }] }
]), '2026-11-01T08:00:00Z');

const sum = PPAStatus.oilSummary(reports, plane, { lastFspImportAt: fspAt }, [], now);
eq('oilSummary last30', sum.last30, 2.5);
eq('oilSummary sinceFsp', sum.sinceFsp, 2.5);
eq('oilSummary allTime', sum.allTime, 4.5);

const payload = PPAStatus.flightLogSheetPayload(
  { id: 'r1', tail: 'N734PA', createdAt: '2026-11-15T18:00:00Z', reportedBy: 'Pat', reporterEmail: 'pat@x.com', student: 'Alex',
    tachStart: 100, tachEnd: 101.2, hobbsStart: 200, hobbsEnd: 201.4, oilAdded: true, oilQts: 1.5 },
  { token: 'secret', location: 'KECP', squawkText: 'Light out', tachPhoto: 'aaa', hobbsPhoto: '' }
);
eq('sheet payload reportId', payload.reportId, 'r1');
eq('sheet payload location', payload.location, 'KECP');
eq('sheet payload oil', [payload.oilAdded, payload.oilQts], [true, 1.5]);
eq('sheet payload photos stay out of Firestore shape (only in opt)', payload.tachPhoto, 'aaa');

const low = PPAStatus.meterPlausibility(4410.0, 4412.6);
ok('plausibility warns when snapped value is below the board meter', low && low.warn && low.kind === 'low');
const high = PPAStatus.meterPlausibility(4430.0, 4412.6);
ok('plausibility warns when snapped value jumps more than 10 hours', high && high.warn && high.kind === 'high');
const okp = PPAStatus.meterPlausibility(4414.0, 4412.6);
ok('plausibility is quiet for a normal reading', okp && okp.ok && !okp.warn);

eq('parseDigits 4413.2', PPAMeterOcr.parseDigits('4413.2') && PPAMeterOcr.parseDigits('4413.2').value, 4413.2);
eq('parseDigits strips junk', PPAMeterOcr.parseDigits('Tach 4,413.2 hrs') && PPAMeterOcr.parseDigits('Tach 4,413.2 hrs').value, 4413.2);
ok('parseDigits inserts a tenth on a 5-digit integer', PPAMeterOcr.parseDigits('44132') && PPAMeterOcr.parseDigits('44132').assumedTenth === true && PPAMeterOcr.parseDigits('44132').value === 4413.2);
ok('parseDigits rejects empty', PPAMeterOcr.parseDigits('abc') == null);
eq('dataUrlToRawBase64', PPAMeterOcr.dataUrlToRawBase64('data:image/jpeg;base64,QQQ'), 'QQQ');

if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.log('flight-report tests passed');
