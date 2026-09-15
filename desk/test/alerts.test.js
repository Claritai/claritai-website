// Covers the alert path: who gets mailed, what the message says, and — the part
// that decides whether anyone keeps paying attention to these — when we stay
// quiet. No network: global.fetch is stubbed and the DB is a fake.

const http = require('http');
const assert = require('assert');

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')); }
};

// --- a fake db, shared by both halves of this file -----------------------
const dbPath = require.resolve('../lib/db');
let roster = [];
const patches = [];
const stubDb = {
  pool: {
    query: async (sql) => (/FROM users/i.test(sql) ? { rows: roster } : { rows: [] }),
    end: async () => {},
  },
  init: async () => {},
  list: async () => sites,
  patch: async (c, id, f) => { patches.push({ id, f }); },
  logActivity: async () => {},
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: stubDb };

// --- a fake Resend --------------------------------------------------------
const sends = [];
global.fetch = async (url, opts) => {
  sends.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
  return { ok: true, status: 200, json: async () => ({ id: 'stub' }) };
};

let sites = [];

async function mailUnitTests() {
  const mail = require('../lib/mail');

  // -- configuration gate
  delete process.env.RESEND_API_KEY;
  check('not configured without an API key', mail.isConfigured() === false);
  const skipped = await mail.send({ to: ['a@b.ie'], subject: 'x', text: 'y' });
  check('send is a no-op with no API key', skipped.sent === false && skipped.reason === 'not_configured');
  check('no request was made', sends.length === 0);

  process.env.RESEND_API_KEY = 'test_key';
  check('configured once the key is set', mail.isConfigured() === true);

  // -- recipients
  process.env.ALERT_EMAILS = 'kevin@claritai.ie, sean@claritai.ie';
  let who = await mail.recipients();
  check('ALERT_EMAILS is split on commas',
    who.length === 2 && who[0] === 'kevin@claritai.ie' && who[1] === 'sean@claritai.ie', JSON.stringify(who));

  delete process.env.ALERT_EMAILS;
  roster = [{ email: 'kevin@claritai.ie' }, { email: 'sean@claritai.ie' }, { email: '' }];
  who = await mail.recipients();
  check('falls back to the signed-in roster, skipping blanks',
    who.length === 2 && who.includes('sean@claritai.ie'), JSON.stringify(who));

  // -- subject lines
  const down1 = [{ name: 'RM Cleary', url: 'https://rmcleary.ie', to: 'crit', from: 'ok', note: 'HTTP 500' }];
  const down2 = down1.concat([{ name: 'Ratoath Dental', url: 'https://rd.ie', to: 'crit', from: 'ok', note: 'timeout' }]);
  const back1 = [{ name: 'RM Cleary', url: 'https://rmcleary.ie', to: 'ok', from: 'crit', note: '' }];
  const warn1 = [{ name: 'Ratoath Dental', url: 'https://rd.ie', to: 'warn', from: 'ok', note: 'SSL expires in 9 days' }];

  check('one site down names it', mail.subjectFor(down1) === 'DOWN: RM Cleary', mail.subjectFor(down1));
  check('several down are counted', /^DOWN: 2 sites/.test(mail.subjectFor(down2)), mail.subjectFor(down2));
  check('a recovery reads as a recovery', /^Recovered: RM Cleary/.test(mail.subjectFor(back1)), mail.subjectFor(back1));
  check('a warning reads as a warning', /^Warning: Ratoath Dental/.test(mail.subjectFor(warn1)), mail.subjectFor(warn1));
  check('down outranks recovered in the subject',
    /^DOWN/.test(mail.subjectFor(down1.concat(back1))), mail.subjectFor(down1.concat(back1)));

  // -- body
  const body = mail.bodyFor(down2.concat(back1));
  check('the text body names every site',
    body.text.includes('RM Cleary') && body.text.includes('Ratoath Dental'));
  check('the text body carries the reason', body.text.includes('HTTP 500'));
  check('the text body carries the address', body.text.includes('https://rmcleary.ie'));
  check('failures are listed before recoveries',
    body.html.indexOf('Ratoath Dental') < body.html.indexOf('is back up') ||
    body.html.indexOf('DOWN') < body.html.indexOf('recovered'));

  const nasty = mail.bodyFor([{ name: '<script>x</script>', url: 'https://a.ie', to: 'crit', from: 'ok', note: '"&"' }]);
  check('site names are escaped in the HTML',
    !nasty.html.includes('<script>') && nasty.html.includes('&lt;script&gt;'));

  // -- nothing to say
  sends.length = 0;
  const quiet = await mail.sendSiteAlert([]);
  check('no changes means no email', quiet.sent === false && sends.length === 0);

  // -- a real send
  const sent = await mail.sendSiteAlert(down1);
  check('a change does send', sent.sent === true && sends.length === 1);
  check('it goes to the roster',
    sends[0].body.to.includes('kevin@claritai.ie') && sends[0].body.to.length === 2, JSON.stringify(sends[0].body.to));
  check('it authenticates', sends[0].headers.Authorization === 'Bearer test_key');
  check('it has both a text and an HTML part', !!sends[0].body.text && !!sends[0].body.html);

  sends.length = 0;
  await mail.sendMonitorBroken('DNS is unreachable');
  check('a broken monitor is its own alert',
    sends.length === 1 && /not running/i.test(sends[0].body.subject), sends.length && sends[0].body.subject);
}

// --- the monitor end to end ----------------------------------------------
// One run, three fixtures, three questions: does a real change alert, does an
// unchanged problem stay quiet, and does a site the monitor has never seen
// before get recorded without shouting?
function monitorRun() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/ok') { res.writeHead(200); return res.end('fine'); }
      res.writeHead(500); res.end('boom');
    });

    server.listen(4112, '127.0.0.1', () => {
      sites = [
        // was fine, now 500 — this is the news
        { id: 'broke', name: 'Just broke', url: 'http://127.0.0.1:4112/500',
          status: 'ok', autoStatus: 'ok', issues: [] },
        // already known to be down — must not be mentioned again
        { id: 'still', name: 'Still down', url: 'http://127.0.0.1:4112/500',
          status: 'crit', autoStatus: 'crit', issues: [{ text: 'down', auto: true, resolved: false }] },
        // never checked before — record it, don't alert on it
        { id: 'fresh', name: 'Never seen', url: 'http://127.0.0.1:4112/500',
          status: 'ok', issues: [] },
        // was down, now answering — worth saying
        { id: 'back', name: 'Back up', url: 'http://127.0.0.1:4112/ok',
          status: 'crit', autoStatus: 'crit', issues: [{ text: 'was down', auto: true, resolved: false }] },
      ];
      sends.length = 0;
      process.env.RESEND_API_KEY = 'test_key';
      process.env.ALERT_EMAILS = 'kevin@claritai.ie';

      require('../cron/check-sites.js');

      setTimeout(() => {
        check('every site was still written', patches.length === 4, patches.length + ' writes');
        check('exactly one email for the whole run', sends.length === 1, sends.length + ' sends');

        const text = sends.length ? sends[0].body.text : '';
        check('the newly broken site is in it', text.includes('Just broke'));
        check('the recovered site is in it', text.includes('Back up'));
        check('a site that was already down is NOT repeated', !text.includes('Still down'));
        check('a first sighting is NOT alerted on', !text.includes('Never seen'));
        check('the subject leads with the outage',
          sends.length && /^DOWN/.test(sends[0].body.subject), sends.length && sends[0].body.subject);

        server.close();
        resolve();
      }, 4000);
    });
  });
}

(async () => {
  await mailUnitTests();
  await monitorRun();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
