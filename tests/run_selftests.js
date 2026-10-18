// Runs the same self-tests that the browser UI exposes ("Run self-tests" button).
const RL = require('../engine/core.js');
const t0 = Date.now(); const res = RL.selfTests(); let fails = 0;
for (const r of res) { console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + '\n       ' + r.detail); if (!r.pass) fails++; }
console.log(`\n${res.length - fails}/${res.length} passed in ${Date.now() - t0} ms`);
process.exit(fails ? 1 : 0);
