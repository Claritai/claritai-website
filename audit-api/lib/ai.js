'use strict';

const { fetchWithTimeout } = require('./util');

// Ask Azure OpenAI to write the SWOT, per-category notes and prioritised
// recommendations from the collected signals + computed scores.
// Returns null on any failure so the caller can fall back to the rule-based narrative.
async function generateNarrative({ url, company, signals, scores, psi }) {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const key = process.env.AZURE_OPENAI_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-06-01';
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
    'Respond with STRICT JSON only, matching the requested schema.';

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

  const apiUrl =
    endpoint.replace(/\/$/, '') +
    '/openai/deployments/' +
    encodeURIComponent(deployment) +
    '/chat/completions?api-version=' +
    encodeURIComponent(apiVersion);

  try {
    const res = await fetchWithTimeout(
      apiUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': key },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.5,
          max_tokens: 1200,
          response_format: { type: 'json_object' },
        }),
      },
      30000
    );
    if (!res.ok) return null;
    const data = await res.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || !parsed.swot) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

module.exports = { generateNarrative };
