'use strict';

// Claritai Desk — internal CRM.
// Static UI + JSON API + Google sign-in locked to one Workspace domain.

// Optional local .env loader (same approach as audit-api). No-op on Render.
try {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        process.env[m[1]] = v;
      }
    }
  }
} catch (_) { /* ignore */ }

const path = require('path');
const express = require('express');
const fs = require('fs');
const db = require('./lib/db');
const auth = require('./lib/auth');
const files = require('./lib/files');
const mail = require('./lib/mail');
const enquiry = require('./lib/enquiry');

const app = express();
app.set('trust proxy', 1); // Render terminates TLS in front of us
// Everything except the file upload gets JSON body parsing. The upload route
// needs the raw request stream, and a text/csv or application/json file would
// otherwise be swallowed by the parser before it reached disk.
const parseJson = express.json({ limit: '1mb' });
app.use((req, res, next) => (req.path === '/api/files' ? next() : parseJson(req, res, next)));

// This is a private staff tool. Keep it out of search results and out of frames.
app.use((req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('X-Frame-Options', 'DENY');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  next();
});

// --- public ------------------------------------------------------------
app.get('/health', (req, res) => res.json({ ok: true, service: 'claritai-desk' }));

app.get('/login', (req, res) => {
  if (auth.currentUser(req)) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/auth/google', auth.startLogin);
app.get('/auth/callback', auth.callback);
app.get('/auth/logout', auth.logout);
app.post('/auth/logout', auth.logout);

app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /\n'));

// --- website enquiries -------------------------------------------------
// The only route in this app that a stranger can reach. See lib/enquiry.js for
// the reasoning behind each guard. It answers 200 for both success and silent
// rejection: a bot should learn nothing about why it failed, and the website
// always has its own fallback, so an error here must never surface to a visitor.
function enquiryCors(req, res) {
  const origin = req.get('origin');
  if (!enquiry.originAllowed(origin)) return false;
  res.set('Access-Control-Allow-Origin', origin);
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Max-Age', '86400');
  return true;
}

app.options('/api/public/enquiry', (req, res) => {
  if (!enquiryCors(req, res)) return res.status(403).end();
  res.status(204).end();
});

app.post('/api/public/enquiry', async (req, res) => {
  if (!enquiryCors(req, res)) return res.status(403).json({ ok: false });

  const ip = enquiry.clientIp(req);
  if (enquiry.rateLimited(ip)) {
    console.warn('[enquiry] rate limited ' + ip);
    return res.json({ ok: true });
  }

  const out = enquiry.toLead(req.body, { ip });
  if (out.error) {
    console.warn('[enquiry] refused (' + out.error + ') from ' + ip);
    // 200 for the silent refusals so a bot cannot tell what tripped it;
    // a genuine mistake by our own form is worth a real status code.
    return res.status(out.error === 'missing_fields' ? 422 : 200).json({ ok: false });
  }

  try {
    await db.put('leads', out.lead.id, out.lead, 'website');
    db.logActivity('website', 'create', 'leads', out.lead.id,
      out.lead.name + ' — enquiry from the website');
    console.log('[enquiry] lead created: ' + out.lead.name + ' <' + out.lead.email + '>');
    notifyEnquiry(out).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    // The website also posts to its own form service, so the enquiry is not
    // lost — but we want to know this happened.
    console.error('[enquiry] could not save:', err);
    res.status(500).json({ ok: false });
  }
});

function notifyEnquiry(out) {
  const l = out.lead, m = out.meta;
  const lines = [
    'New enquiry from claritai.ie',
    '',
    'Name:    ' + m.name,
    'Email:   ' + m.email,
    m.phone ? 'Phone:   ' + m.phone : null,
    m.company ? 'Company: ' + m.company : null,
    '',
    m.message,
    m.pkg ? '\nPackage they built:\n' + m.pkg : null,
    '',
    l.value || l.monthlyValue
      ? 'Estimated value: €' + l.value + ' setup' +
        (l.monthlyValue ? ' + €' + l.monthlyValue + '/mo' : '')
      : null,
    '',
    'It is already in Desk under Leads: ' +
      (process.env.BASE_URL || 'https://desk.claritai.ie'),
  ].filter((x) => x !== null);

  return mail.send({
    subject: 'Enquiry: ' + m.name + (m.company ? ' — ' + m.company : ''),
    text: lines.join('\n'),
  });
}

// Public assets only. The app itself lives in views/ so it can never be served
// by the static middleware without passing through the auth gate below.
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// --- the app -----------------------------------------------------------
app.get('/', auth.requirePage, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'app.html'));
});

