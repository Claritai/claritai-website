'use strict';

// A realistic sample report used in MOCK mode (and mirrored by the front-end demo).
function sampleReport(url, company) {
  return {
    ok: true,
    url: url || 'https://example.ie',
    company: company || 'Example Ltd',
    scannedAt: new Date().toISOString(),
    overall: { score: 62, grade: 'C', label: 'Fair' },
    categories: [
      { key: 'seo', label: 'SEO & Search Visibility', score: 58, note: 'Titles and headings are in place, but structured data and a sitemap are missing.' },
      { key: 'performance', label: 'Performance & Technical', score: 71, note: 'Loads reasonably on mobile; a few render-blocking assets slow first paint.' },
      { key: 'content', label: 'Content & Messaging', score: 55, note: 'Homepage messaging is thin and the value proposition is not immediately clear.' },
      { key: 'presence', label: 'Online Presence', score: 66, note: 'Analytics is installed, but structured data and a sitemap would aid discovery.' },
      { key: 'social', label: 'Social Media', score: 48, note: 'Only one social channel is linked and Open Graph tags are incomplete.' },
    ],
    swot: {
      strengths: ['Served securely over HTTPS with a mobile-friendly layout.', 'Web analytics is installed to measure traffic.', 'Clear, single H1 on the homepage.'],
      weaknesses: ['No structured data or XML sitemap for search engines.', 'Thin homepage content and an unclear value proposition.', 'Limited social media presence linked from the site.'],
      opportunities: ['Rank for the local, high-intent terms your customers search for.', 'Convert more visitors with sharper messaging and calls to action.', 'Automate content and lead follow-up with AI.'],
      threats: ['Competitors with stronger SEO are capturing your search traffic.', 'Weak measurement makes marketing ROI hard to prove.'],
    },
    recommendations: [
      { title: 'Add structured data and an XML sitemap', detail: 'Implement schema markup and submit a sitemap so search engines index and enrich your listings.', impact: 'High', category: 'SEO' },
      { title: 'Sharpen the homepage value proposition', detail: 'Lead with a clear statement of what you do and for whom, plus a single strong call to action.', impact: 'High', category: 'Content' },
      { title: 'Strengthen social profiles and Open Graph tags', detail: 'Link all active channels and add OG/Twitter tags so shared links look professional.', impact: 'Medium', category: 'Social' },
      { title: 'Optimise mobile performance', detail: 'Defer render-blocking scripts and compress images to improve first paint on mobile.', impact: 'Medium', category: 'Performance' },
      { title: 'Deploy an AI enquiry assistant', detail: 'A chat/assistant trained on your business can qualify leads and answer FAQs 24/7.', impact: 'Medium', category: 'AI & Automation' },
    ],
    summary:
      'Your online presence has a solid, secure foundation with clear, fixable gaps in SEO, messaging and social. Closing these would meaningfully lift both visibility and enquiries — the kind of work Claritai delivers for Irish SMEs.',
    meta: { aiGenerated: false, pageSpeed: false, mock: true },
  };
}

module.exports = { sampleReport };
