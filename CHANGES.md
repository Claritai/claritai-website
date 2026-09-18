# Claritai site rebuild — what changed from the handoff package

The design, copy and prices are the designer's, untouched. These are the
changes made to turn the handoff into something that can replace claritai.ie.

## 1. Five real pages instead of one

The handoff was a single `index.html` with `site-builder.js` hiding and showing
sections based on `?page=`. Google would have seen one page where you currently
have eleven.

Each view is now a real file, generated from the same markup, with its own URL,
title, description and canonical tag:

| Page            | File                   |
|-----------------|------------------------|
| Home            | `index.html`           |
| Our work        | `our-work.html`        |
| Build your site | `build-your-site.html` |
| How it works    | `how-it-works.html`    |
| Questions       | `questions.html`       |

The page-routing half of `site-builder.js` was removed — it would have re-hidden
everything and shown the home page's sections on every page. The interactive
builder half is untouched.

## 2. The enquiry form now reaches Claritai Desk

Four mismatches against Desk's public endpoint, each of which would have meant
enquiries arriving as email only, with no lead on the board:

- posted to `/api/leads`; Desk's endpoint is `/api/public/enquiry`
- sent no `elapsed` value; Desk treats a missing fill-time as a bot and refuses
- honeypot was named `website`; Desk reads `website_url`
- sent `selectedServices` as JSON; Desk wants readable `packageText`

All four fixed in `app.js` and `runtime-config.js`. Desk itself is unchanged.
`desk/test/site-enquiry.test.js` now pins this contract, so if either side
renames a field again a test fails instead of the leads quietly stopping.

## 3. Phone layout fix

The package builder scrolled sideways by 146px at 390px wide. The one-column
rule at 1050px was already correct, but a grid item's automatic minimum is its
content's min-content width, so the column still resolved to 518px inside a
354px shell. Fixed with `min-width: 0`, appended at the end of `styles.css` so
the original stylesheet is untouched.

## 4. Retired pages redirect instead of 404ing

Nine pages have no home in the new design. Each filename is kept as a small
stub that sends visitors to the closest equivalent, so no bookmark or search
result breaks:

| Old page                       | Goes to                |
|--------------------------------|------------------------|
| `about.html`                   | `index.html`           |
| `ai-consultancy.html`          | `index.html`           |
| `audit.html`                   | `index.html`           |
| `grow-digital-voucher.html`    | `index.html`           |
| `cargo-command.html`           | `index.html`           |
| `pricing.html`                 | `build-your-site.html` |
| `website-development.html`     | `build-your-site.html` |
| `seo-optimisation.html`        | `build-your-site.html` |
| `social-media-management.html` | `build-your-site.html` |

These are meta-refresh stubs, which work on any host with no configuration.
Render's dashboard redirects would be a truer 301, but Render skips a redirect
rule when a real file exists at that path — so if you add them there later,
delete the matching stub file first.

`privacy-policy.html` is NOT retired: the enquiry form's consent checkbox is
required and links to it. It is carried over in its old design.

## 5. Claritai Desk link kept in the footer

The current site links to Desk from its footer under "Products". That link is
carried over into the new footer, next to the privacy policy, with the same
`title="Staff login"`. Desk is behind Google sign-in restricted to claritai.ie,
so a public link is a convenience for the team rather than a way in.

## 6. The hero mock shows a real customer site

The handoff's hero showed an invented cafe called FABLE over a stock photo,
with fake nav, headline and button drawn on top. That is now a screenshot of
RM Cleary Tarmacadam's actual homepage, in the browser frame, with the address
bar reading `rmclearytarmacadam.ie`. The overlays are gone — a real screenshot
brings its own.

The browser card itself was resized to match. It had been shaped for a tall
photograph, so any landscape screenshot lost most of its width to the crop —
the headline was sliced in half. The card now takes its aspect ratio straight
from the screenshot and is wider on the stage, so their whole homepage fits
with nothing cropped and is legible at that size.

The caption under the stage changed from "Illustrative website & optional
extras" to "A real Claritai website. Extras shown are illustrative", since the
website panel is now real and only the dashboard and social panels are not.

`assets/cafe.webp` is removed; `assets/rmcleary-home.webp` replaces it. The old
`.cafe-*` CSS is left in the stylesheet, unused and harmless.

## 7. Cookie consent that actually works, and analytics back

The old site loaded Google Analytics unconditionally in the `<head>` of every
page, then showed a banner afterwards. Clicking Decline only hid the banner and
wrote a note to localStorage — GA had already fired and set its cookies. Under
the Irish ePrivacy Regulations consent has to come BEFORE anything non-essential
is stored, and a decline has to actually prevent it, so that banner was
decorative.

The designer's handoff had no analytics and no banner at all. Both are now back,
built the other way round:

- Google Analytics is not in the page. `consent.js` injects it, and only after
  Accept is clicked. Decline means nothing is ever requested from Google.
- Declining after previously accepting deletes the `_ga` cookies already set.
- The choice is kept in localStorage rather than a cookie, so someone who
  declines leaves with a genuinely clean browser.
- A "Cookie settings" link in the footer of every page reopens the choice.

Verified in a browser with all Google domains intercepted: 18 checks covering
first visit, decline, accept, reload, withdrawal and phone layout.

## 8. The privacy policy matches the site again

Rebuilt in the new design — same typeface, palette, header and footer — and its
wording corrected, because it described a site that no longer exists. Removed:
Formspree, HubSpot, the AI Business Audit, the Grow Digital Voucher check,
Google PageSpeed Insights and Azure OpenAI. Added: Claritai Desk as where
enquiries are stored, Resend as what emails the notification, Render as the
host, and an accurate description of how consent works.

It deliberately does not load `app.js` — a legal page has no package builder and
no enquiry dialog, and app.js expects both. The mobile menu is inlined instead.

## 9. Housekeeping

- `noindex, nofollow` removed — that was correct for review, not for launch.
- `sitemap.xml` rewritten for the five new pages plus the privacy policy.
- `robots.txt` added, pointing at the sitemap.
- Absolute `/assets/...` paths made relative so the site works from any root.

## Still open

- Three sections are in the HTML but not on any page: `#starter` (the €499
  starter package), the examples section, and `#dashboard`. They are in the
  designer's markup but absent from the page map, so they render nowhere. Left
  exactly as delivered rather than guessing where they belong.
- `privacy-policy.html` still wears the old design.
