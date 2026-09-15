// The public endpoint is the only unauthenticated way into Desk, so most of
// these tests are about what it REFUSES. No network, no real database.

const http = require('http');
const assert = require('assert');

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')); }
};

process.env.ENQUIRY_ORIGINS = 'https://claritai.ie,https://www.claritai.ie';
process.env.ALLOWED_DOMAIN = 'claritai.ie';
process.env.SESSION_SECRET = 'test-secret';
process.env.FILES_DIR = require('os').tmpdir() + '/desk-enquiry-test';
delete process.env.RESEND_API_KEY;           // mail must no-op, not throw

// --- stub the database so nothing real is written ------------------------
const dbPath = require.resolve('../lib/db');
const saved = [];
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  pool: { query: async () => ({ rows: [] }), end: async () => {} },
  COLLECTIONS: ['leads', 'clients', 'deals', 'docs', 'tasks', 'meetings', 'sites', 'social'],
  init: async () => {},
  list: async () => [],
  get: async () => null,
  put: async (c, id, data) => { saved.push({ c, id, data }); return data; },
  patch: async () => null,
  remove: async () => {},
  logActivity: async () => {},
  recordUser: async () => {},
  listTeam: async () => [],
}};

const enquiry = require('../lib/enquiry');

// ---------- pure rule tests ----------
const OK = () => ({
  name: 'Paul Reilly', email: 'paul@navantyres.ie', phone: '087 123 4567',
  company: 'Navan Tyres', message: 'Looking for a new website.',
  elapsed: 9000, website_url: '',
});

let r = enquiry.toLead(OK(), {});
check('a good enquiry becomes a lead', !r.error && r.lead && r.lead.email === 'paul@navantyres.ie', JSON.stringify(r.error));
check('company becomes the lead name', r.lead.name === 'Navan Tyres' && r.lead.contact === 'Paul Reilly');
check('it is marked as coming from the website', r.lead.source === 'Website enquiry' && r.lead.addedBy === 'Website');
check('it lands as a new lead', r.lead.status === 'new');
check('the message becomes the first history note', r.lead.activity[0].text === 'Looking for a new website.');

let noCo = OK(); delete noCo.company;
check('without a company the person is the lead name', enquiry.toLead(noCo, {}).lead.name === 'Paul Reilly');

// honeypot
let bot = OK(); bot.website_url = 'http://spam.example';
check('honeypot rejects', enquiry.toLead(bot, {}).error === 'rejected');

// timing gate
let fast = OK(); fast.elapsed = 300;
check('too-fast submission rejects', enquiry.toLead(fast, {}).error === 'rejected');
let noTime = OK(); delete noTime.elapsed;
check('missing timing is treated as suspicious', enquiry.toLead(noTime, {}).error === 'rejected');

// required fields
let noEmail = OK(); noEmail.email = 'not-an-email';
check('bad email rejects', enquiry.toLead(noEmail, {}).error === 'missing_fields');
let noName = OK(); noName.name = '   ';
check('blank name rejects', enquiry.toLead(noName, {}).error === 'missing_fields');
let noMsg = OK(); noMsg.message = '';
check('blank message rejects', enquiry.toLead(noMsg, {}).error === 'missing_fields');

check('a non-object body rejects', enquiry.toLead('hello', {}).error === 'bad_body');
check('an array body rejects', enquiry.toLead([1, 2], {}).error === 'bad_body');

// sanitising
let nasty = OK();
nasty.name = '<script>alert(1)</script>Paul';
nasty.message = 'Hi <img src=x onerror=alert(1)> there';
r = enquiry.toLead(nasty, {});
check('angle brackets are stripped',
  !r.lead.contact.includes('<') && !r.lead.activity[0].text.includes('<'), r.lead.contact);

let huge = OK(); huge.message = 'x'.repeat(50000); huge.name = 'y'.repeat(5000);
r = enquiry.toLead(huge, {});
check('oversized fields are capped',
  r.lead.activity[0].text.length <= enquiry.LIMITS.message && r.lead.contact.length <= enquiry.LIMITS.name,
  r.lead.activity[0].text.length + '/' + r.lead.contact.length);

// money
let pkg = OK();
pkg.setupTotal = 648; pkg.monthlyTotal = 88;
pkg.packageText = 'Starter + bookings';
r = enquiry.toLead(pkg, {});
check('package totals populate the lead value', r.lead.value === 648 && r.lead.monthlyValue === 88);
check('the package is kept as its own note', r.lead.activity.length === 2 && /bookings/.test(r.lead.activity[1].text));

