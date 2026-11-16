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
let activeEmail = 'secretary@x.com';
let sheets = {}; // name -> { name, rows, frozen, validations, formats, filter }
let sheetOrder = [];

function makeSheet(name, seedRows) {
  const sh = {
    name,
    rows: seedRows ? seedRows.map(r => r.slice()) : [],
    frozen: 0,
    validations: [],
    formats: [],
    filter: null,
    maxRows: 100,
    getName: () => sh.name,
    getLastRow: () => sh.rows.length,
    getLastColumn: () => sh.rows.reduce((m, r) => Math.max(m, r.length), 0),
    getMaxRows: () => sh.maxRows,
    getDataRange: () => ({ getValues: () => sh.rows.map(r => r.slice()) }),
    getFilter: () => sh.filter,
    setFrozenRows: (n) => { sh.frozen = n; },
    getConditionalFormatRules: () => sh.formats.slice(),
    setConditionalFormatRules: (rules) => { sh.formats = rules.slice(); },
    appendRow: (r) => { sh.rows.push(r.slice()); },
    getRange: (r, c, nr, nc) => {
      if (nr == null && nc == null) {
        return {
          setValue: (v) => { sh.rows[r - 1] = sh.rows[r - 1] || []; sh.rows[r - 1][c - 1] = v; },
          getValue: () => (sh.rows[r - 1] || [])[c - 1],
          clearContent: () => { if (sh.rows[r - 1]) sh.rows[r - 1][c - 1] = ''; },
          getSheet: () => sh,
          getRow: () => r,
          getColumn: () => c,
          getNumRows: () => 1,
          getNumColumns: () => 1
        };
      }
      return {
        getValues: () => {
          const out = [];
          for (let i = 0; i < (nr || 1); i++) out.push((sh.rows[r - 1 + i] || []).slice(c - 1, c - 1 + (nc || 1)));
          return out;
        },
        setValues: (vals) => {
          vals.forEach((row, i) => {
            sh.rows[r - 1 + i] = sh.rows[r - 1 + i] || [];
            row.forEach((v, j) => { sh.rows[r - 1 + i][c - 1 + j] = v; });
          });
        },
        setValue: (v) => { sh.rows[r - 1] = sh.rows[r - 1] || []; sh.rows[r - 1][c - 1] = v; },
        getValue: () => (sh.rows[r - 1] || [])[c - 1],
        clearContent: () => { if (sh.rows[r - 1]) sh.rows[r - 1][c - 1] = ''; },
        setDataValidation: (rule) => { sh.validations.push({ r, c, nr, nc, rule }); },
        createFilter: () => { sh.filter = { range: { r, c, nr, nc }, remove() { sh.filter = null; } }; return sh.filter; },
        getSheet: () => sh,
        getRow: () => r,
        getColumn: () => c,
        getNumRows: () => nr || 1,
        getNumColumns: () => nc || 1
      };
    }
  };
  return sh;
}

function chain(extra) {
  const o = Object.assign({
    whenFormulaSatisfied() { return this; },
    setBackground() { return this; },
    setRanges() { return this; },
    requireCheckbox() { return this; },
    setAllowInvalid() { return this; },
    build() { return { type: extra || 'rule' }; }
  }, {});
  return o;
}

const ctx = {
  console, JSON, Date, Math, Number, String, Object, Array, Error, encodeURIComponent,
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getSheetByName: (n) => sheets[n] || null,
      getSheets: () => sheetOrder.map(n => sheets[n]).filter(Boolean),
      insertSheet: (n) => {
        const sh = makeSheet(n);
        sheets[n] = sh;
        sheetOrder.unshift(n);
        return sh;
      }
    }),
    newDataValidation: () => chain('checkbox'),
    newConditionalFormatRule: () => chain('format')
  },
  Utilities: {
    formatDate: (d, tz, f) => {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      }).formatToParts(d);
      const g = k => parts.find(p => p.type === k).value;
      if (f === 'yyyy-MM MMM') return `${g('year')}-${g('month')} ` + new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short' }).format(d);
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
  Session: { getActiveUser: () => ({ getEmail: () => activeEmail }) },
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

