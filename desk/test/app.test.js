// Temporary smoke test: boots the app against a stubbed database and checks
// routing, the auth gate, and session-cookie integrity. Deleted after running.
const crypto = require('crypto');

const dbPath = require.resolve('../lib/db');
const fake = {
  pool: { query: async () => ({ rows: [] }), end: async () => {} },
  COLLECTIONS: ['deals', 'tasks', 'meetings', 'sites', 'social'],
  init: async () => {},
  list: async () => [],
  get: async () => null,
  put: async (c, id, d) => Object.assign({ id }, d),
  patch: async () => null,
  remove: async () => {},
  logActivity: async () => {},
  recordUser: async () => {},
  listTeam: async () => ['Sean Laffey'],
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fake };

process.env.SESSION_SECRET = 'smoke-test-secret';
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.ALLOWED_DOMAIN = 'claritai.ie';
process.env.NODE_ENV = 'development';
process.env.PORT = '3999';
delete process.env.BASE_URL;

require('../index.js');

const B = 'http://127.0.0.1:3999';
const b64 = (x) => Buffer.from(x).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function makeSession(payload, secret) {
  const body = b64(JSON.stringify(payload));
  const mac = b64(crypto.createHmac('sha256', secret).update(body).digest());
  return body + '.' + mac;
}
const good = makeSession(
  { email: 'sean@claritai.ie', name: 'Sean Laffey', exp: Date.now() + 3600e3 },
  'smoke-test-secret');
const forged = makeSession(
  { email: 'attacker@gmail.com', name: 'Nope', exp: Date.now() + 3600e3 },
  'wrong-secret');
const expired = makeSession(
  { email: 'sean@claritai.ie', name: 'Sean', exp: Date.now() - 1000 },
  'smoke-test-secret');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')); }
}
const cookie = (v) => ({ headers: { cookie: 'desk_session=' + encodeURIComponent(v) }, redirect: 'manual' });

setTimeout(async () => {
  try {
    let r, t;

    r = await fetch(B + '/health');
    t = await r.json();
    check('health returns ok', r.status === 200 && t.ok === true, 'status ' + r.status);

    r = await fetch(B + '/login');
    t = await r.text();
    check('login page renders', r.status === 200 && t.includes('Continue with Google'), 'status ' + r.status);
    check('login page is noindex', (r.headers.get('x-robots-tag') || '').includes('noindex'));

    r = await fetch(B + '/', { redirect: 'manual' });
    check('app redirects anonymous users to login',
      r.status === 302 && (r.headers.get('location') || '').startsWith('/login'),
      r.status + ' → ' + r.headers.get('location'));

    r = await fetch(B + '/api/data', { redirect: 'manual' });
    t = await r.json();
    check('API refuses anonymous callers with 401', r.status === 401 && t.error === 'not_signed_in', 'status ' + r.status);

    r = await fetch(B + '/auth/google', { redirect: 'manual' });
    const loc = r.headers.get('location') || '';
    check('sign-in redirects to Google', r.status === 302 && loc.startsWith('https://accounts.google.com/'));
    check('sign-in is pinned to the claritai.ie domain', loc.includes('hd=claritai.ie'), loc.slice(0, 120));
    check('sign-in sets a state cookie', (r.headers.get('set-cookie') || '').includes('desk_state'));

    r = await fetch(B + '/api/me', cookie(good));
    t = await r.json();
    check('valid session reaches the API', r.status === 200 && t.email === 'sean@claritai.ie', 'status ' + r.status);

    r = await fetch(B + '/api/data', cookie(good));
    t = await r.json();
    check('valid session loads data + team', r.status === 200 && Array.isArray(t.deals) && t.team[0] === 'Sean Laffey');

    r = await fetch(B + '/', cookie(good));
    t = await r.text();
    check('valid session gets the app', r.status === 200 && t.includes('Claritai Desk') && t.includes('class="app"'));

    r = await fetch(B + '/api/data', cookie(forged));
    check('FORGED cookie is rejected', r.status === 401, 'status ' + r.status + ' (must be 401)');

    r = await fetch(B + '/api/data', cookie(expired));
    check('EXPIRED session is rejected', r.status === 401, 'status ' + r.status + ' (must be 401)');

    r = await fetch(B + '/robots.txt');
    t = await r.text();
    check('robots.txt disallows everything', t.includes('Disallow: /'));

    r = await fetch(B + '/views/app.html', { redirect: 'manual' });
    check('app.html is NOT reachable as a static file', r.status === 404, 'status ' + r.status);

    console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  } catch (err) {
    console.error('smoke test blew up:', err);
    process.exit(1);
  }
}, 900);
