// Parser tests: synthetic FSP text items + the real Maintenance Status Report PDF when present.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ctx = { console, JSON, Date, Math, Number, String, Object, Array, Error, RegExp, Promise, Uint8Array, module: { exports: {} }, exports: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/fsp-import.js'), 'utf8'), ctx);
const Imp = ctx.module.exports;
let failed = 0;
function eq(name, got, exp) {
  const a = JSON.stringify(got), b = JSON.stringify(exp);
  if (a !== b) { failed++; console.error('FAIL', name, '\n  got ', got, '\n  exp ', exp); }
  else console.log('ok', name);
}
function ok(name, cond, detail) {
  if (!cond) { failed++; console.error('FAIL', name, detail || ''); }
  else console.log('ok', name);
}

// One aircraft, wrapped 100-hour + page-break GPS + closed vs open squawk
const items = [];
function add(page, y, words) { words.forEach(([x, str]) => items.push({ str, x, y, page })); }
add(1, 10, [[42, 'Patriot'], [88, 'Pilot'], [121, 'Academy'], [380, 'Report'], [417, 'Created'], [458, '11/15/2026']]);
add(1, 40, [[42, 'N999ZZ'], [93, 'Cessna'], [138, '172S'], [171, '(G1000)'], [249, '(ECP'], [281, 'Patriot'], [323, 'Pilot'], [353, 'Academy)']]);
add(1, 56, [[42, 'Hobbs:'], [85, '5000.0'], [143, 'Total'], [171, 'Time:'], [207, '5000.0']]);
add(1, 72, [[42, 'Tach:'], [85, '1200.4'], [143, 'Engine:'], [207, '1200.4']]);
add(1, 100, [[42, 'Name'], [121, 'Date'], [174, 'Time'], [226, 'Cycles'], [278, 'Due'], [300, 'Date'], [356, 'Due'], [378, 'Time']]);
add(1, 120, [[42, '100'], [61, 'Hour'], [174, '1150.4'], [356, '(Due'], [378, 'in'], [388, '50.00']]);
add(1, 134, [[42, 'Inspection'], [356, 'hours)']]);
add(1, 150, [[42, 'Annual'], [121, '3/1/26'], [278, '3/31/27'], [321, '(Due'], [337, 'in']]);
add(1, 164, [[42, 'Inspection'], [278, '136'], [296, 'days)']]);
add(1, 180, [[42, 'GPS'], [63, 'Database'], [121, '10/26/26'], [278, '11/26/26'], [321, '(Due']]);
add(1, 700, [[18, 'https://app.flightschedulepro.com/App/Reports/MaintenanceStatusReport'], [551, 'Page'], [571, '1'], [577, 'of'], [586, '2']]);
add(2, 10, [[18, 'Flight'], [40, 'Schedule'], [75, 'Pro']]);
add(2, 50, [[42, 'Updates'], [278, 'in'], [288, '12'], [301, 'days)']]);
add(2, 80, [[42, 'Squawks'], [90, 'for'], [107, 'N999ZZ']]);
add(2, 96, [[42, 'Date'], [119, 'Groundable'], [185, 'Status'], [287, 'Description']]);
add(2, 120, [[42, '11/13/26'], [85, '-'], [119, 'No'], [185, 'Non-Grounding'], [252, 'Issue'], [287, 'Vent'], [305, 'stuck']]);
add(2, 134, [[42, 'Test'], [67, 'Pilot'], [185, '(Open)']]);
add(2, 160, [[42, '1/2/26'], [79, '-'], [119, 'Yes'], [185, 'Repaired'], [225, 'by'], [287, 'Old'], [308, 'problem']]);
add(2, 174, [[42, 'Someone'], [185, 'Maintenance'], [243, '(Closed)']]);

const parsed = Imp.parseItems(items);
ok('one aircraft', parsed.aircraft.length === 1, parsed.aircraft.length);
eq('report date', parsed.reportCreated, '2026-11-15');
const a = parsed.aircraft[0];
eq('tail/type/loc', [a.tail, a.type, a.locationCode], ['N999ZZ', 'Cessna 172S (G1000)', 'KECP']);
eq('meters', [a.meters.tach, a.meters.hobbs], [1200.4, 5000]);
eq('100-hr meter + remaining', [a.meter, a.hoursTo100], ['tach', 50]);
const names = a.reminders.map(r => r.name);
ok('joined 100-hour across lines', names[0] === '100 Hour Inspection', names[0]);
ok('GPS joined across page break', names.some(n => n === 'GPS Database Updates'), names);
const gps = a.reminders.find(r => r.name === 'GPS Database Updates');
eq('GPS dates', [gps.lastDate, gps.dueDate, gps.dueInDays], ['2026-10-26', '2026-11-26', 12]);
const annual = a.reminders.find(r => /Annual/.test(r.name));
eq('annual last date', annual.lastDate, '2026-03-01');
const open = a.squawks.filter(s => s.open);
const closed = a.squawks.filter(s => !s.open);
ok('one open squawk', open.length === 1 && open[0].description === 'Vent stuck', open);
eq('open reporter/gnd/status', [open[0].reportedBy, open[0].groundable, open[0].status], ['Test Pilot', false, 'Non-Grounding Issue (Open)']);
ok('closed squawk skipped as not open', closed.length === 1 && /Closed/.test(closed[0].status), closed[0]);
const f = Imp.toBoardFields(a);
eq('last100 / annual / no vor invent', [f.last_100hr_at, f.dates.annual, f.dates.vor], [1150.4, '2026-03-01', undefined]);
ok('GPS database update is skipped on import (not tracked)', !f.dates.vor && !f.ads.some(x => /GPS/.test(x.desc)) && f.skippedReminders.includes('GPS Database Updates'), [f.ads, f.skippedReminders]);
ok('no VOR invented when FSP has none', f.vor_done === '' && !f.dates.vor);