let junkMoney = OK(); junkMoney.setupTotal = 'lots'; junkMoney.monthlyTotal = -5;
r = enquiry.toLead(junkMoney, {});
check('nonsense values become zero, not NaN', r.lead.value === 0 && r.lead.monthlyValue === 0);
let silly = OK(); silly.setupTotal = 99999999999;
check('absurd values are refused', enquiry.toLead(silly, {}).lead.value === 0);

// origins
check('our domain is allowed', enquiry.originAllowed('https://claritai.ie'));
check('www is allowed', enquiry.originAllowed('https://www.claritai.ie'));
check('a lookalike domain is not', !enquiry.originAllowed('https://claritai.ie.evil.com'));
check('http is not', !enquiry.originAllowed('http://claritai.ie'));
check('no origin at all is not', !enquiry.originAllowed(''));

// rate limit
enquiry._hits.clear();
let blocked = 0;
for (let i = 0; i < enquiry.RATE_MAX + 3; i++) if (enquiry.rateLimited('9.9.9.9')) blocked++;
check('a burst from one IP gets cut off', blocked === 3, blocked + ' blocked');
check('a different IP is unaffected', !enquiry.rateLimited('1.1.1.1'));
enquiry._hits.clear();

// ---------- over real HTTP ----------
// index.js starts its own listener (same approach as app.test.js).
const PORT = 4119;
process.env.PORT = String(PORT);
require('../index.js');

function post(body, headers) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: '/api/public/enquiry', method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, headers || {}),
    }, (res) => {
      let b = ''; res.on('data', (d) => b += d);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    req.on('error', () => resolve({ status: 0, headers: {}, body: '' }));
    req.end(data);
  });
}

setTimeout(async () => {
  const FROM_SITE = { Origin: 'https://claritai.ie' };

  saved.length = 0; enquiry._hits.clear();
  let res = await post(OK(), FROM_SITE);
  check('a genuine enquiry is accepted', res.status === 200 && /"ok":true/.test(res.body), res.status + ' ' + res.body);
  check('and it reached the database', saved.length === 1 && saved[0].c === 'leads', JSON.stringify(saved.length));
  check('CORS header names our site', res.headers['access-control-allow-origin'] === 'https://claritai.ie');

  saved.length = 0; enquiry._hits.clear();
  res = await post(OK(), { Origin: 'https://evil.example' });
  check('a foreign origin is refused', res.status === 403 && saved.length === 0, res.status);
  check('and gets no CORS header', !res.headers['access-control-allow-origin']);

  saved.length = 0; enquiry._hits.clear();
  res = await post(OK(), {});
  check('no Origin header at all is refused', res.status === 403 && saved.length === 0, res.status);

  saved.length = 0; enquiry._hits.clear();
  const spam = OK(); spam.website_url = 'http://spam.example';
  res = await post(spam, FROM_SITE);
  check('a honeypot hit looks like success but saves nothing',
    res.status === 200 && /"ok":false/.test(res.body) && saved.length === 0, res.status + ' ' + res.body);

  saved.length = 0; enquiry._hits.clear();
  for (let i = 0; i < enquiry.RATE_MAX; i++) await post(OK(), FROM_SITE);
  const before = saved.length;
  res = await post(OK(), FROM_SITE);
  check('rate limiting stops the flood', saved.length === before && res.status === 200,
    before + ' saved then ' + saved.length);

  saved.length = 0; enquiry._hits.clear();
  res = await post({ name: 'x', email: 'bad', message: '', elapsed: 9000 }, FROM_SITE);
  check('our own form gets a real error code on bad input', res.status === 422 && saved.length === 0, res.status);

  // the preflight
  const pre = await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api/public/enquiry',
      method: 'OPTIONS', headers: FROM_SITE }, (r2) => resolve({ status: r2.statusCode, headers: r2.headers }));
    req.on('error', () => resolve({ status: 0, headers: {} }));
    req.end();
  });
  check('preflight is answered', pre.status === 204 && pre.headers['access-control-allow-origin'] === 'https://claritai.ie', pre.status);

  // the rest of the API must still be locked
  const locked = await new Promise((resolve) => {
    const d = JSON.stringify({ name: 'sneaky' });
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api/leads/abc', method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d), Origin: 'https://claritai.ie' } },
      (r2) => resolve(r2.statusCode));
    req.on('error', () => resolve(0));
    req.end(d);
  });
  check('the authenticated API is still shut to strangers', locked === 401, 'status ' + locked);

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}, 700);
