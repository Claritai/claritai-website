# Claritai AI Business Audit — API

Backend for the free "AI Business Audit" lead-generation tool on claritai.ie.

Given a website URL it:

1. **Crawls** the homepage for on-page SEO, technical and social signals (title, meta, headings, structured data, Open Graph, sitemap/robots, analytics, social links, HTTPS, mobile viewport, image alt coverage, …).
2. Runs **Google PageSpeed Insights** (mobile) for real performance / SEO / accessibility / best-practices scores.
3. Computes deterministic **0–100 scores** across five categories and an overall grade (A–F).
4. Asks **Azure OpenAI** to write a plain-English summary, per-category notes, a **SWOT**, and 5–7 prioritised **recommendations** tied to Claritai's services.
5. Pushes the **lead into HubSpot** (contact + timeline note).

Every external step degrades gracefully — if PageSpeed, Azure OpenAI or HubSpot is unavailable, the audit still returns a valid, useful report (using a built-in rule-based narrative for the text).

## Run locally

```bash
cd audit-api
npm install
cp .env.example .env      # fill in your keys (or leave blank to test the crawl + rule-based text)
MOCK=1 npm start          # returns a canned sample report — great for front-end work
# or
npm start                 # real pipeline
curl -X POST http://localhost:3000/api/audit \
  -H 'Content-Type: application/json' \
  -d '{"url":"example.ie","email":"you@you.ie","name":"Jane Doe","company":"Acme"}'
```

## Deploy on Render

1. Push this repo to GitHub (the API lives in the `audit-api/` sub-folder).
2. In Render: **New + → Blueprint** and select the repo (it reads `audit-api/render.yaml`), **or** create a **Web Service** manually with:
   - **Root directory:** `audit-api`
   - **Build command:** `npm install`
   - **Start command:** `node index.js`
   - **Health check path:** `/health`
3. Add the environment variables below in the service's **Environment** tab.
4. Copy the service URL (e.g. `https://claritai-audit-api.onrender.com`) and paste it into `audit.html` as `AUDIT_API_URL`.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `ALLOWED_ORIGIN` | recommended | Comma-separated origins allowed by CORS, e.g. `https://claritai.ie,https://www.claritai.ie`. Defaults to open. |
| `PAGESPEED_API_KEY` | optional | Google PageSpeed Insights key. Without it, performance/SEO scores are derived from the crawl only. |
| `AZURE_OPENAI_ENDPOINT` | optional | e.g. `https://your-resource.openai.azure.com`. |
| `AZURE_OPENAI_KEY` | optional | Azure OpenAI API key. |
| `AZURE_OPENAI_DEPLOYMENT` | optional | Your chat deployment name, e.g. `gpt-4o-mini`. |
| `AZURE_OPENAI_API_VERSION` | optional | Defaults to `2024-06-01`. |
| `HUBSPOT_TOKEN` | optional | HubSpot **Private App** token. Scopes: `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.objects.notes.write`. |
| `RATE_LIMIT` | optional | Requests per IP per minute (default `6`). |
| `MOCK` | optional | `1` returns a canned sample report without calling anything external. |

Without the optional keys the audit still works — you just get crawl-based scores and rule-based text, no live PageSpeed data, no AI narrative, and no HubSpot push. Add the keys to switch each capability on.

## Endpoint

`POST /api/audit` → JSON body `{ url, email, name?, company?, phone?, industry?, consent? }`
Returns `{ ok, url, overall:{score,grade,label}, categories[], swot{}, recommendations[], summary, meta }`.

`GET /health` → `{ ok: true }`
