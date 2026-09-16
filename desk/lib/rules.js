'use strict';

/**
 * Rules that watch the data and propose to-dos.
 *
 * Nothing in here writes, sends, or changes a record. It takes a snapshot of the
 * collections and returns a list of PROPOSED to-dos. That is deliberate: the worst
 * a wrong rule can do is put a task on the list that you dismiss. Anything that
 * leaves the building — email, a sequence step — has to be a separate, later
 * decision made by something that can be switched off on its own.
 *
 * Every proposal carries an `autoKey`, and the key is anchored to the date the
 * clock STARTED, not to today. That single choice is what makes this safe to run
 * hourly:
 *
 *   - the same quiet deal does not produce a fresh to-do every hour;
 *   - once you have dealt with it, it does not come back to nag you, because the
 *     completed to-do still holds the key;
 *   - but if that deal goes quiet AGAIN in three months, the clock starts from a
 *     new date, so the key is new and you are reminded again.
 *
 * The shape of a proposal matches the `tasks` record the app already uses, plus
 * `autoKey`, `ruleId` and `why`. `why` ends up in the to-do's notes, so opening it
 * tells you what Desk noticed rather than leaving you to guess.
 */

const DAY = 86400000;

// Tunable in one place. Passed through so tests can compress the calendar and so
// these can become settings later without touching any rule.
const DEFAULTS = {
  leadNew: 7,          // a lead you have not researched or contacted
  leadContacted: 10,   // you reached out and heard nothing
  dealStalled: 14,     // an open deal with no movement
  docDecision: 7,      // a proposal or quote sent and not answered
  renewalNotice: 30,   // start the renewal conversation this far out
  siteDown: 2,         // a site has been critical this long and nobody has acted
  meetingWriteUp: 1,   // a meeting finished and has no outcome logged
};

/* ---------------- small date helpers ---------------- */

function toDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function dayKey(v) {
  const d = toDate(v);
  return d ? d.toISOString().slice(0, 10) : '';
}

function daysBetween(from, to) {
  const a = toDate(from), b = toDate(to);
  if (!a || !b) return null;
  return Math.floor((b.getTime() - a.getTime()) / DAY);
}

function plusDays(v, n) {
  const d = toDate(v);
  return d ? new Date(d.getTime() + n * DAY) : null;
}

/**
 * When was this record last genuinely touched?
 *
 * Note it does NOT fall back to `_updatedAt` for staleness rules. The site
 * monitor and the rule runner itself both write to records, so `_updatedAt`
 * moves on its own — trusting it would mean a deal looks "active" because a
 * robot looked at it. Only human-made marks count here.
 */
function lastTouch(rec, noteKeys) {
  let best = null;
  for (const key of noteKeys || []) {
    const list = rec && rec[key];
    if (!Array.isArray(list)) continue;
    for (const n of list) {
      const d = toDate(n && n.at);
      if (d && (!best || d > best)) best = d;
    }
  }
  for (const key of ['addedAt', 'createdAt', 'promotedAt']) {
    const d = toDate(rec && rec[key]);
    if (d && (!best || d > best)) best = d;
  }
  return best;
}

function ownerOf(rec, fallback) {
  return (rec && (rec.owner || rec.addedBy)) || fallback || '';
}

function label(rec) {
  return String((rec && (rec.name || rec.company || rec.title)) || 'Untitled').trim() || 'Untitled';
}

function plural(n, word) {
  return n + ' ' + word + (n === 1 ? '' : 's');
}

/* ---------------- the rules ---------------- */

const OPEN_STAGES = ['lead', 'contacted', 'discovery', 'proposal', 'negotiation'];
const LIVE_LEAD = ['new', 'researching', 'contacted'];
const DECIDABLE = ['proposal', 'quote'];

/**
 * Each rule returns zero or more proposals. `ctx` carries { now, cfg, owner, data }.
 * Rules must be pure and must not throw on half-filled records — real data always
 * has a record somebody abandoned halfway through typing.
 */
