'use strict';

// Looks over the whole desk and writes the to-dos nobody got round to writing.
//
// Runs on the same cron as the site monitor. It only ever CREATES to-dos — it
// never edits a lead, moves a deal, sends an email or completes anything. That
// limit is the point: a rule that gets it wrong costs you one line on a list.
//
//   node cron/run-rules.js            write the new to-dos
//   node cron/run-rules.js --dry-run  print what it would write, touch nothing
//   node cron/run-rules.js --all      ignore the per-run cap (see below)

const crypto = require('crypto');

const db = require('../lib/db');
const rules = require('../lib/rules');

// The first run sees everything at once — every lead that ever went quiet, every
// meeting with no write-up. Dumping two hundred to-dos on someone is how an
// automation gets switched off on day one. So a run adds at most this many, and
// the rest arrive on later runs as the list is cleared.
const MAX_PER_RUN = 15;

// When two rules fire on the same record, the more urgent one goes first, and
// the cap is spent on what matters rather than on whatever sorted first.
const PRIORITY = [
  'site-down',
  'next-step-due',
  'doc-awaiting-answer',
  'renewal-due',
  'lead-cold',
  'deal-stalled',
  'meeting-write-up',
];

function rank(p) {
  const i = PRIORITY.indexOf(p.ruleId);
  return i === -1 ? PRIORITY.length : i;
}

function newId() {
  return 'r' + crypto.randomBytes(8).toString('hex');
}

async function snapshot() {
  const data = {};
  for (const name of db.COLLECTIONS) data[name] = await db.list(name);
  return data;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const noCap = process.argv.includes('--all');

  await db.init();
  const data = await snapshot();

  // Whoever signed in most recently owns anything the record does not name an
  // owner for — better a to-do with the wrong name on it than one with none.
  const team = await db.listTeam();

  const found = rules.newProposals(data, new Date(), {
    defaultOwner: team[0] || '',
    onError: (id, err) => console.error('[rules] rule "' + id + '" failed:', err.message),
  });

  if (!found.length) {
    console.log('[rules] nothing to raise — ' + (data.tasks || []).length + ' to-do(s) already on the list');
    if (!dryRun) await db.pool.end();
    return;
  }

  found.sort((a, b) => rank(a) - rank(b) || String(a.due).localeCompare(String(b.due)));
  const take = noCap ? found : found.slice(0, MAX_PER_RUN);
  const held = found.length - take.length;

  for (const p of take) {
    const task = rules.toTask(p, new Date(), newId);
    console.log('[rules] ' + (dryRun ? 'would add' : 'adding') + ': ' + task.title +
      '  (' + p.ruleId + ', due ' + (task.due || 'no date') + ')');
    if (dryRun) continue;
    await db.put('tasks', task.id, task, 'Desk');
    await db.logActivity('Desk', 'create', 'tasks', task.id,
      'Raised automatically: ' + task.title);
  }

  console.log('[rules] ' + (dryRun ? 'would raise ' : 'raised ') + take.length + ' to-do(s)' +
    (held ? '; held back ' + held + ' for the next run so the list stays readable' : ''));

  if (!dryRun) await db.pool.end();
}

main().catch((err) => {
  console.error('[rules] run failed:', err);
  process.exit(1);
});
