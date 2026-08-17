'use strict';

const express = require('express');
const cors = require('cors');

const { normaliseUrl, isValidEmail } = require('./lib/util');
const { scrapeSite } = require('./lib/scrape');
const { runPageSpeed } = require('./lib/pagespeed');
const { scoreCategories, overallFrom, CATEGORY_META, ruleNarrative } = require('./lib/scoring');
const { generateNarrative } = require('./lib/ai');
const { pushLead } = require('./lib/hubspot');
const { sampleReport } = require('./lib/sample');

const app = express();
app.use(express.json({ limit: '256kb' }));

// CORS — set ALLOWED_ORIGIN to your site (e.g. https://claritai.ie). Defaults to open for testing.
const allowed = (process.env.ALLOWED_ORIGIN || '*').split(',').map((s) => s.trim());
app.use(
  cors({
    origin: allowed.includes('*') ? true : allowed,
    methods: ['POST', 'GET', 'OPTIONS'],
  })
);

// --- very light in-memory rate limit (per IP) ---
const HITS = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = Number(process.env.RATE_LIMIT || 6);
function rateLimited(ip) {
  const now = Date.now();
  const rec = HITS.get(ip) || { count: 0, start: now };
  if (now - rec.start > WINDOW_MS) {
    rec.count = 0;
    rec.start = now;
  }
  rec.count += 1;
  HITS.set(ip, rec);
  return rec.count > MAX_PER_WINDOW;
}

app.get('/', (_req, res) => res.json({ service: 'claritai-audit-api', ok: true }));
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.post('/api/audit', async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').toString().split(',')[0].trim();
  if (rateLimited(ip)) {
    return res.status(429).json({ ok: false, error: 'Too many requests. Please try again in a minute.' });
  }

  const { url, name, email, company, phone, industry, consent } = req.body || {};

  if (!isValidEmail(email)) return res.status(400).json({ ok: false, error: 'A valid email is required.' });
  const urlObj = normaliseUrl(url);
  if (!urlObj) return res.status(400).json({ ok: false, error: 'Please enter a valid website address.' });

  // Mock mode for local/front-end testing without any API keys.
  if (process.env.MOCK === '1') {
    return res.json(sampleReport(urlObj.href, company));
  }

  try {
    // 1) Gather signals (crawl) + PageSpeed in parallel.
    const [signals, psi] = await Promise.all([scrapeSite(urlObj), runPageSpeed(urlObj)]);

    if (!signals.reachable && signals.statusCode == null) {
      return res.status(422).json({ ok: false, error: "We couldn't reach that website. Please check the address and try again." });
    }

    // 2) Deterministic scoring.
    const scores = scoreCategories(signals, psi);
    const overall = overallFrom(scores);

    // 3) Narrative — AI first, rule-based fallback.
    let narrative = await generateNarrative({ url: urlObj.href, company, signals, scores, psi });
    let aiUsed = true;
    if (!narrative) {
      narrative = ruleNarrative(signals, scores);
      aiUsed = false;
    }

    const categories = CATEGORY_META.map((c) => ({
      key: c.key,
      label: c.label,
      score: scores[c.key],
      note: (narrative.notes && narrative.notes[c.key]) || '',
    }));

    const report = {
      ok: true,
      url: urlObj.href,
      company: company || null,
      scannedAt: new Date().toISOString(),
      overall,
      categories,
      swot: narrative.swot,
      recommendations: narrative.recommendations || ruleNarrative(signals, scores).recommendations || [],
      summary: narrative.summary || '',
      meta: { aiGenerated: aiUsed, pageSpeed: !!psi },
    };

    // 4) Push the lead to HubSpot (best-effort, non-blocking of the response payload).
    pushLead({
      name,
      email,
      company,
      phone,
      industry,
      consent,
      url: urlObj.href,
      score: overall.score,
      grade: overall.grade,
      summary: report.summary,
    }).catch(() => {});

    return res.json(report);
  } catch (err) {
    console.error('audit error:', err && err.message);
    return res.status(500).json({ ok: false, error: 'Something went wrong running the audit. Please try again.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Claritai audit API listening on :' + PORT));
