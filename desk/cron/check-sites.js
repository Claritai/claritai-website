'use strict';

// Hourly health check for every site in the Live sites tab.
// Runs as a Render cron job, so unlike a browser it can read real HTTP status
// codes, measure response time, and read the actual TLS certificate.

const https = require('https');
const http = require('http');
const tls = require('tls');
const { URL } = require('url');

const db = require('../lib/db');
const mail = require('../lib/mail');

const TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;
const SLOW_MS = 5000;
const SSL_WARN_DAYS = 14;
const AGENT = 'ClaritaiDesk-Monitor/1.0 (+https://claritai.ie)';

function fetchOnce(target, redirectsLeft, startedAt) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(target);
    } catch (_) {
      return resolve({ error: 'That URL is not valid' });
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return resolve({ error: 'Only http and https addresses can be checked' });
    }

    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        method: 'GET',
        hostname: url.hostname,
        port: url.port || undefined,
        path: url.pathname + url.search,
        headers: { 'User-Agent': AGENT, Accept: 'text/html,*/*' },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;
        // Drain, we only need the headers.
        res.resume();

        if (status >= 300 && status < 400 && location) {
          if (redirectsLeft <= 0) return resolve({ error: 'Redirect loop' });
          let next;
          try {
            next = new URL(location, url).toString();
          } catch (_) {
            return resolve({ error: 'Broken redirect target' });
          }
          return resolve(fetchOnce(next, redirectsLeft - 1, startedAt));
        }
        resolve({ status, ms: Date.now() - startedAt, finalUrl: url.toString() });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ error: `No response within ${TIMEOUT_MS / 1000}s`, infra: true });
    });
    req.on('error', (err) =>
      resolve({ error: friendlyError(err), infra: INFRA_CODES.has(err && err.code) }));
    req.end();
  });
}

// Network-level failures that could equally mean the monitor itself has no
// route out, rather than the site being down.
const INFRA_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET']);

function friendlyError(err) {
  const code = err && err.code;
  if (code === 'ENOTFOUND') return 'Domain not found (DNS)';
  if (code === 'EAI_AGAIN') return 'DNS lookup failed';
  if (code === 'ECONNREFUSED') return 'Connection refused';
  if (code === 'ECONNRESET') return 'Connection reset';
  if (code === 'ETIMEDOUT') return 'Connection timed out';
  if (code === 'CERT_HAS_EXPIRED') return 'SSL certificate has expired';
  if (code === 'ERR_TLS_CERT_ALTNAME_INVALID') return 'SSL certificate is for a different domain';
  if (code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'SELF_SIGNED_CERT_IN_CHAIN') return 'Self-signed SSL certificate';
  if (code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') return 'SSL certificate could not be verified';
  return (err && err.message) || 'Could not connect';
}

function certExpiry(target) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(target);
    } catch (_) {
      return resolve(null);
    }
    if (url.protocol !== 'https:') return resolve(null);

    const socket = tls.connect(
      {
        host: url.hostname,
        port: Number(url.port) || 443,
        servername: url.hostname,
        timeout: TIMEOUT_MS,
        // We want the expiry date even when the chain is unhappy — the HTTP
        // check above is what judges validity.
        rejectUnauthorized: false,
      },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || !cert.valid_to) return resolve(null);
        const d = new Date(cert.valid_to);
        resolve(isNaN(d) ? null : d);
      }
    );
    socket.on('timeout', () => { socket.destroy(); resolve(null); });
    socket.on('error', () => resolve(null));
  });
}

function daysUntil(date) {
  return Math.round((date.getTime() - Date.now()) / 86400000);
}

