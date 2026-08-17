'use strict';

const { fetchWithTimeout } = require('./util');

// Robustly parse a JSON object out of a model response (handles code fences / stray text).
function parseJsonObject(content) {
  if (!content || typeof content !== 'string') return null;
  let t = content.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  if (t[0] !== '{') {
    const s = t.indexOf('{');
    const e = t.lastIndexOf('}');
    if (s >= 0 && e > s) t = t.slice(s, e + 1);
  }
  try {
    return JSON.parse(t);
  } catch (_) {
    return null;
  }
}

// Ask Azure OpenAI to write the SWOT, per-category notes and prioritised
// recommendations from the collected signals + computed scores.
// Works with GPT-5 / reasoning models (max_completion_tokens, no temperature)
// via the version-agnostic v1 endpoint, falling back to the classic deployments
// endpoint for older models. Returns null on any failure so the caller can fall
// back to the rule-based narrative.
async function generateNarrative({ url, company, signals, scores, psi }) {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const key = process.env.AZURE_OPENAI_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2025-04-01-preview';
  if (!endpoint || !key || !deployment) return null;

  const facts = {
    website: url,
    company: company || null,
    scores,
    pageSpeed: psi || 'unavailable',
    signals: {
      https: signals.https,
      title: signals.title,
      titleLength: signals.titleLength,
      metaDescription: signals.metaDescription,
      metaDescriptionLength: signals.metaDescriptionLength,
      h1Count: signals.h1Count,
      viewport: signals.viewport,
      canonical: signals.canonical,
      structuredData: signals.structuredData,
      ogTags: signals.ogTags,
      twitterCard: signals.twitterCard,
      favicon: signals.favicon,
      wordCount: signals.wordCount,
      imageAltCoverage: signals.imageCount ? Math.round((signals.imagesWithAlt / signals.imageCount) * 100) + '%' : 'n/a',
      analytics: signals.analytics,
      hasContactLink: signals.hasContactLink,
      robotsTxt: signals.robotsTxt,
      sitemapXml: signals.sitemapXml,
      socialProfilesLinked: Object.keys(signals.social || {}).filter((k) => signals.social[k]),
    },
  };

  const system =
    'You are a senior digital consultant at Claritai, an Irish AI consultancy and digital agency ' +
    '(services: AI consultancy & automation, website development, SEO optimisation, social media management). ' +
    'You are writing the narrative for an automated website & online-presence audit that a prospect will read as a lead magnet. ' +
    'Be specific, professional and encouraging but honest. Base every statement ONLY on the supplied data. ' +
    'Do not invent metrics. Tie recommendations to how Claritai can help. Write in British/Irish English. ' +
    'Return ONLY a raw JSON object — no markdown, no code fences, no commentary.';

  const user =
    'Here is the audit data as JSON:\n' +
    JSON.stringify(facts) +
    '\n\nReturn a JSON object with exactly these keys:\n' +
    '{\n' +
    '  "summary": string (2-3 sentences, plain-English overview of how the company is performing online),\n' +
    '  "notes": { "seo": string, "performance": string, "content": string, "presence": string, "social": string } (one concise sentence each, specific to the findings),\n' +
    '  "swot": { "strengths": string[], "weaknesses": string[], "opportunities": string[], "threats": string[] } (2-4 items each, each a short sentence),\n' +
    '  "recommendations": [ { "title": string, "detail": string (1-2 sentences), "impact": "High"|"Medium"|"Low", "category": "SEO"|"Performance"|"Content"|"Presence"|"Social"|"AI & Automation" } ] (5-7 items, most impactful first)\n' +
    '}';

  // GPT-5 / reasoning-model friendly body: max_completion_tokens, no temperature, no response_format.
  const body = {
    model: deployment,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_completion_tokens: 4000,
    reasoning_effort: 'low',
  };

  const base = endpoint.replace(/\/+$/, '');
  const v1Url = base + '/openai/v1/chat/completions';
  const classicUrl =
    base + '/openai/deployments/' + encodeURIComponent(deployment) + '/chat/completions?api-version=' + encodeURIComponent(apiVersion);

  async function call(apiUrl) {
    try {
      const res = await fetchWithTimeout(
        apiUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'api-key': key },
          body: JSON.stringify(body),
        },
        45000
      );
      if (!res.ok) {
        // Surface the reason in logs to make misconfiguration easy to diagnose.
        let detail = '';
        try { detail = (await res.text()).slice(0, 300); } catch (_) {}
        console.error('Azure OpenAI ' + res.status + ' at ' + apiUrl.split('?')[0] + ' :: ' + detail);
        return null;
      }
      const data = await res.json();
      const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      const parsed = parseJsonObject(content);
      if (parsed && parsed.swot) return parsed;
      return null;
    } catch (e) {
      console.error('Azure OpenAI call failed:', e && e.message);
      return null;
    }
  }

  // Prefer the version-agnostic v1 endpoint (knows the latest models like gpt-5-mini);
  // fall back to the classic per-deployment endpoint for older models/setups.
  let out = await call(v1Url);
  if (!out) out = await call(classicUrl);
  return out;
}

module.exports = { generateNarrative };
