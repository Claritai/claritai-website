'use strict';

/**
 * Cookie consent, and the only thing on this site that sets a cookie.
 *
 * The rule under the Irish ePrivacy Regulations is that consent has to come
 * BEFORE anything non-essential is stored, and that declining has to actually
 * prevent it. So Google Analytics is not in the page at all: this script injects
 * it, and only after someone has clicked Accept. Nothing loads from Google
 * before that — not the tag, not the script, nothing.
 *
 * Declining after having accepted also deletes the cookies GA already set,
 * because a withdrawal that leaves the cookies in place is not a withdrawal.
 *
 * The choice itself lives in localStorage rather than a cookie. It is strictly
 * necessary to remember it (otherwise we would ask on every page) and keeping it
 * out of cookies means a visitor who declines leaves with a genuinely clean
 * browser.
 */

(() => {
  const KEY = 'claritai-consent';
  const GA_ID = 'G-G9CLS2YH11';

  const read = () => { try { return localStorage.getItem(KEY); } catch (_) { return null; } };
  const write = (v) => { try { localStorage.setItem(KEY, v); } catch (_) { /* private mode */ } };

  let gaLoaded = false;

  function loadAnalytics() {
    if (gaLoaded || window.gtag) return;
    gaLoaded = true;
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    // IP anonymisation is on by default in GA4; named here so it is not a question.
    window.gtag('config', GA_ID, { anonymize_ip: true });
  }

  function clearAnalyticsCookies() {
    // GA writes _ga, _ga_<ID> and sometimes _gid, on the registrable domain.
    const host = location.hostname.replace(/^www\./, '');
    document.cookie.split(';').forEach((entry) => {
      const name = entry.split('=')[0].trim();
      if (!/^_ga|^_gid$/.test(name)) return;
      for (const domain of ['', '; domain=' + host, '; domain=.' + host]) {
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + domain;
      }
    });
  }

  function banner() {
    const el = document.createElement('div');
    el.className = 'cookie-bar';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Cookies');
    el.innerHTML =
      '<p>We would like to use Google Analytics to see which pages people find useful. ' +
      'It sets cookies, so only if you are happy with it. ' +
      '<a href="privacy-policy.html">Privacy policy</a></p>' +
      '<div class="cookie-bar-actions">' +
        '<button type="button" data-consent="declined">Decline</button>' +
        '<button type="button" data-consent="accepted">Accept</button>' +
      '</div>';
    el.addEventListener('click', (e) => {
      const choice = e.target.getAttribute && e.target.getAttribute('data-consent');
      if (!choice) return;
      write(choice);
      if (choice === 'accepted') loadAnalytics();
      else clearAnalyticsCookies();
      el.remove();
    });
    document.body.appendChild(el);
    // Focus the bar so a keyboard user meets the choice rather than walking past it.
    el.querySelector('button').focus({ preventScroll: true });
  }

  const choice = read();
  if (choice === 'accepted') loadAnalytics();
  else if (choice !== 'declined') banner();

  // Footer link, so the decision can be changed later — required if consent is
  // to mean anything, and the privacy policy points people here.
  document.addEventListener('click', (e) => {
    const link = e.target.closest && e.target.closest('[data-cookie-settings]');
    if (!link) return;
    e.preventDefault();
    try { localStorage.removeItem(KEY); } catch (_) { /* ignore */ }
    clearAnalyticsCookies();
    if (!document.querySelector('.cookie-bar')) banner();
  });
})();