function todayInDublin() {
  // The team is in Ireland; keep "last checked" in their local date.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

async function checkSite(site) {
  const started = Date.now();
  const result = await fetchOnce(site.url, MAX_REDIRECTS, started);
  const expiry = await certExpiry(site.url);

  let verdict = 'ok';
  let note = '';

  if (result.error) {
    verdict = 'crit';
    note = result.error;
  } else if (result.status >= 500) {
    verdict = 'crit';
    note = `Server error (HTTP ${result.status})`;
  } else if (result.status >= 400) {
    verdict = 'crit';
    note = `Page not reachable (HTTP ${result.status})`;
  } else if (expiry && daysUntil(expiry) < 0) {
    verdict = 'crit';
    note = 'SSL certificate has expired';
  } else if (expiry && daysUntil(expiry) <= SSL_WARN_DAYS) {
    verdict = 'warn';
    note = `SSL certificate expires in ${daysUntil(expiry)} days`;
  } else if (result.ms > SLOW_MS) {
    verdict = 'warn';
    note = `Slow to respond (${(result.ms / 1000).toFixed(1)}s)`;
  }

  return {
    verdict,
    note,
    infra: !!result.infra,
    httpStatus: result.status || 0,
    responseMs: result.ms || 0,
    sslExpiry: expiry ? expiry.toISOString().slice(0, 10) : site.sslExpiry || '',
  };
}

function applyVerdict(site, check, nowIso) {
  const issues = Array.isArray(site.issues) ? site.issues.map((i) => Object.assign({}, i)) : [];
  const fields = {
    autoStatus: check.verdict,
    autoCheckedAt: nowIso,
    autoNote: check.note,
    httpStatus: check.httpStatus,
    responseMs: check.responseMs,
    lastChecked: todayInDublin(),
  };
  // Only overwrite the certificate date when we actually read one.
  if (check.sslExpiry) fields.sslExpiry = check.sslExpiry;

  const openAuto = issues.find((i) => i.auto && !i.resolved);

  if (check.verdict === 'crit' || check.verdict === 'warn') {
    fields.status = check.verdict === 'crit' ? 'crit' : site.status === 'ok' ? 'warn' : site.status;
    if (openAuto) {
      openAuto.text = check.note;
      openAuto.severity = check.verdict;
    } else {
      issues.unshift({
        text: check.note,
        severity: check.verdict,
        openedAt: nowIso,
        by: 'Monitor',
        auto: true,
        resolved: false,
      });
    }
    fields.issues = issues;
  } else {
    // Recovered. Close what the monitor opened, and leave anything a person
    // logged for a person to close.
    let changed = false;
    for (const issue of issues) {
      if (issue.auto && !issue.resolved) {
        issue.resolved = true;
        issue.resolvedAt = nowIso;
        changed = true;
      }
    }
    if (changed) fields.issues = issues;
    const humanStillOpen = issues.some((i) => !i.auto && !i.resolved);
    if (!humanStillOpen) fields.status = 'ok';
  }
  return fields;
}

async function main() {
  // `node cron/check-sites.js --test-alert` sends one sample email and stops.
  // Real alerts only fire on a change of state, so without this there's no way
  // to prove the mail setup works short of waiting for a client site to break.
  if (process.argv.includes('--test-alert')) {
    if (!mail.isConfigured()) {
      console.error('[monitor] RESEND_API_KEY is not set on this service — nothing would be sent.');
      process.exitCode = 1;
      return;
    }
    await db.init();
    const to = await mail.recipients();
    console.log('[monitor] test alert going to: ' + (to.join(', ') || '(nobody — check ALERT_EMAILS)'));
    const res = await mail.sendSiteAlert([{
      name: 'Test — this is not a real outage',
      url: 'https://desk.claritai.ie',
      from: 'ok', to: 'crit',
      note: 'Sample alert, sent by hand to check the mail setup. Nothing is wrong.',
      httpStatus: 500, responseMs: 0,
    }]);
    console.log(res.sent ? '[monitor] test alert sent.' : '[monitor] test alert FAILED: ' + res.reason);
    await db.pool.end();
    process.exitCode = res.sent ? 0 : 1;
    return;
  }

  await db.init();
  const sites = await db.list('sites');
  const due = sites.filter((s) => s.url && s.monitor !== false && s.status !== 'paused');

  if (!due.length) {
    console.log('[monitor] no sites to check');
    await db.pool.end();
    return;
  }

  const nowIso = new Date().toISOString();
  const changes = [];

  // Check everything first, then decide whether to trust the results.
  const results = [];
  for (const site of due) {
    let check;
    try {
      check = await checkSite(site);
    } catch (err) {
      check = { verdict: 'crit', note: 'Check failed: ' + err.message, infra: true, httpStatus: 0, responseMs: 0, sslExpiry: '' };
    }
    results.push({ site, check });
  }

  // If every site failed at the network level, the far more likely explanation
  // is that this job has no route out — not that the whole estate went down at
  // the same second. Report it and write nothing, rather than raising a false
  // alarm on every client at once.
  if (due.length > 1 && results.every((r) => r.check.infra)) {
    console.error(
      `[monitor] ABORTED: all ${due.length} checks failed at the network level ` +
      `(${results[0].check.note}). Treating this as a problem with the monitor, not the sites. ` +
      `Nothing was written.`
    );
    await db.logActivity('monitor', 'aborted', 'sites', null,
      `All ${due.length} checks failed at the network level — no results recorded`);
    await mail.sendMonitorBroken(
      `All ${due.length} checks failed at the network level (${results[0].check.note}), ` +
      `which almost always means the monitor has no route out rather than every client ` +
      `site failing at once.`
    );
    await db.pool.end();
    process.exitCode = 1;
    return;
  }

  for (const { site, check } of results) {
    const fields = applyVerdict(site, check, nowIso);
    await db.patch('sites', site.id, fields, 'monitor');

    const before = site.autoStatus || '';
    const line = `${site.name}: ${check.verdict}${check.note ? ' — ' + check.note : ''} (HTTP ${check.httpStatus}, ${check.responseMs}ms)`;
    console.log('[monitor] ' + line);
    // Only a change of state is news. A site that has been down for six hours
    // must not generate six emails, or the seventh gets ignored.
    if (before !== check.verdict) {
      changes.push({
        name: site.name || site.url,
        url: site.url,
        from: before,
        to: check.verdict,
        note: check.note,
        httpStatus: check.httpStatus,
        responseMs: check.responseMs,
      });
      await db.logActivity('monitor', 'check', 'sites', site.id, line);
    }
  }

  console.log(
    changes.length
      ? `[monitor] checked ${due.length} site(s); ${changes.length} changed state:\n  ` +
        changes.map(describe).join('\n  ')
      : `[monitor] checked ${due.length} site(s); nothing changed`
  );

  // A first run has no previous state to compare against, so everything looks
  // like a change. Mailing the whole estate as "news" the first time the
  // monitor sees it would be noise, not an alert.
  const worthSending = changes.filter((c) => c.from !== '');
  if (worthSending.length) await mail.sendSiteAlert(worthSending);
  else if (changes.length) console.log('[monitor] first run for these sites — recorded, not emailed');

  await db.pool.end();
}

function describe(c) {
  return `${c.name}: ${c.from || 'unknown'} → ${c.to}${c.note ? ' — ' + c.note : ''}`;
}

main().catch((err) => {
  console.error('[monitor] run failed:', err);
  process.exit(1);
});
