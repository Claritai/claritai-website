# Claritai Desk

The internal CRM: pipeline, to-dos, meetings, live site health and social accounts.
Runs at https://desk.claritai.ie — staff sign in with their @claritai.ie Google account.

    desk/
      index.js              Express app: sign-in, API, serves the UI
      lib/db.js             Postgres access (one table per record type)
      lib/auth.js           Google OAuth + signed session cookies
      views/app.html        The Desk itself (single file, no build step)
      public/login.html     Sign-in screen
      cron/check-sites.js   Hourly uptime + SSL check
      test/                 Smoke tests — `npm test`

## Running it locally

    npm install
    cp .env.example .env      # fill in the values
    npm start                 # http://localhost:3000

`npm test` runs against a stubbed database, so it needs no Postgres and no
Google credentials.

## Deploying

See DEPLOY.md. Setup is a one-off: create the Google OAuth credentials, deploy
the Render blueprint, point the DNS record at it.