const RULES = [
  {
    id: 'lead-cold',
    label: 'Leads going cold',
    run(ctx) {
      const out = [];
      for (const l of ctx.data.leads || []) {
        const status = l.status || 'new';
        if (!LIVE_LEAD.includes(status)) continue;
        const limit = status === 'contacted' ? ctx.cfg.leadContacted : ctx.cfg.leadNew;
        const touched = lastTouch(l, ['activity']);
        if (!touched) continue;
        const age = daysBetween(touched, ctx.now);
        if (age === null || age < limit) continue;
        out.push({
          ruleId: 'lead-cold',
          anchor: dayKey(touched),
          recordId: l.id,
          title: (status === 'contacted' ? 'Chase ' : 'Make contact with ') + label(l),
          owner: ownerOf(l, ctx.owner),
          due: dayKey(ctx.now),
          clientId: '',
          dealId: l.dealId || '',
          why: 'No activity on this lead for ' + plural(age, 'day') +
               ' (last touched ' + dayKey(touched) + '). Either follow up or mark it as not a fit.',
        });
      }
      return out;
    },
  },

  {
    id: 'deal-stalled',
    label: 'Deals that have stopped moving',
    run(ctx) {
      const out = [];
      for (const d of ctx.data.deals || []) {
        if (!OPEN_STAGES.includes(d.stage || 'lead')) continue;
        const touched = lastTouch(d, ['notes']);
        if (!touched) continue;
        const age = daysBetween(touched, ctx.now);
        if (age === null || age < ctx.cfg.dealStalled) continue;
        out.push({
          ruleId: 'deal-stalled',
          anchor: dayKey(touched),
          recordId: d.id,
          title: label(d) + ' has gone quiet — what is the next step?',
          owner: ownerOf(d, ctx.owner),
          due: dayKey(ctx.now),
          clientId: d.clientId || '',
          dealId: d.id,
          why: 'No movement on this deal for ' + plural(age, 'day') + '. It is still sitting in ' +
               (d.stage || 'lead') + '.',
        });
      }
      return out;
    },
  },

  {
    // The one rule that uses something you already type. You fill in "next step"
    // and a date on a deal and then nothing on earth reminds you about it.
    id: 'next-step-due',
    label: 'Next steps that have come due',
    run(ctx) {
      const out = [];
      for (const d of ctx.data.deals || []) {
        if (!OPEN_STAGES.includes(d.stage || 'lead')) continue;
        const when = toDate(d.nextStepDate);
        if (!when) continue;
        const over = daysBetween(when, ctx.now);
        if (over === null || over < 0) continue;
        const step = String(d.nextStep || '').trim();
        out.push({
          ruleId: 'next-step-due',
          anchor: dayKey(when),
          recordId: d.id,
          title: (step || 'Next step') + ' — ' + label(d),
          owner: ownerOf(d, ctx.owner),
          due: dayKey(when),
          clientId: d.clientId || '',
          dealId: d.id,
          why: 'You set this as the next step on ' + label(d) + ' for ' + dayKey(when) +
               (over > 0 ? ', ' + plural(over, 'day') + ' ago.' : '.'),
        });
      }
      return out;
    },
  },

  {
    id: 'doc-awaiting-answer',
    label: 'Proposals and quotes with no answer',
    run(ctx) {
      const out = [];
      for (const doc of ctx.data.docs || []) {
        if (!DECIDABLE.includes(doc.kind)) continue;
        if (doc.status !== 'sent') continue;
        // Documents have no explicit sent-date field, so the last write is the
        // best anchor available: moving the status to "sent" is what bumps it.
        const sent = toDate(doc.sentAt) || toDate(doc._updatedAt);
        if (!sent) continue;
        const age = daysBetween(sent, ctx.now);
        if (age === null || age < ctx.cfg.docDecision) continue;
        const deal = (ctx.data.deals || []).find((d) => d.id === doc.dealId);
        const client = (ctx.data.clients || []).find((c) => c.id === doc.clientId);
        const who = deal ? label(deal) : client ? label(client) : '';
        out.push({
          ruleId: 'doc-awaiting-answer',
          anchor: dayKey(sent),
          recordId: doc.id,
          title: 'Follow up on ' + label(doc) + (who ? ' — ' + who : ''),
          owner: ownerOf(doc, ctx.owner),
          due: dayKey(ctx.now),
          clientId: doc.clientId || '',
          dealId: doc.dealId || '',
          why: 'This ' + (doc.kind || 'document') + ' has been marked sent for ' +
               plural(age, 'day') + ' with no answer recorded.',
        });
      }
      return out;
    },
  },

  {
    id: 'renewal-due',
    label: 'Renewals coming up',
    run(ctx) {
      const out = [];
      for (const c of ctx.data.clients || []) {
        if (c.status === 'former') continue;
        const renew = toDate(c.contract && c.contract.renewalDate);
        if (!renew) continue;
        const away = daysBetween(ctx.now, renew);
        // Past renewals are somebody else's problem to tidy up, not a reminder.
        if (away === null || away > ctx.cfg.renewalNotice || away < 0) continue;
        const notice = String((c.contract && c.contract.noticePeriod) || '').trim();
        out.push({
          ruleId: 'renewal-due',
          anchor: dayKey(renew),
          recordId: c.id,
          title: label(c) + ' renews on ' + dayKey(renew) + ' — start the conversation',
          owner: ownerOf(c, ctx.owner),
          due: dayKey(plusDays(renew, -ctx.cfg.renewalNotice)),
          clientId: c.id,
          dealId: '',
          why: 'Contract renews in ' + plural(away, 'day') + '.' +
               (notice ? ' Notice period on file: ' + notice + '.' : ''),
        });
      }
      return out;
    },
  },

  {
    id: 'site-down',
    label: 'Sites down with nobody on it',
    run(ctx) {
      const out = [];
      for (const s of ctx.data.sites || []) {
        if (s.status !== 'crit') continue;
        const issues = Array.isArray(s.issues) ? s.issues : [];
        const open = issues.filter((i) => i && !i.resolved && toDate(i.openedAt))
          .sort((a, b) => toDate(a.openedAt) - toDate(b.openedAt))[0];
        if (!open) continue;
        const age = daysBetween(open.openedAt, ctx.now);
        if (age === null || age < ctx.cfg.siteDown) continue;
        out.push({
          ruleId: 'site-down',
          anchor: dayKey(open.openedAt),
          recordId: s.id,
          title: label(s) + ' has been down for ' + plural(age, 'day'),
          owner: ownerOf(s, ctx.owner),
          due: dayKey(ctx.now),
          clientId: s.clientId || '',
          dealId: '',
          why: (open.text || 'The monitor flagged this site as critical.') +
               ' Open since ' + dayKey(open.openedAt) + '. The alert email has already gone out — ' +
               'this is the reminder that nobody has cleared it.',
        });
      }
      return out;
    },
  },

  {
    id: 'meeting-write-up',
    label: 'Meetings with no outcome logged',
    run(ctx) {
      const out = [];
      for (const m of ctx.data.meetings || []) {
        const start = toDate(m.start);
        if (!start) continue;
        const since = daysBetween(start, ctx.now);
        if (since === null || since < ctx.cfg.meetingWriteUp) continue;
        // Anything written after the meeting counts as the write-up.
        const notes = Array.isArray(m.notes) ? m.notes : [];
        const after = notes.some((n) => { const d = toDate(n && n.at); return d && d >= start; });
        if (after || String(m.outcome || '').trim()) continue;
        // Only chase the recent past; importing an old calendar should not
        // generate a year of homework.
        if (since > 30) continue;
        out.push({
          ruleId: 'meeting-write-up',
          anchor: dayKey(start),
          recordId: m.id,
          title: 'Write up ' + label(m),
          owner: ownerOf({ owner: m.attendees }, ctx.owner),
          due: dayKey(ctx.now),
          clientId: m.clientId || '',
          dealId: m.dealId || '',
          why: 'This meeting was on ' + dayKey(start) + ' and has no outcome recorded. ' +
               'Five minutes now beats reconstructing it in a month.',
        });
      }
      return out;
    },
  },
];

