'use strict';

const { clamp, gradeFor } = require('./util');

// Weights for the overall score.
const WEIGHTS = { seo: 0.25, performance: 0.25, content: 0.15, presence: 0.20, social: 0.15 };

function pts(cond, value) {
  return cond ? value : 0;
}

// Compute deterministic 0-100 scores per category from crawl signals + PageSpeed.
function scoreCategories(signals, psi) {
  // ---- SEO ----
  let seo = 0;
  seo += pts(signals.titleLength >= 20 && signals.titleLength <= 65, 18);
  seo += pts(signals.metaDescriptionLength >= 70 && signals.metaDescriptionLength <= 165, 18);
  seo += pts(signals.h1Count >= 1 && signals.h1Count <= 2, 12);
  seo += pts(signals.canonical, 8);
  seo += pts(signals.structuredData, 12);
  seo += pts(signals.robotsTxt, 6);
  seo += pts(signals.sitemapXml, 8);
  seo += pts(signals.lang, 3);
  // Blend with PageSpeed SEO score if available (weighted 45%).
  if (psi && psi.seo != null) seo = Math.round(seo * 0.55 + psi.seo * 0.45);
  const seoScore = clamp(seo);

  // ---- Performance & Technical ----
  let perf;
  if (psi && psi.performance != null) {
    perf = psi.performance * 0.6 + (psi.bestPractices != null ? psi.bestPractices : 70) * 0.2 + (psi.accessibility != null ? psi.accessibility : 70) * 0.2;
  } else {
    // No PSI — derive a rough technical score from signals.
    perf = 40 + pts(signals.https, 20) + pts(signals.viewport, 20) + pts(signals.favicon, 10) + pts(signals.reachable, 10);
  }
  perf = perf - pts(!signals.https, 15) - pts(!signals.viewport, 10);
  const perfScore = clamp(perf);

  // ---- Content & Messaging ----
  let content = 0;
  content += pts(signals.wordCount >= 300, 22) + pts(signals.wordCount >= 800, 10);
  content += pts(signals.metaDescriptionLength >= 70, 14);
  content += pts(signals.h1Count >= 1, 14);
  content += pts(signals.imageCount > 0 && signals.imagesWithAlt / Math.max(1, signals.imageCount) >= 0.6, 18);
  content += pts(signals.hasContactLink, 12);
  content += pts(signals.ogTags, 10);
  const contentScore = clamp(content);

  // ---- Online Presence & Discoverability ----
  let presence = 0;
  presence += pts(signals.https, 16);
  presence += pts(signals.favicon, 8);
  presence += pts(signals.sitemapXml, 12);
  presence += pts(signals.robotsTxt, 8);
  presence += pts(signals.analytics, 16);
  presence += pts(signals.hasContactLink, 12);
  presence += pts(signals.hasPhone, 8);
  presence += pts(signals.structuredData, 8);
  presence += pts(signals.canonical, 6);
  presence += pts(signals.reachable, 6);
  const presenceScore = clamp(presence);

  // ---- Social Media ----
  const socialCount = Object.values(signals.social || {}).filter(Boolean).length;
  let social = 0;
  social += Math.min(socialCount, 4) * 18; // up to 72 for 4+ profiles linked
  social += pts(signals.ogTags, 16);
  social += pts(signals.twitterCard, 12);
  const socialScore = clamp(social);

  return {
    seo: seoScore,
    performance: perfScore,
    content: contentScore,
    presence: presenceScore,
    social: socialScore,
  };
}

function overallFrom(scores) {
  const raw =
    scores.seo * WEIGHTS.seo +
    scores.performance * WEIGHTS.performance +
    scores.content * WEIGHTS.content +
    scores.presence * WEIGHTS.presence +
    scores.social * WEIGHTS.social;
  const score = clamp(raw);
  return { score, ...gradeFor(score) };
}

const CATEGORY_META = [
  { key: 'seo', label: 'SEO & Search Visibility' },
  { key: 'performance', label: 'Performance & Technical' },
  { key: 'content', label: 'Content & Messaging' },
  { key: 'presence', label: 'Online Presence' },
  { key: 'social', label: 'Social Media' },
];

// Rule-based notes/SWOT used as a fallback if the AI step is unavailable.
function ruleNarrative(signals, scores) {
  const socialCount = Object.values(signals.social || {}).filter(Boolean).length;
  const notes = {
    seo: scores.seo >= 70 ? 'Solid on-page SEO foundations.' : 'On-page SEO has clear gaps to close (titles, meta, structured data).',
    performance: scores.performance >= 70 ? 'The site loads and renders reasonably well on mobile.' : 'Mobile performance and technical health need attention.',
    content: scores.content >= 70 ? 'Content depth and messaging are reasonable.' : 'Pages are thin or under-optimised for visitors and search.',
    presence: scores.presence >= 70 ? 'Good discoverability signals in place.' : 'Discoverability signals (analytics, sitemap, structured data) are incomplete.',
    social: socialCount >= 2 ? 'Some social channels are linked from the site.' : 'Little or no social presence linked from the site.',
  };

  const strengths = [];
  const weaknesses = [];
  if (signals.https) strengths.push('Site is served securely over HTTPS.');
  if (signals.viewport) strengths.push('Mobile-friendly viewport is configured.');
  if (scores.seo >= 70) strengths.push('Core on-page SEO is in good shape.');
  if (socialCount >= 2) strengths.push('Active social channels are linked.');
  if (signals.analytics) strengths.push('Web analytics is installed to measure traffic.');
  if (!signals.metaDescription) weaknesses.push('Missing or weak meta description on the homepage.');
  if (signals.h1Count === 0) weaknesses.push('No clear H1 heading for search engines to read.');
  if (!signals.structuredData) weaknesses.push('No structured data (schema) to enhance search listings.');
  if (!signals.sitemapXml) weaknesses.push('No XML sitemap found to guide search crawlers.');
  if (socialCount < 2) weaknesses.push('Limited social media presence linked from the site.');
  if (!signals.analytics) weaknesses.push('No analytics detected — traffic is not being measured.');

  return {
    notes,
    swot: {
      strengths: strengths.length ? strengths.slice(0, 5) : ['The site is live and reachable.'],
      weaknesses: weaknesses.length ? weaknesses.slice(0, 5) : ['A few optimisation opportunities remain.'],
      opportunities: [
        'Improve search rankings for the terms your customers actually use.',
        'Turn more visitors into enquiries with clearer messaging and calls to action.',
        'Use AI and automation to scale content and customer engagement.',
      ],
      threats: [
        'Competitors with stronger SEO and content are likely capturing your search traffic.',
        'Gaps in analytics make it hard to prove marketing ROI.',
      ],
    },
    summary:
      'Your online presence has a workable foundation with clear, fixable gaps. Tightening SEO, sharpening your messaging and adding measurement would lift both visibility and conversions — exactly the kind of work Claritai delivers for Irish SMEs.',
  };
}

module.exports = { scoreCategories, overallFrom, CATEGORY_META, ruleNarrative };