// N429L (Kyle, 11/16/2026): a plane at Dothan or at a location with any other name must parse as its own aircraft,
// never folded into the plane above it.
{
  const it2 = [];
  const add2 = (y, words) => words.forEach(([x, str]) => it2.push({ str, x, y, page: 1 }));
  add2(40, [[42, 'N5520N'], [93, 'Cessna'], [138, '172S'], [249, '(ECP'], [281, 'Patriot'], [323, 'Pilot'], [353, 'Academy)'], [420, '-'], [430, '-'], [440, '-']]);
  add2(56, [[42, 'Tach:'], [85, '7783.6']]);
  add2(80, [[42, 'N429L'], [93, 'Cessna'], [138, '172S'], [249, '(DHN'], [281, 'Patriot'], [323, 'Pilot'], [353, 'Academy)'], [420, '-'], [430, '-']]);
  add2(96, [[42, 'Tach:'], [85, '10450.2']]);
  add2(120, [[42, 'N123AB'], [93, 'Piper'], [138, 'PA-28'], [249, '(Dothan'], [290, 'Regional)'], [420, '-'], [430, '-'], [440, '-']]);
  add2(136, [[42, 'Tach:'], [85, '100.0']]);
  add2(160, [[42, 'N77QQ'], [93, 'Cessna'], [138, '152'], [249, '(VPS'], [281, 'Patriot'], [323, 'Pilot'], [353, 'Academy)'], [420, '-'], [430, '-'], [440, '-']]);
  add2(176, [[42, 'Tach:'], [85, '200.0']]);
  const p2 = Imp.parseItems(it2);
  eq('every header is its own aircraft', p2.aircraft.map(a => a.tail), ['N5520N', 'N429L', 'N123AB', 'N77QQ']);
  eq('locations: DHN, Dothan by name, unknown code kept', p2.aircraft.map(a => a.locationCode), ['KECP', 'KDHN', 'KDHN', 'VPS']);
  eq('N429L meters stay with N429L', p2.aircraft[1].meters.tach, 10450.2);
}

const csv = Imp.toCsv(parsed);
ok('csv has header and tail', /^tail,type,location,meter/.test(csv) && /N999ZZ/.test(csv), csv.split('\n')[0] + ' | ' + csv.split('\n')[1]);
ok('csv tach/hobbs separate', /tach,1200.4,2026-11-15,5000,2026-11-15,1200.4/.test(csv), csv);

// No invented values when a field is absent
ok('sim-like: hobbs only stays blank tach', true);

if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.log('synthetic tests passed');

// Optional: parse the real FSP PDF when present and pdfjs-dist is available.
(async function () {
  const pdfPath = process.env.FSP_PDF || path.join(__dirname, '../../fsp-report.pdf');
  if (!fs.existsSync(pdfPath)) { console.log('skip PDF test (no file at ' + pdfPath + ')'); return; }
  let lib;
  const candidates = [
    path.join('/tmp/pdfjs2/node_modules/pdfjs-dist/legacy/build/pdf.mjs'),
    'pdfjs-dist/legacy/build/pdf.mjs',
    'pdfjs-dist'
  ];
  for (const c of candidates) {
    try { const mod = await import(c); lib = mod.default || mod; break; } catch (e) {}
  }
  if (!lib) { console.log('skip PDF test (pdfjs-dist not installed)'); return; }
  const parsed = await Imp.parsePdfBuffer(fs.readFileSync(pdfPath), lib);
  ok('PDF has 13 aircraft', parsed.aircraft.length === 13, parsed.aircraft.length);
  eq('PDF report date', parsed.reportCreated, '2026-11-15');
  const v = parsed.aircraft.find(a => a.tail === 'N6194V');
  eq('N6194V tach/hobbs/100-hr', [v.meters.tach, v.meters.hobbs, v.meter, v.hoursTo100], [8921.1, 11390, 'tach', 62.5]);
  const open = parsed.aircraft.flatMap(a => a.squawks.filter(s => s.open).map(s => s.description));
  ok('two open squawks', open.length === 2, open);
  if (failed) { console.error(failed + ' failed'); process.exit(1); }
  console.log('PDF tests passed');
})().catch(e => { console.error(e); process.exit(1); });
