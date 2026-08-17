'use strict';

const { fetchWithTimeout } = require('./util');

// Send each audit lead to a Formspree form (email fallback / in addition to HubSpot).
// Defaults to the site's existing contact form so it works with no extra config;
// override with FORMSPREE_ENDPOINT (full URL) or FORMSPREE_FORM_ID (just the id).
// Best-effort: never throws to the caller.
async function sendFormspree(lead) {
  const endpoint =
    process.env.FORMSPREE_ENDPOINT ||
    (process.env.FORMSPREE_FORM_ID
      ? 'https://formspree.io/f/' + process.env.FORMSPREE_FORM_ID
      : 'https://formspree.io/f/mqeowkly');
  if (!endpoint) return { ok: false, reason: 'no_endpoint' };

  const payload = {
    _subject: 'New AI Audit lead: ' + (lead.company || lead.url || lead.email || ''),
    source: 'AI Business Audit',
    name: lead.name || '',
    email: lead.email || '',
    company: lead.company || '',
    phone: lead.phone || '',
    website: lead.url || '',
    audit_score: lead.score != null ? lead.score + '/100 (' + lead.grade + ')' : '',
    summary: lead.summary || '',
  };

  try {
    const res = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      },
      12000
    );
    return { ok: res.ok };
  } catch (_) {
    return { ok: false, reason: 'error' };
  }
}

module.exports = { sendFormspree };
