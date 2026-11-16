// Every browser script must parse (catches quote slips in HTML strings).
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const dir = path.join(__dirname, '../js'); let failed = 0;
fs.readdirSync(dir).filter(f => f.endsWith('.js')).concat(['../sw.js']).forEach(f => {
  try { new vm.Script(fs.readFileSync(path.join(dir, f), 'utf8'), { filename: f }); console.log('ok', f); }
  catch (e) { failed++; console.error('FAIL', f, e.message); }
});
if (failed) process.exit(1); console.log('syntax tests passed');
