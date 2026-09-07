# Deploying Claritai Desk

One-off setup, about 20 minutes. Three parts: Google credentials, the Render
services, and the DNS record.

---

## 1. Google sign-in credentials

Done once, in the Google account that owns the claritai.ie Workspace.

1. Go to **console.cloud.google.com** and create a project (or pick an existing
   one) — name it something like `Claritai Desk`.
2. Open **Google Auth Platform → Branding** (older consoles call this the
   *OAuth consent screen*) and fill in:
   - App name: `Claritai Desk`
   - Support email: your @claritai.ie address
   - Authorised domain: `claritai.ie`
3. On **Audience**, set the user type to **Internal**.
   This is the setting that matters: Internal means only accounts inside the
   Claritai Workspace can grant access at all. No verification review needed.
4. Open **Google Auth Platform → Clients** and click **Create client**:
   - Application type: **Web application**
   - Name: `Claritai Desk web`
   - **Authorised redirect URI**: `https://desk.claritai.ie/auth/callback`
     (exactly that — a mismatch gives a `redirect_uri_mismatch` error)
   - If you also want to run it on your laptop, add
     `http://localhost:3000/auth/callback` as a second URI.
5. Copy the **Client ID** and **Client secret**. You'll paste them into Render
   in the next step. Treat the secret like a password.

### How the domain lock actually works

Three things, and only the third is load-bearing:

- **Internal** user type — Google refuses non-Claritai accounts outright.
- The `hd=claritai.ie` parameter — a hint so the account chooser shows the right
  accounts. Convenience, not security.
- **The server check** — on every sign-in the app verifies the token came from
  our client, that the email is verified, that the hosted domain is
  `claritai.ie`, and that the address ends in `@claritai.ie`. A request that
  fails any of these is rejected. This runs on the server, so nothing the
  browser sends can bypass it.

---

## 2. Render

The blueprint at `desk/render.yaml` creates all three pieces: the web service,
the Postgres database, and the hourly cron job.

1. In Render: **New + → Blueprint**, connect `Claritai/claritai-website`, and
   set **Blueprint Path** to `desk/render.yaml`. Render looks in the repo root by
   default, so this field is not optional here.
2. When prompted, set the two secret values (everything else is filled in
   automatically, including `SESSION_SECRET`, which Render generates):
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   Leave `BASE_URL` unset for now — the app then works on whatever hostname it
   is reached on, so you can test on the `.onrender.com` URL before DNS exists.
3. Deploy. The database schema is created on first boot — nothing to run by hand.

**What it costs:** roughly $13/month — $7 web service, $6 Postgres, and a few
cents for the cron job. Flat, however many staff use it.

> Don't use Render's free tiers here: free Postgres databases are deleted 30
> days after creation, and free web services sleep after 15 minutes idle.

---

## 3. DNS

Add a CNAME for `desk` pointing at the Render service's hostname (Render shows
it under **Settings → Custom Domains** once the service exists):

    desk.claritai.ie.   CNAME   claritai-desk.onrender.com.

In Render, open the `claritai-desk` service → **Settings → Custom Domains →
Add Custom Domain**, enter `desk.claritai.ie`, then click **Verify** once the
DNS record is in. TLS is issued automatically — usually a few minutes.

Then add the environment variable `BASE_URL = https://desk.claritai.ie` to the
service, which pins sign-in redirects to your own domain.

---

## 4. Check it works

- `https://desk.claritai.ie/health` → `{"ok":true,...}`
- `https://desk.claritai.ie` → bounces to the sign-in screen
- Sign in with your @claritai.ie account → the Desk opens
- Try a personal Gmail → refused, with "That account isn't on the Claritai
  domain"

Then add a site in **Live sites** and wait for the top of the hour. Check the
cron job's log in Render: it prints a line per site with the status code and
response time.

---

## Running it day to day

**Adding someone.** Nothing to do here — anyone with a @claritai.ie Google
account can sign in, and they appear in the owner dropdowns once they have.

**Removing someone.** Remove or suspend their Claritai Google account. Their
Desk access goes with it. Their existing session lasts at most 14 days; to cut
it off immediately, change `SESSION_SECRET` in Render, which signs everyone out.

**Pausing checks on a site.** Open the site in Live sites and untick
"Fetch this site every hour", or set its status to Paused.

**Exporting the pipeline.** The Export CSV button on the Pipeline tab.

**Backups.** Render backs the database up automatically on paid plans; you can
also trigger a manual backup from the database's page in Render.

---

## Local development

    cd desk
    npm install
    cp .env.example .env    # fill in DATABASE_URL, SESSION_SECRET, Google creds
    npm start               # http://localhost:3000

`npm test` runs the smoke tests against a stubbed database — no Postgres and no
Google credentials needed. It covers the auth gate (including forged and expired
session cookies) and the monitor's classification logic.

Run the site check by hand with `npm run check-sites`.
