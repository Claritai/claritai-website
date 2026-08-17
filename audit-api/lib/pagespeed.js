'use strict';

const { fetchWithTimeout } = require('./util');

// Query Google PageSpeed Insights (Lighthouse) for the mobile strategy.
// Returns null if no API key is set or the call fails — the pipeline degrades gracefully.
// Logs the reason so failures are visible in the Render logs.
async function runPageSpeed(urlObj) {
  const key = process.env.PAGESPEED_API_KEY;
  if (!key) {
    console.log('PageSpeed: PAGESPEED_API_KEY not set — skipping live PageSpeed.');
    return null;
  }

  const api = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  api.searchParams.set('url', urlObj.href);
  api.searchParams.set('key', key);
  api.searchParams.set('strategy', 'mobile');
  for (const c of ['performance', 'seo', 'accessibility', 'best-practices']) {
    api.searchParams.append('category', c);
  }

  try {
    const res = await fetchWithTimeout(api.href, {}, 55000);
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 400); } catch (_) {}
      console.error('PageSpeed ' + res.status + ' :: ' + detail);
      return null;
    }
    const data = await res.json();
    const cats = (data.lighthouseResult && data.lighthouseResult.categories) || {};
    const pct = (c) => (cats[c] && typeof cats[c].score === 'number' ? Math.round(cats[c].score * 100) : null);
    const out = {
      performance: pct('performance'),
      seo: pct('seo'),
      accessibility: pct('accessibility'),
      bestPractices: pct('best-practices'),
    };
    console.log('PageSpeed ok:', JSON.stringify(out));
    return out;
  } catch (e) {
    console.error('PageSpeed request failed:', e && e.name, e && e.message);
    return null;
  }
}

module.exports = { runPageSpeed };
