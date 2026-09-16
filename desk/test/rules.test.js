// The rules engine is pure, so these tests are just data in and proposals out.
// No server, no database, no clock — every test pins its own "now".

const rules = require('../lib/rules');

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')); }
};

const NOW = new Date('2026-09-16T09:00:00Z');
const ago = (d) => new Date(NOW.getTime() - d * 86400000).toISOString();
const ahead = (d) => new Date(NOW.getTime() + d * 86400000).toISOString();
const day = (iso) => String(iso).slice(0, 10);

const empty = { leads: [], clients: [], deals: [], docs: [], tasks: [], meetings: [], sites: [], social: [] };
const snap = (over) => Object.assign({}, empty, over || {});
const run = (over, opts) => rules.newProposals(snap(over), NOW, opts);
const ids = (list) => list.map((p) => p.ruleId).sort();

/* ---------------- nothing in, nothing out ---------------- */

check('an empty desk proposes nothing', run({}).length === 0);

/* ---------------- leads going cold ---------------- */

const lead = (over) => Object.assign({
  id: 'l1', name: 'Navan Tyres', status: 'contacted', addedBy: 'Sean',
  addedAt: ago(40), activity: [{ by: 'Sean', at: ago(20), text: 'Emailed.' }],
}, over || {});

let out = run({ leads: [lead()] });
check('a lead untouched for 20 days is raised', out.length === 1 && out[0].ruleId === 'lead-cold', JSON.stringify(ids(out)));
check('it names the lead', /Chase Navan Tyres/.test(out[0].title), out[0] && out[0].title);
check('it says why', /20 days/.test(out[0].why), out[0] && out[0].why);
check('it inherits the owner', out[0].owner === 'Sean');

check('a lead touched yesterday is left alone',
  run({ leads: [lead({ activity: [{ at: ago(1), text: 'Called.' }] })] }).length === 0);

check('a contacted lead at 9 days is still inside the window',
  run({ leads: [lead({ activity: [{ at: ago(9), text: 'x' }] })] }).length === 0);
check('a new lead at 9 days is outside the shorter window',
  run({ leads: [lead({ status: 'new', activity: [{ at: ago(9), text: 'x' }] })] }).length === 1);

check('a promoted lead is not chased',
  run({ leads: [lead({ status: 'promoted' })] }).length === 0);
check('a dead lead is not chased',
  run({ leads: [lead({ status: 'dead' })] }).length === 0);

check('thresholds can be tightened',
  run({ leads: [lead({ activity: [{ at: ago(3), text: 'x' }] })] }, { thresholds: { leadContacted: 2 } }).length === 1);

/* ---------------- deals that stop moving ---------------- */

const deal = (over) => Object.assign({
  id: 'd1', company: 'Swans Bar', stage: 'negotiation', owner: 'Sean',
  createdAt: ago(60), notes: [{ by: 'Sean', at: ago(21), text: 'Sent revised figure.' }],
}, over || {});

out = run({ deals: [deal()] });
check('a deal with no movement for 21 days is raised', ids(out).includes('deal-stalled'), JSON.stringify(ids(out)));
check('a won deal is left alone', run({ deals: [deal({ stage: 'won' })] }).length === 0);
check('a lost deal is left alone', run({ deals: [deal({ stage: 'lost' })] }).length === 0);
check('a deal touched last week is left alone',
  run({ deals: [deal({ notes: [{ at: ago(6), text: 'x' }] })] }).length === 0);
check('the proposal links back to the deal', out[0].dealId === 'd1');

/* ---------------- next step falling due ---------------- */

out = run({ deals: [deal({ notes: [{ at: ago(1), text: 'x' }], nextStep: 'Call Marie about the deposit', nextStepDate: day(ago(3)) })] });
check('an overdue next step is raised', out.length === 1 && out[0].ruleId === 'next-step-due', JSON.stringify(ids(out)));
check('it uses the words you typed', /Call Marie about the deposit/.test(out[0].title), out[0] && out[0].title);
check('the to-do is due on the date you set, not today', out[0].due === day(ago(3)), out[0] && out[0].due);

check('a next step due tomorrow is not raised yet',
  run({ deals: [deal({ notes: [{ at: ago(1), text: 'x' }], nextStep: 'Call', nextStepDate: day(ahead(1)) })] }).length === 0);
check('a next step due today IS raised',
  run({ deals: [deal({ notes: [{ at: ago(1), text: 'x' }], nextStep: 'Call', nextStepDate: day(ago(0)) })] }).length === 1);
