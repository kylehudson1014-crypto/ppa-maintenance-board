// Run apps-script/flight-log.gs in Node with Apps Script mocks (no live network, no Firestore writes).
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const R = path.join(__dirname, '..') + '/';

let failed = 0;
function ok(name, cond, detail) {
  if (cond) console.log('PASS', name);
  else { failed++; console.log('FAIL', name, detail === undefined ? '' : detail); }
}
function eq(name, a, b) {
  const as = JSON.stringify(a), bs = JSON.stringify(b);
  ok(name, as === bs, as + ' !== ' + bs);
}

const props = { SHARED_TOKEN: 'test-token-123' };
const files = [];
let folderCreated = false;
let rows = [];

function colValues() {
  return rows.map(r => r.slice());
}

const sheet = {
  getLastRow: () => rows.length,
  getLastColumn: () => (rows[0] ? rows[0].length : 0),
  getDataRange: () => ({ getValues: () => colValues() }),
  getRange: (r, c, nr, nc) => {
    if (nr == null) {
      return { setValue: (v) => { rows[r - 1] = rows[r - 1] || []; rows[r - 1][c - 1] = v; } };
    }
    return {
      getValues: () => {
        const out = [];
        for (let i = 0; i < (nr || 1); i++) out.push((rows[r - 1 + i] || []).slice(c - 1, c - 1 + (nc || 1)));
        return out;
      },
      setValues: (vals) => {
        vals.forEach((row, i) => {
          rows[r - 1 + i] = rows[r - 1 + i] || [];
          row.forEach((v, j) => { rows[r - 1 + i][c - 1 + j] = v; });
        });
      }
    };
  },
  setFrozenRows: () => {},
  appendRow: (r) => { rows.push(r.slice()); }
};

const ctx = {
  console, JSON, Date, Math, Number, String, Object, Array, Error, encodeURIComponent,
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getSheetByName: (n) => (n === 'Flight Log' && rows.length ? sheet : null),
      insertSheet: (n) => { rows = []; return sheet; }
    })
  },
  Utilities: {
    formatDate: (d, tz, f) => {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      }).formatToParts(d);
      const g = k => parts.find(p => p.type === k).value;
      if (f === 'yyyy-MM-dd') return `${g('year')}-${g('month')}-${g('day')}`;
      if (f === 'yyyy-MM-dd HH:mm') return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`;
      return d.toISOString();
    },
    base64Decode: (s) => Buffer.from(s, 'base64'),
    newBlob: (bytes, type, name) => ({ bytes, type, name })
  },
  DriveApp: {
    getFoldersByName: () => ({ hasNext: () => folderCreated, next: () => folder }),
    createFolder: () => { folderCreated = true; return folder; }
  },
  ContentService: {
    MimeType: { JSON: 'json' },
    createTextOutput: (s) => ({ text: s, setMimeType() { return this; } })
  }
};
const folder = {
  createFile: (blob) => {
    const f = { url: 'https://drive.google.com/file/d/fake-' + files.length, getUrl() { return this.url; } };
    files.push({ name: blob.name, bytes: blob.bytes && blob.bytes.length, url: f.url });
    return f;
  }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(R + 'apps-script/flight-log.gs', 'utf8'), ctx);

const base = {
  token: 'test-token-123',
  reportId: 'rep-001',
  createdAt: '2026-11-16T02:30:00.000Z', // 20:30 on Nov 15 in Chicago (UTC-6)
  tail: 'N734PA',
  location: 'KECP',
  cfiName: 'Pat CFI',
  cfiEmail: 'pat@x.com',
  student: 'Alex Student',
  tachStart: 4412.6, tachEnd: 4414.0,
  hobbsStart: 5120.3, hobbsEnd: 5121.9,
  oilAdded: true, oilQts: 1.5,
  squawkText: 'Landing light inop',
  tachPhoto: '', hobbsPhoto: ''
};

function mustThrow(name, fn, re) {
  try { fn(); failed++; console.log('FAIL', name, 'did not throw'); }
  catch (e) { ok(name, re.test(String(e.message || e)), String(e.message || e)); }
}

mustThrow('empty body rejected', () => ctx.parseAndValidate(''), /Empty/);
mustThrow('bad json rejected', () => ctx.parseAndValidate('{nope'), /JSON/);
mustThrow('bad token rejected', () => ctx.parseAndValidate(JSON.stringify({ ...base, token: 'nope' })), /Token/);
mustThrow('missing reportId rejected', () => ctx.parseAndValidate(JSON.stringify({ ...base, reportId: '' })), /Report ID/);
mustThrow('missing tail rejected', () => ctx.parseAndValidate(JSON.stringify({ ...base, tail: '' })), /Tail/);
mustThrow('end before start rejected', () => ctx.parseAndValidate(JSON.stringify({ ...base, tachEnd: 100 })), /earlier/);
mustThrow('invalid oil quarts rejected', () => ctx.parseAndValidate(JSON.stringify({ ...base, oilQts: 9 })), /quarts/);

const clamped = ctx.parseAndValidate(JSON.stringify({ ...base, student: 'x'.repeat(81) }));
eq('student clamped to 80', clamped.student.length, 80);

const ok1 = ctx.appendFlightLog(JSON.stringify(base));
ok('first append adds a row', ok1.ok && ok1.added && !ok1.duplicate);
eq('header row present', rows[0][16], 'Report ID');
eq('header has Tach photo', rows[0][17], 'Tach photo');
eq('header has Hobbs photo', rows[0][18], 'Hobbs photo');
eq('tail in row', rows[1][2], 'N734PA');
eq('location in row', rows[1][3], 'KECP');
eq('oil Y', rows[1][13], 'Y');
eq('oil qts', rows[1][14], 1.5);
eq('tach time', rows[1][9], 1.4);
eq('hobbs time', rows[1][12], 1.6);
eq('Chicago flight date', rows[1][1], '2026-11-15');
eq('Chicago submitted hour', rows[1][0], '2026-11-15 20:30');
eq('report id col', rows[1][16], 'rep-001');

const dup = ctx.appendFlightLog(JSON.stringify(base));
ok('duplicate report id is skipped', dup.ok && dup.duplicate && !dup.added);
eq('still one data row after duplicate', rows.length, 2);

const withPhoto = { ...base, reportId: 'rep-002', tachPhoto: Buffer.from('fake-jpeg-bytes').toString('base64') };
const ok2 = ctx.appendFlightLog(JSON.stringify(withPhoto));
ok('photo saved to Drive folder', ok2.added && files.length === 1 && /tach/.test(files[0].name));
eq('tach photo link written', rows[2][17], files[0].url);
eq('hobbs photo blank when omitted', rows[2][18], '');

mustThrow('huge photo rejected', () => {
  const huge = { ...base, reportId: 'rep-big', tachPhoto: 'A'.repeat(Math.ceil(2 * 1024 * 1024 * 4 / 3) + 100) };
  ctx.parseAndValidate(JSON.stringify(huge));
  ctx.appendFlightLog(JSON.stringify(huge));
}, /too large/);

if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.log('flight-log tests passed');
