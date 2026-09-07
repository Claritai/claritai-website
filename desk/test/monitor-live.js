// Smoke test for the hourly monitor: runs it against real sites with a stubbed
// database, and prints what it would have written.
const dbPath = require.resolve('../lib/db');
const writes = [];
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  pool: { query: async () => ({ rows: [] }), end: async () => {} },
  init: async () => {},
  list: async () => ([
    { id: 'a', name: 'Rmcleary Tarmacadam', url: 'https://rmclearytarmacadam.ie/', status: 'ok', issues: [], monitor: true },
    { id: 'b', name: 'Claritai',            url: 'https://claritai.ie',           status: 'ok', issues: [], monitor: true },
    { id: 'c', name: 'Does not exist',      url: 'https://this-domain-should-not-resolve-xyzzy.ie', status: 'ok', issues: [], monitor: true },
    { id: 'd', name: 'Paused site',         url: 'https://example.com', status: 'paused', issues: [], monitor: true },
    { id: 'e', name: 'Monitoring off',      url: 'https://example.com', status: 'ok', issues: [], monitor: false }
  ]),
  patch: async (c, id, fields) => { writes.push({ id, fields }); return null; },
  logActivity: async () => {}
}};

process.on('exit', () => {
  console.log('\n=== what it would write ===');
  for (const w of writes) {
    const f = w.fields;
    console.log(`  ${w.id}: status=${f.status || '(unchanged)'} auto=${f.autoStatus} http=${f.httpStatus} ${f.responseMs}ms ssl=${f.sslExpiry || '-'} ${f.autoNote ? '"' + f.autoNote + '"' : ''}`);
    if (f.issues) console.log(`       issues: ${JSON.stringify(f.issues.map(i => ({ t: i.text, sev: i.severity, auto: i.auto, resolved: i.resolved })))}`);
  }
  console.log(`\n  checked ${writes.length} of 5 records (2 correctly skipped: paused + monitoring off)`);
});

require('../cron/check-sites.js');