check('a next step with no date is ignored',
  run({ deals: [deal({ notes: [{ at: ago(1), text: 'x' }], nextStep: 'Call', nextStepDate: '' })] }).length === 0);

/* ---------------- proposals awaiting an answer ---------------- */

const doc = (over) => Object.assign({
  id: 'o1', title: 'Website proposal', kind: 'proposal', status: 'sent',
  dealId: 'd1', clientId: '', _updatedAt: ago(9),
}, over || {});

out = run({ docs: [doc()], deals: [deal({ notes: [{ at: ago(1), text: 'x' }] })] });
check('a proposal sent 9 days ago is raised', ids(out).includes('doc-awaiting-answer'), JSON.stringify(ids(out)));
check('it names the deal it belongs to', /Swans Bar/.test(out[0].title), out[0] && out[0].title);
check('a signed document is left alone', run({ docs: [doc({ status: 'signed' })] }).length === 0);
check('a draft is left alone', run({ docs: [doc({ status: 'draft' })] }).length === 0);
check('a brief is not an offer awaiting an answer', run({ docs: [doc({ kind: 'brief' })] }).length === 0);
check('a proposal sent two days ago is left alone', run({ docs: [doc({ _updatedAt: ago(2) })] }).length === 0);
check('an explicit sentAt wins over the last write',
  run({ docs: [doc({ sentAt: ago(2), _updatedAt: ago(30) })] }).length === 0);

/* ---------------- renewals ---------------- */

const client = (over) => Object.assign({
  id: 'c1', name: 'RM Cleary Tarmacadam', status: 'active', owner: 'Sean',
  contract: { startDate: ago(400), renewalDate: day(ahead(20)), noticePeriod: '30 days' },
}, over || {});

out = run({ clients: [client()] });
check('a renewal 20 days out is raised', out.length === 1 && out[0].ruleId === 'renewal-due', JSON.stringify(ids(out)));
check('it quotes the notice period', /30 days/.test(out[0].why), out[0] && out[0].why);
check('a renewal 60 days out is not raised yet',
  run({ clients: [client({ contract: { renewalDate: day(ahead(60)) } })] }).length === 0);
check('a renewal that has already passed is not raised',
  run({ clients: [client({ contract: { renewalDate: day(ago(5)) } })] }).length === 0);
check('a former customer is not chased for renewal',
  run({ clients: [client({ status: 'former' })] }).length === 0);
check('a customer with no contract dates is skipped',
  run({ clients: [client({ contract: {} })] }).length === 0);

/* ---------------- sites down ---------------- */

const site = (over) => Object.assign({
  id: 's1', name: 'mybianca.com', status: 'crit', clientId: 'c1',
  issues: [{ text: 'Site returned 503.', severity: 'crit', openedAt: ago(4), auto: true, resolved: false }],
}, over || {});

out = run({ sites: [site()] });
check('a site critical for 4 days is raised', out.length === 1 && out[0].ruleId === 'site-down', JSON.stringify(ids(out)));
check('it repeats what the monitor said', /503/.test(out[0].why), out[0] && out[0].why);
check('a healthy site is left alone', run({ sites: [site({ status: 'ok' })] }).length === 0);
check('a site down since this morning is left alone',
  run({ sites: [site({ issues: [{ openedAt: ago(0), resolved: false }] })] }).length === 0);
check('a resolved issue does not count',
  run({ sites: [site({ issues: [{ openedAt: ago(9), resolved: true }] })] }).length === 0);
check('a critical site with no issue recorded is skipped', run({ sites: [site({ issues: [] })] }).length === 0);

/* ---------------- meeting write-ups ---------------- */

const meeting = (over) => Object.assign({
  id: 'm1', title: 'Discovery call — Gerry Duffy', start: ago(3), attendees: 'Sean', dealId: 'd1',
}, over || {});

out = run({ meetings: [meeting()] });
check('a meeting three days ago with no write-up is raised', out.length === 1 && out[0].ruleId === 'meeting-write-up', JSON.stringify(ids(out)));
check('a future meeting is not raised', run({ meetings: [meeting({ start: ahead(2) })] }).length === 0);
check('a meeting with an outcome is not raised', run({ meetings: [meeting({ outcome: 'They want the bigger package.' })] }).length === 0);
check('a note written after the meeting counts as the write-up',
  run({ meetings: [meeting({ notes: [{ at: ago(2), text: 'Went well.' }] })] }).length === 0);