// --- API ---------------------------------------------------------------
app.get('/api/me', auth.requireApi, (req, res) => {
  db.recordUser(req.user.email, req.user.name);
  res.json({ email: req.user.email, name: req.user.name, picture: req.user.picture || '' });
});

// One call returns everything. The dataset is small (hundreds of records), so
// this keeps the client simple and makes "everyone sees the same thing" a matter
// of polling one endpoint rather than five.
app.get('/api/data', auth.requireApi, async (req, res, next) => {
  try {
    const out = {};
    await Promise.all(
      db.COLLECTIONS.map(async (name) => {
        out[name] = await db.list(name);
      })
    );
    out.team = await db.listTeam();
    res.json(out);
  } catch (err) {
    next(err);
  }
});

// --- documents -----------------------------------------------------------
// Upload is a raw PUT rather than a multipart form: the browser can send a File
// object straight as the body, so there's no parser dependency and nothing is
// buffered in memory on the way to disk.
app.put('/api/files', auth.requireApi, async (req, res, next) => {
  try {
    const filename = String(req.get('x-filename') || '').slice(0, 255);
    if (!filename) return res.status(400).json({ error: 'missing_filename' });
    if (!files.isAllowed(filename)) {
      return res.status(415).json({ error: 'file_type_not_accepted' });
    }
    // Refuse on the declared size first. Reading the body only to abort it
    // mid-flight resets the connection, and the browser reports that as a
    // generic network failure rather than something the person can act on.
    const declared = Number(req.get('content-length') || 0);
    if (declared > files.MAX_BYTES) {
      return res.status(413).json({ error: 'file_too_large' });
    }
    const saved = await files.receive(req, filename);
    res.json({ fileId: saved.id, name: filename, size: saved.size });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

app.get('/api/files/:id', auth.requireApi, (req, res) => {
  const p = files.pathFor(req.params.id);
  if (!p || !fs.existsSync(p)) return res.status(404).json({ error: 'not_found' });
  const name = String(req.query.name || req.params.id).replace(/[^\w .()\-]/g, '_');
  // inline so a PDF opens in the browser; the filename is still offered on save
  res.setHeader('Content-Type', files.contentType(name));
  res.setHeader('Content-Disposition', 'inline; filename="' + name + '"');
  fs.createReadStream(p).pipe(res);
});

app.delete('/api/files/:id', auth.requireApi, (req, res) => {
  files.remove(req.params.id);
  res.json({ ok: true });
});

app.put('/api/:collection/:id', auth.requireApi, async (req, res, next) => {
  try {
    const { collection, id } = req.params;
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'body_must_be_object' });
    }
    // Read before writing so the trail can say what actually changed. One extra
    // query per save, on a dataset of hundreds of records — worth it for a feed
    // that reads "Sean moved Ferndale to Proposal" instead of "Sean saved".
    const before = await db.get(collection, id);
    const saved = await db.put(collection, id, req.body, req.user.email);
    db.logActivity(
      req.user.email,
      before ? 'update' : 'create',
      collection, id,
      summarise(collection, before, req.body)
    );
    res.json(saved);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/:collection/:id', auth.requireApi, async (req, res, next) => {
  try {
    const { collection, id } = req.params;
    const existing = await db.get(collection, id);
    // A deleted document shouldn't leave its file orphaned on the disk.
    if (collection === 'docs' && existing && existing.file && existing.file.fileId) {
      files.remove(existing.file.fileId);
    }
    await db.remove(collection, id);
    db.logActivity(req.user.email, 'delete', collection, id, existing ? labelFor(collection, existing) : id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get('/api/activity', auth.requireApi, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300);
    // Join the roster so the feed can say "Kevin Laffey" rather than an address.
    // Falls back to the part before the @ for anyone not in the roster yet, and
    // leaves 'monitor' (which has no @) as itself.
    const { rows } = await db.pool.query(
      `SELECT a.at, a.actor, a.action, a.collection, a.record_id, a.summary,
              COALESCE(NULLIF(u.name, ''), split_part(a.actor, '@', 1)) AS actor_name
         FROM activity a
         LEFT JOIN users u ON u.email = a.actor
        ORDER BY a.at DESC
        LIMIT $1`,
      [limit]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

function labelFor(collection, rec) {
  if (!rec) return '';
  if (collection === 'social') {
    return [rec.channel, rec.handle].filter(Boolean).join(' ') || 'Social account';
  }
  return rec.company || rec.name || rec.title || '';
}

// Human labels for the coded fields, mirroring the maps in views/app.html.
// Only used for the activity trail, so a label that drifts makes an old line
// read oddly — it never affects the records themselves.
const LABELS = {
  stage: {
    lead: 'Lead', contacted: 'Contacted', qualified: 'Qualified', proposal: 'Proposal',
    negotiation: 'Negotiation', won: 'Won', lost: 'Lost',
  },
  leadStatus: {
    new: 'Not looked at yet', researching: 'Researching', contacted: 'Contacted',
    promoted: 'Promoted', unfit: 'Not a fit',
  },
  docStatus: {
    draft: 'Draft', sent: 'Sent', accepted: 'Accepted', signed: 'Signed',
    declined: 'Declined', superseded: 'Superseded',
  },
  siteStatus: { ok: 'All good', warn: 'Needs a look', crit: 'Broken', paused: 'Paused' },
  clientStatus: { active: 'Active', paused: 'Paused', former: 'Former', setup: 'Setting up' },
  socialStatus: { active: 'On schedule', behind: 'Behind', paused: 'Paused' },
};

function label(map, v) {
  return (LABELS[map] && LABELS[map][v]) || v || '';
}

// A one-line answer to "what did they actually do?". Falls back to the record's
// name when nothing notable moved, which is the honest answer for a typo fix.
function summarise(collection, before, after) {
  const name = labelFor(collection, after) || labelFor(collection, before);
  if (!before) return name;

  const moved = (field) => before[field] !== after[field];
  const parts = [];

  if (collection === 'deals' && moved('stage')) {
    parts.push(`moved to ${label('stage', after.stage)}`);
  }
  if (collection === 'leads') {
    if (moved('status')) parts.push(`marked ${label('leadStatus', after.status)}`);
    if (!before.demoBuilt && after.demoBuilt) parts.push('demo built');
    if (!before.demoSent && after.demoSent) parts.push('demo sent');
  }
  if (collection === 'tasks') {
    if (!before.done && after.done) parts.push('ticked off');
    else if (before.done && !after.done) parts.push('reopened');
    else if (moved('owner')) parts.push(`assigned to ${after.owner || 'nobody'}`);
    else if (moved('due')) parts.push(after.due ? `due ${after.due}` : 'due date cleared');
  }
  if (collection === 'docs' && moved('status')) {
    parts.push(`marked ${label('docStatus', after.status)}`);
  }
  if (collection === 'sites' && moved('status')) {
    parts.push(`marked ${label('siteStatus', after.status)}`);
  }
  if (collection === 'clients' && moved('status')) {
    parts.push(`marked ${label('clientStatus', after.status)}`);
  }
  if (collection === 'social' && moved('status')) {
    parts.push(`marked ${label('socialStatus', after.status)}`);
  }

  // A note added through the drawer is the most common single change and the
  // one people most want to see in the feed.
  const key = collection === 'deals' ? 'notes' : 'activity';
  const nBefore = Array.isArray(before[key]) ? before[key].length : 0;
  const nAfter = Array.isArray(after[key]) ? after[key].length : 0;
  if (nAfter > nBefore) parts.push('note added');
  else if (nAfter < nBefore) parts.push('note deleted');

  return parts.length ? `${name} — ${parts.join(', ')}` : name;
}

// --- errors ------------------------------------------------------------
app.use((req, res) => res.status(404).json({ error: 'not_found' }));

app.use((err, req, res, _next) => {
  console.error('[desk]', err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'server_error' });
});

// --- boot --------------------------------------------------------------
const port = process.env.PORT || 3000;

files.ready();

db.init()
  .then(() => {
    app.listen(port, () => console.log(`[desk] listening on ${port}`));
  })
  .catch((err) => {
    console.error('[desk] could not prepare the database:', err);
    process.exit(1);
  });
