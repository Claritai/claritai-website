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
    const saved = await db.put(collection, id, req.body, req.user.email);
    db.logActivity(req.user.email, 'save', collection, id, labelFor(collection, req.body));
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
    const { rows } = await db.pool.query(
      'SELECT at, actor, action, collection, record_id, summary FROM activity ORDER BY at DESC LIMIT 100'
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

function labelFor(collection, rec) {
  return rec.company || rec.name || rec.title || (rec.client ? rec.client + ' · ' + (rec.channel || '') : '') || '';
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
