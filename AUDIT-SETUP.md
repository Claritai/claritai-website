# Claritai AI Business Audit — setup guide

This adds a free "AI Business Audit" lead-generation tool to the site. It has two parts:

- **Front-end:** `audit.html` (the page visitors use) — already wired into the nav, footer and homepage.
- **Back-end:** `audit-api/` — a small Node service that does the real crawl, the Azure OpenAI write-up and the HubSpot lead push. This must be deployed separately (it can't run on static hosting).

Right now the page works in **demo mode** (it shows a realistic sample report) so you can see and share it immediately. To make it run **live** audits, deploy the API and point the page at it — three steps below.

---

## What it does

A visitor enters their website + contact details. The API then:

1. Crawls their homepage for SEO / technical / social / content signals.
2. Runs **Google PageSpeed Insights** for real performance & SEO scores.
3. Scores five categories (SEO, Performance, Content, Online Presence, Social) + an overall A–F grade.
4. Uses **your Azure OpenAI** to write a plain-English summary, a SWOT and a prioritised action plan.
5. Pushes the lead into **HubSpot** (a contact + a timeline note with their score).

The visitor sees the full report on screen; you get the lead in HubSpot.

---

## Step 1 — Deploy the API on Render

1. Push this repo to GitHub (the API is in the `audit-api/` sub-folder).
2. In Render: **New + → Blueprint**, select the repo (it reads `audit-api/render.yaml`).
   *Or* create a **Web Service** manually with **Root directory** `audit-api`, **Build** `npm install`, **Start** `node index.js`.
3. Add these environment variables in the service's **Environment** tab:

   | Variable | What to put |
   |---|---|
   | `ALLOWED_ORIGIN` | `https://claritai.ie,https://www.claritai.ie` |
   | `PAGESPEED_API_KEY` | A free Google PageSpeed Insights key |
   | `AZURE_OPENAI_ENDPOINT` | e.g. `https://your-resource.openai.azure.com` |
   | `AZURE_OPENAI_KEY` | Your Azure OpenAI key |
   | `AZURE_OPENAI_DEPLOYMENT` | Your chat deployment name, e.g. `gpt-4o-mini` |
   | `HUBSPOT_TOKEN` | A HubSpot Private App token (see Step 2) |

   The API degrades gracefully — if you leave PageSpeed, Azure or HubSpot blank it still returns a valid report, just without that piece.

4. When it's live, copy the service URL, e.g. `https://claritai-audit-api.onrender.com`.

### Where to get the keys

- **PageSpeed API key:** Google Cloud Console → enable "PageSpeed Insights API" → create an API key. (Free.)
- **Azure OpenAI:** the same resource you use for Cargo Command — copy the endpoint, a key, and your chat model's deployment name.
- **HubSpot token:** see Step 2.

## Step 2 — HubSpot Private App

1. HubSpot → **Settings → Integrations → Private Apps → Create a private app**.
2. Under **Scopes**, tick: `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.objects.notes.write`.
3. Create it and copy the **access token** → that's your `HUBSPOT_TOKEN`.

Each completed audit creates/updates the contact (name, email, company, website, phone) and adds a timeline note with their audit score and summary.

## Step 3 — Point the page at the API

In `audit.html`, near the bottom, find:

```js
var AUDIT_API_URL = "";
```

Set it to your deployed endpoint (note the `/api/audit` path):

```js
var AUDIT_API_URL = "https://claritai-audit-api.onrender.com/api/audit";
```

Commit and deploy the site. The page automatically switches from demo mode to live audits as soon as this URL is set.

---

## Testing

- **Locally, no keys:** `cd audit-api && npm install && MOCK=1 npm start` returns a sample report.
- **Front-end demo:** open `audit.html` with `AUDIT_API_URL` blank — it shows the sample report after a simulated scan.
- **Live smoke test:** once deployed, `curl -X POST <url>/api/audit -H 'Content-Type: application/json' -d '{"url":"example.ie","email":"you@you.ie","name":"Test"}'`

## Notes & ideas for later

- **Costs:** PageSpeed is free; Azure OpenAI is a few cents per audit; HubSpot depends on your plan. The API rate-limits to 6 audits per IP per minute.
- **Don't commit secrets:** keep keys in Render's Environment tab, never in the repo. Exclude `audit-api/node_modules` and any `.env` from git.
- **Reputation/reviews:** a Google Business rating could be added later via the Google Places API (extra key) — the code is structured to slot it in.
- **Gating:** email is required before results show, so every completed audit is a captured lead.
