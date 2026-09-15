'use strict';

// Outbound email for Desk alerts, via Resend's HTTPS API.
//
// Deliberately dependency-free: Node 18's global fetch is enough, so the cron
// job doesn't grow an npm tree just to send a handful of messages a month.
//
// Nothing here throws. A monitor run that can't send mail must still record
// what it found — losing the alert is bad, losing the check is worse.

const db = require('./db');

const API = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10000;

function apiKey() {
  return (process.env.RESEND_API_KEY || '').trim();
}

// Who the alerts come from. Must be a domain verified in Resend, or Resend
// rejects the send.
function from() {
  return (process.env.ALERT_FROM || 'Claritai Desk <desk@claritai.ie>').trim();
}

function baseUrl() {
  return (process.env.BASE_URL || 'https://desk.claritai.ie').replace(/\/+$/, '');
}

function isConfigured() {
  return !!apiKey();
}

// Explicit list wins; otherwise everyone who has ever signed in to Desk, which
// keeps the list right without anyone maintaining it.
async function recipients() {
  const configured = String(process.env.ALERT_EMAILS || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@'));
  if (configured.length) return configured;

  try {
    const { rows } = await db.pool.query('SELECT email FROM users ORDER BY email');
    return rows.map((r) => r.email).filter((e) => e && e.includes('@'));
  } catch (_) {
    return [];
  }
}

async function send({ to, subject, text, html }) {
  if (!isConfigured()) {
    console.log('[mail] RESEND_API_KEY is not set — skipping: ' + subject);
    return { sent: false, reason: 'not_configured' };
  }
  const list = (to && to.length ? to : await recipients());
  if (!list.length) {
    console.log('[mail] nobody to send to — skipping: ' + subject);
    return { sent: false, reason: 'no_recipients' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: from(),
        to: list,
        subject,
        text,
        html: html || undefined,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = 'HTTP ' + res.status;
      try {
        const j = await res.json();
        if (j && j.message) detail = j.message;
      } catch (_) { /* body wasn't JSON */ }
      console.error('[mail] send failed (' + detail + '): ' + subject);
      return { sent: false, reason: detail };
    }
    console.log('[mail] sent "' + subject + '" to ' + list.join(', '));
    return { sent: true, to: list };
  } catch (err) {
    console.error('[mail] send failed (' + (err.name === 'AbortError' ? 'timed out' : err.message) + '): ' + subject);
    return { sent: false, reason: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- the site alert ---------- */

const SEV = {
  crit: { word: 'DOWN', lead: 'is down' },
  warn: { word: 'WARNING', lead: 'needs a look' },
  ok:   { word: 'recovered', lead: 'is back up' },
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// One email per run covering everything that changed, rather than one per site —
// three sites failing together is one incident, not three.
function subjectFor(changes) {
  const down = changes.filter((c) => c.to === 'crit');
  const back = changes.filter((c) => c.to === 'ok');
  const warn = changes.filter((c) => c.to === 'warn');

  // Naming the site beats counting it, so a lone outage is named even when
  // something else recovered in the same run.
  if (down.length === 1) return `DOWN: ${down[0].name}`;
  if (down.length) return `DOWN: ${down.length} sites need attention`;
  if (warn.length === 1) return `Warning: ${warn[0].name}`;
  if (warn.length) return `Warning: ${warn.length} sites need a look`;
  if (back.length === 1) return `Recovered: ${back[0].name}`;
  return `Recovered: ${back.length} sites are back up`;
}

function bodyFor(changes) {
  const order = { crit: 0, warn: 1, ok: 2 };
  const sorted = changes.slice().sort((a, b) => (order[a.to] ?? 3) - (order[b.to] ?? 3));

  const lines = sorted.map((c) => {
    const s = SEV[c.to] || { word: c.to.toUpperCase(), lead: 'changed' };
    return `${s.word} — ${c.name} ${s.lead}` +
      (c.note ? `\n  ${c.note}` : '') +
      `\n  ${c.url}` +
      (c.httpStatus ? `\n  HTTP ${c.httpStatus}${c.responseMs ? `, ${c.responseMs}ms` : ''}` : '');
  });

  const text = lines.join('\n\n') +
    `\n\n—\nChecked at ${stamp()}.\nOpen Desk: ${baseUrl()}\n` +
    `You're getting this because you have a Claritai Desk account.`;

  const rows = sorted.map((c) => {
    const s = SEV[c.to] || { word: c.to.toUpperCase(), lead: 'changed' };
    const colour = c.to === 'crit' ? '#c0392b' : c.to === 'warn' ? '#b7791f' : '#2f855a';
    return `<tr><td style="padding:12px 0;border-bottom:1px solid #e6e8eb">
      <div style="font:600 13px system-ui,sans-serif;color:${colour};letter-spacing:.06em">${esc(s.word)}</div>
      <div style="font:600 16px system-ui,sans-serif;color:#15181c;margin-top:3px">${esc(c.name)}</div>
      ${c.note ? `<div style="font:14px system-ui,sans-serif;color:#4a5158;margin-top:3px">${esc(c.note)}</div>` : ''}
      <div style="font:13px ui-monospace,monospace;color:#6b7280;margin-top:5px">${esc(c.url)}${
        c.httpStatus ? ` · HTTP ${esc(c.httpStatus)}${c.responseMs ? ` · ${esc(c.responseMs)}ms` : ''}` : ''}</div>
    </td></tr>`;
  }).join('');

  const html = `<div style="background:#f5f7fa;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e6e8eb;border-radius:12px;padding:22px 24px">
      <div style="font:700 15px system-ui,sans-serif;color:#3d8ed1">claritai <span style="color:#6b7280;font-weight:600;letter-spacing:.1em;font-size:11px">DESK</span></div>
      <table style="width:100%;border-collapse:collapse;margin-top:14px">${rows}</table>
      <a href="${esc(baseUrl())}" style="display:inline-block;margin-top:18px;background:#3d8ed1;color:#fff;font:600 14px system-ui,sans-serif;text-decoration:none;padding:9px 16px;border-radius:8px">Open Desk</a>
      <div style="font:12px system-ui,sans-serif;color:#9aa1a9;margin-top:16px">Checked at ${esc(stamp())}. You're getting this because you have a Claritai Desk account.</div>
    </div>
  </div>`;

  return { text, html };
}

function stamp() {
  return new Intl.DateTimeFormat('en-IE', {
    timeZone: 'Europe/Dublin',
    weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit',
  }).format(new Date());
}

async function sendSiteAlert(changes) {
  if (!changes || !changes.length) return { sent: false, reason: 'nothing_changed' };
  const { text, html } = bodyFor(changes);
  return send({ subject: subjectFor(changes), text, html });
}

// The monitor aborting means we are flying blind: no site results at all. That
// is worth knowing about even though no individual site has been judged.
async function sendMonitorBroken(detail) {
  return send({
    subject: 'Desk site monitoring is not running',
    text: `The hourly site check aborted without recording anything.\n\n${detail}\n\n` +
      `No site statuses were written, so Desk is showing whatever it last knew.\n` +
      `Until this clears, nobody is watching the client sites.\n\n${baseUrl()}`,
  });
}

module.exports = {
  send, sendSiteAlert, sendMonitorBroken, recipients, isConfigured,
  // exported for the tests
  subjectFor, bodyFor,
};