/* ---------------- running them ---------------- */

function keyFor(p) {
  return p.ruleId + ':' + p.recordId + ':' + p.anchor;
}

/**
 * Every proposal the rules can see right now, whether or not it already exists.
 * Exported mainly so the UI can explain itself and so tests can be specific.
 */
function proposals(data, now, opts) {
  opts = opts || {};
  const ctx = {
    now: toDate(now) || new Date(),
    cfg: Object.assign({}, DEFAULTS, opts.thresholds || {}),
    owner: opts.defaultOwner || '',
    data: data || {},
  };
  const only = opts.only ? [].concat(opts.only) : null;
  const out = [];
  for (const rule of RULES) {
    if (only && !only.includes(rule.id)) continue;
    let got;
    try {
      got = rule.run(ctx) || [];
    } catch (err) {
      // One broken rule must not take the whole run down with it. A missed
      // reminder is a nuisance; a cron that dies silently is a trap.
      got = [];
      if (opts.onError) opts.onError(rule.id, err);
    }
    for (const p of got) out.push(Object.assign({ autoKey: keyFor(p) }, p));
  }
  return out;
}

/**
 * The proposals that are genuinely new — that is, no to-do already carries the
 * same key. Completed to-dos count: having done the thing is exactly the reason
 * not to be asked again.
 */
function newProposals(data, now, opts) {
  const existing = new Set(
    ((data && data.tasks) || []).map((t) => t && t.autoKey).filter(Boolean)
  );
  return proposals(data, now, opts).filter((p) => !existing.has(p.autoKey));
}

/** Turn a proposal into the `tasks` record the app already understands. */
function toTask(p, now, makeId) {
  const at = (toDate(now) || new Date()).toISOString();
  return {
    id: makeId ? makeId() : 'r' + require('crypto').randomBytes(8).toString('hex'),
    title: String(p.title || 'Follow up').slice(0, 200),
    owner: p.owner || '',
    due: p.due || '',
    done: false,
    dealId: p.dealId || '',
    clientId: p.clientId || '',
    notes: p.why || '',
    createdAt: at,
    sample: false,
    // The three fields that make it an automatic to-do rather than a typed one.
    autoKey: p.autoKey,
    autoRule: p.ruleId,
    autoAt: at,
  };
}

module.exports = {
  proposals, newProposals, toTask,
  RULES, DEFAULTS, OPEN_STAGES, LIVE_LEAD, DECIDABLE,
  _internals: { lastTouch, daysBetween, dayKey, plusDays, keyFor },
};
