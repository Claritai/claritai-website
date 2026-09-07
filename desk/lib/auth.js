'use strict';

// Google sign-in, restricted to one Workspace domain.
//
// No auth library: the whole flow is ~150 lines and worth being able to read.
// The id_token is accepted without re-verifying its signature ONLY because we
// receive it directly from Google's token endpoint over TLS, in response to our
// own request, authenticated with our client secret — Google's own guidance
// allows this. We never trust an id_token that arrives any other way.

const crypto = require('crypto');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const SESSION_COOKIE = 'desk_session';
const STATE_COOKIE = 'desk_state';
const SESSION_DAYS = 14;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not set');
  return s;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(str) {
  return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(payloadObj) {
  const body = b64url(JSON.stringify(payloadObj));
  const mac = b64url(crypto.createHmac('sha256', secret()).update(body).digest());
  return body + '.' + mac;
}

function verify(token) {
  if (typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = b64url(crypto.createHmac('sha256', secret()).update(body).digest());
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(unb64url(body).toString('utf8'));
  } catch (_) {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
  return payload;
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res, name, value, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === 'production';
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) bits.push('Secure');
  res.append('Set-Cookie', bits.join('; '));
}

function clearCookie(res, name) {
  setCookie(res, name, '', 0);
}

function baseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/+$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  return `${proto}://${req.headers.host}`;
}

function redirectUri(req) {
  return baseUrl(req) + '/auth/callback';
}

function allowedDomain() {
  return (process.env.ALLOWED_DOMAIN || 'claritai.ie').toLowerCase();
}

// --- routes -------------------------------------------------------------

function startLogin(req, res) {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(500).send('Google sign-in is not configured yet (GOOGLE_CLIENT_ID is missing).');
  }
  const nonce = b64url(crypto.randomBytes(16));
  // Remember where they were headed, so a deep link survives the round trip.
  const next = typeof req.query.next === 'string' && req.query.next.startsWith('/') ? req.query.next : '/';
  setCookie(res, STATE_COOKIE, sign({ nonce, next, exp: Date.now() + 10 * 60 * 1000 }), 600);

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state: nonce,
    hd: allowedDomain(), // asks Google to show only Workspace accounts on this domain
    prompt: 'select_account',
    access_type: 'online',
  });
  res.redirect(`${AUTH_URL}?${params.toString()}`);
}

async function callback(req, res) {
  const stateCookie = verify(parseCookies(req)[STATE_COOKIE]);
  clearCookie(res, STATE_COOKIE);

  if (!stateCookie || !req.query.state || req.query.state !== stateCookie.nonce) {
    return res.redirect('/login?error=state');
  }
  if (req.query.error || !req.query.code) {
    return res.redirect('/login?error=denied');
  }

  let claims;
  try {
    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(req.query.code),
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri(req),
        grant_type: 'authorization_code',
      }),
    });
    if (!resp.ok) throw new Error('token exchange failed: ' + resp.status);
    const tokens = await resp.json();
    if (!tokens.id_token) throw new Error('no id_token in response');
    const part = tokens.id_token.split('.')[1];
    claims = JSON.parse(unb64url(part).toString('utf8'));
  } catch (err) {
    console.error('[auth] token exchange failed:', err.message);
    return res.redirect('/login?error=exchange');
  }

  // Every one of these must hold. Checked server-side, so nothing the browser
  // sends can get past them.
  const domain = allowedDomain();
  const email = String(claims.email || '').toLowerCase();
  const ok =
    claims.aud === process.env.GOOGLE_CLIENT_ID &&
    (claims.iss === 'accounts.google.com' || claims.iss === 'https://accounts.google.com') &&
    typeof claims.exp === 'number' &&
    claims.exp * 1000 > Date.now() &&
    claims.email_verified === true &&
    String(claims.hd || '').toLowerCase() === domain &&
    email.endsWith('@' + domain);

  if (!ok) {
    console.warn('[auth] rejected sign-in for', email || '(no email)');
    return res.redirect('/login?error=domain');
  }

  setCookie(
    res,
    SESSION_COOKIE,
    sign({
      email,
      name: claims.name || email.split('@')[0],
      picture: claims.picture || '',
      exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
    }),
    SESSION_DAYS * 24 * 60 * 60
  );

  const next = stateCookie.next && stateCookie.next.startsWith('/') ? stateCookie.next : '/';
  res.redirect(next);
}

function logout(req, res) {
  clearCookie(res, SESSION_COOKIE);
  res.redirect('/login?bye=1');
}

function currentUser(req) {
  return verify(parseCookies(req)[SESSION_COOKIE]);
}

// Gate for pages: bounce to the login screen.
function requirePage(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl || '/'));
  req.user = user;
  next();
}

// Gate for the API: return JSON, never a redirect, so fetch() can react properly.
function requireApi(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'not_signed_in' });
  req.user = user;
  next();
}

module.exports = { startLogin, callback, logout, currentUser, requirePage, requireApi, allowedDomain };