check('a note written BEFORE the meeting does not count',
  run({ meetings: [meeting({ notes: [{ at: ago(5), text: 'Agenda.' }] })] }).length === 1);
check('an old meeting is not dredged up',
  run({ meetings: [meeting({ start: ago(90) })] }).length === 0);

/* ---------------- the dedupe key: the whole point ---------------- */

const stale = { leads: [lead()] };
const first = rules.newProposals(snap(stale), NOW);
check('a proposal carries a key', !!first[0].autoKey, JSON.stringify(first[0]));

const asTask = rules.toTask(first[0], NOW, () => 't-fixed');
check('the key survives onto the to-do', asTask.autoKey === first[0].autoKey);
check('the reason becomes the to-do notes', asTask.notes === first[0].why);
check('the to-do starts undone', asTask.done === false);
check('it is marked as automatic', asTask.autoRule === 'lead-cold' && !!asTask.autoAt);

check('running again with that to-do present proposes nothing',
  rules.newProposals(snap(Object.assign({ tasks: [asTask] }, stale)), NOW).length === 0);

check('a COMPLETED to-do also silences it — you already did the thing',
  rules.newProposals(snap(Object.assign({ tasks: [Object.assign({}, asTask, { done: true })] }, stale)), NOW).length === 0);

check('someone else\'s unrelated to-do does not silence it',
  rules.newProposals(snap(Object.assign({ tasks: [{ id: 'x', title: 'Buy milk', done: false }] }, stale)), NOW).length === 1);

// A new episode: the lead was chased, went quiet again, and the clock restarted.
const chasedThenQuiet = { leads: [lead({ activity: [{ at: ago(60), text: 'old' }, { at: ago(15), text: 'Chased again.' }] })] };
const second = rules.newProposals(snap(Object.assign({ tasks: [asTask] }, chasedThenQuiet)), NOW);
check('going quiet a second time raises a NEW to-do', second.length === 1, JSON.stringify(second.map((p) => p.autoKey)));
check('and it is a different key', second[0].autoKey !== asTask.autoKey, second[0] && second[0].autoKey);

// Same facts, run an hour later: the key must not move.
const later = new Date(NOW.getTime() + 3600000);
check('the key is anchored to the event, not to the run',
  rules.newProposals(snap(stale), later)[0].autoKey === first[0].autoKey);

/* ---------------- junk data must not explode ---------------- */

const junk = {
  leads: [{}, { id: 'l9', status: 'contacted' }, { id: 'l8', activity: 'not an array', addedAt: ago(30) }],
  deals: [{ id: 'd9', stage: 'negotiation', notes: [{ at: 'not a date' }] }, null],
  clients: [{ id: 'c9', contract: null }, { id: 'c8' }],
  docs: [{ id: 'o9', kind: 'proposal', status: 'sent' }],
  sites: [{ id: 's9', status: 'crit', issues: [{ openedAt: 'nonsense' }] }],
  meetings: [{ id: 'm9', start: '' }],
  tasks: [null, { id: 't9' }],
};
let threw = null;
try { rules.newProposals(snap(junk), NOW); } catch (e) { threw = e; }
check('half-filled and malformed records do not throw', !threw, threw && threw.message);

/* ---------------- one broken rule must not sink the run ---------------- */

const saved = rules.RULES[0].run;
rules.RULES[0].run = () => { throw new Error('boom'); };
const seen = [];
const survived = rules.newProposals(snap({ deals: [deal()] }), NOW, { onError: (id, e) => seen.push(id) });
rules.RULES[0].run = saved;
check('a rule that throws is skipped, not fatal', survived.length === 1 && survived[0].ruleId === 'deal-stalled');
check('and the failure is reported', seen.length === 1 && seen[0] === 'lead-cold', JSON.stringify(seen));

/* ---------------- running a single rule ---------------- */

const both = { leads: [lead()], deals: [deal()] };
check('every rule runs by default', rules.newProposals(snap(both), NOW).length === 2);
check('but a single rule can be run on its own',
  ids(rules.newProposals(snap(both), NOW, { only: 'deal-stalled' })).join() === 'deal-stalled');

/* ---------------- nothing here writes ---------------- */

const frozen = snap({ leads: [lead()], deals: [deal()] });
const before = JSON.stringify(frozen);
rules.newProposals(frozen, NOW);
check('the snapshot is not mutated', JSON.stringify(frozen) === before);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
