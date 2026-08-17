'use strict';

const cheerio = require('cheerio');
const { fetchWithTimeout } = require('./util');

const SOCIAL_PATTERNS = {
  facebook: /facebook\.com/i,
  instagram: /instagram\.com/i,
  linkedin: /linkedin\.com/i,
  twitter: /(twitter\.com|x\.com)/i,
  youtube: /(youtube\.com|youtu\.be)/i,
  tiktok: /tiktok\.com/i,
};

// Crawl the homepage HTML and extract on-page SEO / technical / social signals.
async function scrapeSite(urlObj) {
  const origin = urlObj.origin;
  const signals = {
    reachable: false,
    statusCode: null,
    https: urlObj.protocol === 'https:',
    title: '',
    titleLength: 0,
    metaDescription: '',
    metaDescriptionLength: 0,
    h1Count: 0,
    h1Text: '',
    viewport: false,
    canonical: false,
    lang: false,
    ogTags: false,
    twitterCard: false,
    structuredData: false,
    favicon: false,
    imageCount: 0,
    imagesWithAlt: 0,
    wordCount: 0,
    analytics: false,
    hasContactLink: false,
    hasPhone: false,
    social: {},
    robotsTxt: false,
    sitemapXml: false,
  };

  let html = '';
  try {
    const res = await fetchWithTimeout(
      urlObj.href,
      { redirect: 'follow', headers: { 'User-Agent': 'ClaritaiAuditBot/1.0 (+https://claritai.ie)' } },
      15000
    );
    signals.statusCode = res.status;
    signals.reachable = res.ok;
    signals.https = new URL(res.url).protocol === 'https:';
    html = await res.text();
  } catch (_) {
    return signals; // unreachable — return defaults
  }

  let $;
  try {
    $ = cheerio.load(html);
  } catch (_) {
    return signals;
  }

  signals.title = ($('title').first().text() || '').trim();
  signals.titleLength = signals.title.length;

  const desc = $('meta[name="description"]').attr('content') || '';
  signals.metaDescription = desc.trim();
  signals.metaDescriptionLength = signals.metaDescription.length;

  const h1s = $('h1');
  signals.h1Count = h1s.length;
  signals.h1Text = (h1s.first().text() || '').trim().slice(0, 200);

  signals.viewport = $('meta[name="viewport"]').length > 0;
  signals.canonical = $('link[rel="canonical"]').length > 0;
  signals.lang = !!($('html').attr('lang'));
  signals.ogTags = $('meta[property^="og:"]').length >= 2;
  signals.twitterCard = $('meta[name^="twitter:"]').length > 0;
  signals.structuredData = $('script[type="application/ld+json"]').length > 0;
  signals.favicon = $('link[rel*="icon"]').length > 0;

  const imgs = $('img');
  signals.imageCount = imgs.length;
  signals.imagesWithAlt = imgs.filter((_, el) => ($(el).attr('alt') || '').trim().length > 0).length;

  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  signals.wordCount = bodyText ? bodyText.split(' ').length : 0;

  const rawLower = html.toLowerCase();
  signals.analytics = /gtag\(|googletagmanager\.com|google-analytics\.com|gtm\.js|plausible|fathom|matomo/.test(rawLower);

  // links: social, contact, phone
  const hrefs = [];
  $('a[href]').each((_, el) => hrefs.push($(el).attr('href') || ''));
  const allHref = hrefs.join(' ');
  for (const [name, re] of Object.entries(SOCIAL_PATTERNS)) {
    if (re.test(allHref)) signals.social[name] = true;
  }
  signals.hasContactLink = /mailto:|\/contact|contact-us|#contact/i.test(allHref);
  signals.hasPhone = /tel:/i.test(allHref) || /\+?\d[\d\s().-]{7,}\d/.test(bodyText.slice(0, 4000));

  // robots.txt & sitemap.xml (best-effort, short timeout)
  await Promise.all([
    fetchWithTimeout(origin + '/robots.txt', {}, 6000)
      .then((r) => { if (r.ok) signals.robotsTxt = true; })
      .catch(() => {}),
    fetchWithTimeout(origin + '/sitemap.xml', {}, 6000)
      .then((r) => { if (r.ok) signals.sitemapXml = true; })
      .catch(() => {}),
  ]);

  return signals;
}

module.exports = { scrapeSite, SOCIAL_PATTERNS };
