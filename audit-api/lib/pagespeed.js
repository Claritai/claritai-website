'use strict';

const { fetchWithTimeout } = require('./util');

// Query Google PageSpeed Insights (Lighthouse) for the mobile strategy.
// Returns null if no API key is set or the call fails — the pipeline degrades gracefully.
async function runPageSpeed(urlObj) {
  const key = process.env.PAGESPEED_API_KEY;
  if (!key) return null;

  const api = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  api.searchParams.set('url', urlObj.href);
  api.searchParams.set('key', key);
  api.searchParams.set('strategy', 'mobile');
  for (const c of ['performance', 'seo', 'accessibility', 'best-practices']) {
    api.searchParams.append('category', c);
  }

  try {
    const res = await fetchWithTimeout(api.href, {}, 30000);
    if (!res.ok) return null;
    const data = await res.json();
    const cats = (data.lighthouseResult && data.lighthouseResult.categories) || {};
    const pct = (c) => (cats[c] && typeof cats[c].score === 'number' ? Math.round(cats[c].score * 100) : null);
    return {
      performance: pct('performance'),
      seo: pct('seo'),
      accessibility: pct('accessibility'),
      bestPractices: pct('best-practices'),
    };
  } catch (_) {
    return null;
  }
}

module.exports = { runPageSpeed };
