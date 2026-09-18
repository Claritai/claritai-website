// Where the enquiry form posts. This is Claritai Desk's one public endpoint —
// everything else in Desk sits behind Google sign-in.
//
// Desk only accepts posts from claritai.ie and www.claritai.ie. That is
// deliberate: the allow-list is pinned to exact hostnames so nobody else's
// deployment can file leads into the CRM. If you preview this site on a new
// Render URL, that host has to be added to ENQUIRY_ORIGINS on the Desk service
// first, or enquiries from the preview are refused and only the email fallback
// arrives.
window.CLARITAI_CONFIG = Object.freeze({
  leadEndpoint: "https://desk.claritai.ie/api/public/enquiry"
});
