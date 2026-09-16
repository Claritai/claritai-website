// The cron runner, with the database stubbed out. Nothing real is written and
// no connection is opened. What is being checked here is the behaviour that is
// NOT in the pure rules engine: the per-run cap, the order the cap spends
// itself in, and the promise that --dry-run touches nothing.

const assert = require('assert');

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')); }
};

const NOW = Date.now();
const ago = (d) => new Date(NOW - d * 86400000).toISOString();
const day = (iso) => String(iso).slice(0, 10);

// Enough stale records to go well past the cap, spread across several rules.
const leads = [];
for (let i = 0; i < 20; i++) {
  leads.push({
    id: 'l' + i, name: 'Lead ' + i, status: 'contacted', addedBy: 'Sean',
    addedAt: ago(90), activity: [{ by: 'Sean', at: ago(30 + i), text: 'Emailed.' }],
  });
}
const deals = [{
  id: 'd1', company: 'Swans Bar', stage: 'proposal', owner: 'Sean',
  createdAt: ago(60), notes: [{ at: ago(2), text: 'x' }],
  nextStep: 'Call Marie about the deposit', nextStepDate: day(ago(4)),
}];
const sites = [{
  id: 's1', name: 'mybianca.com', status: 'crit',
  issues: [{ text: '503 from the server.', openedAt: ago(5), resolved: false }],
}];

const store = { tasks: [] };
const written = [];
const logged = [];
let poolEnded = false;

const dbPath = require.resolve('../lib/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  pool: { query: async () => ({ rows: [] }), end: async () => { poolEnded = true; } },
  COLLECTIONS: ['leads', 'clients', 'deals', 'docs', 'tasks', 'meetings', 'sites', 'social'],
  init: async () => {},
  list: async (c) => (c === 'leads' ? leads : c === 'deals' ? deals : c === 'sites' ? sites
    : c === 'tasks' ? store.tasks : []),
  get: async () => null,
  put: async (c, id, data) => { written.push({ c, id, data }); store.tasks.push(Object.assign({ id }, data)); return data; },
  patch: async () => null,
  remove: async () => {},
  logActivity: async (actor, action, c, id, summary) => { logged.push(summary); },
  recordUser: async () => {},
  listTeam: async () => ['Sean'],
}};

// The cron runs on require, so each pass needs a fresh copy of it.
const cronPath = require.resolve('../cron/run-rules.js');
function runCron(argv) {
  delete require.cache[cronPath];
  const saved = process.argv;
  process.argv = ['node', 'run-rules.js'].concat(argv || []);
  require(cronPath);
  process.argv = saved;
  // main() is async; let it settle.
  return new Promise((r) => setTimeout(r, 60));
}

(async () => {
  // ---- dry run first: it must write nothing at all ----
  await runCron(['--dry-run']);
  check('a dry run writes no to-dos', written.length === 0, written.length + ' written');
  check('a dry run leaves the connection alone', poolEnded === false);

  // ---- a real run ----
  await runCron([]);
  check('a real run writes to-dos', written.length > 0, written.length + ' written');
  check('it caps the first run rather than dumping everything',
    written.length === 15, written.length + ' written');
  check('everything written is a to-do', written.every((w) => w.c === 'tasks'));
  check('each one carries its key', written.every((w) => !!w.data.autoKey));
  check('each one explains itself', written.every((w) => !!w.data.notes));
  check('each one is credited to Desk, not a person', logged.every((s) => /Raised automatically/.test(s)));
  check('it closes the connection', poolEnded === true);

  // The cap must be spent on the urgent things, not on whatever sorted first.
  const firstTwo = written.slice(0, 2).map((w) => w.data.autoRule);
  check('the site that is down comes first', firstTwo[0] === 'site-down', JSON.stringify(firstTwo));
  check('the overdue next step comes second', firstTwo[1] === 'next-step-due', JSON.stringify(firstTwo));

  // ---- run again: the ones already raised must not come back ----
  const after = written.length;
  await runCron([]);
  const added = written.length - after;
  check('a second run does not repeat itself', added > 0 && added <= 15, added + ' added');
  const keys = written.map((w) => w.data.autoKey);
  check('no key is ever written twice', new Set(keys).size === keys.length,
    keys.length + ' written, ' + new Set(keys).size + ' distinct');

  // ---- and once the backlog is cleared, it goes quiet ----
  await runCron(['--all']);
  await runCron(['--all']);
  const settled = written.length;
  await runCron(['--all']);
  check('with nothing new to say it writes nothing', written.length === settled,
    (written.length - settled) + ' extra');

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