const OLD_HEADERS = [
  'Submitted (America/Chicago)', 'Flight date', 'Tail', 'Location',
  'CFI name', 'CFI email', 'Student',
  'Tach start', 'Tach end', 'Tach time',
  'Hobbs start', 'Hobbs end', 'Hobbs time',
  'Oil added (Y/N)', 'Oil qts', 'Squawk text', 'Report ID',
  'Tach photo', 'Hobbs photo'
];

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
function monthSheet() {
  const name = sheetOrder.find(n => /^\d{4}-\d{2} /.test(n));
  return name ? sheets[name] : null;
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
const sh = monthSheet();
ok('monthly tab created', !!sh);
const rows = sh.rows;
eq('header row present', rows[0][16], 'Report ID');
eq('header has Tach photo', rows[0][17], 'Tach photo');
eq('header has Hobbs photo', rows[0][18], 'Hobbs photo');
eq('header has Billed', rows[0][19], 'Billed');
eq('header has Billed by', rows[0][20], 'Billed by');
eq('header has Billed on', rows[0][21], 'Billed on');
eq('tail in row', rows[1][2], 'N734PA');
eq('location in row', rows[1][3], 'KECP');
eq('oil Y', rows[1][13], 'Y');
eq('oil qts', rows[1][14], 1.5);
eq('tach time', rows[1][9], 1.4);
eq('hobbs time', rows[1][12], 1.6);
eq('Chicago flight date', rows[1][1], '2026-11-15');
eq('Chicago submitted hour', rows[1][0], '2026-11-15 20:30');
eq('report id col', rows[1][16], 'rep-001');
eq('new row billed is false', rows[1][19], false);
eq('new row billed by blank', rows[1][20], '');
eq('new row billed on blank', rows[1][21], '');
ok('header frozen', sh.frozen === 1);
ok('checkbox validation on Billed column', sh.validations.some(v => v.c === 20));
ok('conditional format rules added', sh.formats.length === 2);
ok('filter applied', !!sh.filter);

const dup = ctx.appendFlightLog(JSON.stringify(base));
ok('duplicate report id is skipped', dup.ok && dup.duplicate && !dup.added);
eq('still one data row after duplicate', sh.rows.length, 2);

const withPhoto = { ...base, reportId: 'rep-002', tachPhoto: Buffer.from('fake-jpeg-bytes').toString('base64') };
const ok2 = ctx.appendFlightLog(JSON.stringify(withPhoto));
ok('photo saved to Drive folder', ok2.added && files.length === 1 && /tach/.test(files[0].name));
eq('tach photo link written', sh.rows[2][17], files[0].url);
eq('hobbs photo blank when omitted', sh.rows[2][18], '');
eq('photo row still has billed checkbox value', sh.rows[2][19], false);

mustThrow('huge photo rejected', () => {
  const huge = { ...base, reportId: 'rep-big', tachPhoto: 'A'.repeat(Math.ceil(2 * 1024 * 1024 * 4 / 3) + 100) };
  ctx.parseAndValidate(JSON.stringify(huge));
  ctx.appendFlightLog(JSON.stringify(huge));
}, /too large/);

if (!/^\d{4}-\d{2} [A-Z][a-z]{2}$/.test(sh.name)) { failed++; console.log('FAIL monthly tab name', sh.name); }
else console.log('ok monthly tab', sh.name);

// Existing "Flight Log" tab (older layout, photos already present) gets billing columns on the right.
const oldRow = ['2026-10-02 09:00', '2026-10-02', 'N6194V', 'KECP', 'Pat CFI', 'pat@x.com', '', 100, 101, 1, 200, 201, 1, 'N', '', '', 'rep-old', 'https://drive/old-tach', ''];
const legacy = makeSheet('Flight Log', [OLD_HEADERS.slice(), oldRow.slice()]);
sheets['Flight Log'] = legacy;
sheetOrder.push('Flight Log');
ctx.ensureAllLogTabs_();
eq('legacy tab keeps Report ID in place', legacy.rows[0][16], 'Report ID');
eq('legacy tab keeps Tach photo in place', legacy.rows[0][17], 'Tach photo');
eq('legacy tab keeps Hobbs photo in place', legacy.rows[0][18], 'Hobbs photo');
eq('legacy tab adds Billed on the right', legacy.rows[0][19], 'Billed');
eq('legacy tab adds Billed by on the right', legacy.rows[0][20], 'Billed by');
eq('legacy tab adds Billed on on the right', legacy.rows[0][21], 'Billed on');
eq('legacy data row photos not shifted', legacy.rows[1][17], 'https://drive/old-tach');
eq('legacy data row report id not shifted', legacy.rows[1][16], 'rep-old');

// Dedupe still sees the old tab's report id, and a new id lands in the November tab.
const dupOld = ctx.appendFlightLog(JSON.stringify({ ...base, reportId: 'rep-old', createdAt: '2026-11-16T02:30:00.000Z' }));
ok('duplicate across tabs is skipped', dupOld.ok && dupOld.duplicate && !dupOld.added);
const beforeNov = sh.rows.length;
const ok3 = ctx.appendFlightLog(JSON.stringify({ ...base, reportId: 'rep-003' }));
ok('new report still appends after upgrading legacy tab', ok3.added);
eq('november tab gained the new row', sh.rows.length, beforeNov + 1);
eq('new row photos stay in photo columns', sh.rows[sh.rows.length - 1][17], '');

// onEdit: check Billed → fill date and email if Billed by is blank.
function editEvent(sheet, row, col, rows, cols) {
  return {
    range: {
      getSheet: () => sheet,
      getRow: () => row,
      getColumn: () => col,
      getNumRows: () => rows || 1,
      getNumColumns: () => cols || 1
    }
  };
}
const billedCol = 20, byCol = 21, onCol = 22;
sh.rows[1][billedCol - 1] = true;
sh.rows[1][byCol - 1] = '';
ctx.handleBilledEdit_(editEvent(sh, 2, billedCol));
eq('checking Billed fills Billed on (Chicago today)', sh.rows[1][onCol - 1], ctx.Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd'));
eq('checking Billed leaves Billed by for initials', sh.rows[1][byCol - 1], '');

sh.rows[1][byCol - 1] = 'KH';
sh.rows[1][billedCol - 1] = true;
ctx.handleBilledEdit_(editEvent(sh, 2, billedCol));
eq('existing initials are left alone', sh.rows[1][byCol - 1], 'KH');

sh.rows[1][billedCol - 1] = false;
ctx.handleBilledEdit_(editEvent(sh, 2, billedCol));
eq('unchecking Billed clears Billed on', sh.rows[1][onCol - 1], '');
eq('unchecking Billed leaves initials', sh.rows[1][byCol - 1], 'KH');

sh.rows[2][billedCol - 1] = true;
sh.rows[2][byCol - 1] = '';
sh.rows[2][onCol - 1] = '';
ctx.handleBilledEdit_(editEvent(sh, 3, billedCol));
eq('Billed by stays blank for the secretary to initial', sh.rows[2][byCol - 1], '');
ok('date still filled when Billed by is blank', !!sh.rows[2][onCol - 1]);

// Editing a non-Billed cell or a non-log tab is ignored.
const other = makeSheet('Notes', [['x'], ['y']]);
sheets.Notes = other;
sheetOrder.push('Notes');
other.rows[1][0] = 'keep';
ctx.handleBilledEdit_(editEvent(other, 2, 1));
eq('onEdit ignores non-log tabs', other.rows[1][0], 'keep');
const prevDate = sh.rows[2][onCol - 1];
ctx.handleBilledEdit_(editEvent(sh, 3, 3));
eq('onEdit ignores non-Billed columns', sh.rows[2][onCol - 1], prevDate);

if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.log('flight-log tests passed');
