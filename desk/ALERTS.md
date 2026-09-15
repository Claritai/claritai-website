# Site alerts — setup

The hourly monitor has always found problems. This is the part that tells you.

Nothing here is required for Desk to run. Without `RESEND_API_KEY` the monitor
still checks every site and still records everything — it just writes
`RESEND_API_KEY is not set — skipping` to the log instead of sending.

---

## 1. Sign up for Resend

<https://resend.com> — the free tier covers this comfortably; we send a handful
of emails a month, not thousands.

## 2. Verify claritai.ie

In Resend: **Domains → Add Domain → `claritai.ie`**.

Resend then shows three DNS records (an MX and two TXT — SPF and DKIM). Add each
one at **Blacknight**, in the same DNS manager where the `desk` CNAME went:

- Copy the **name/host** and **value** exactly as Resend gives them.
- If Blacknight already appends `.claritai.ie` to the host field, don't type it
  twice — `send` becomes `send.claritai.ie`, which is what you want.
- Verification usually lands within a few minutes; Blacknight can take up to an
  hour.

**Watch which domain Resend actually verifies.** If it sets you up on a
subdomain like `send.claritai.ie`, then the from-address has to live there too —
see step 4.

## 3. Create an API key

**API Keys → Create** — sending permission is enough. Copy it now; Resend won't
show it again.

## 4. Put it into Render

Render → **claritai-desk-site-check** (the cron job, not the web service) →
**Environment**:

| Key | Value |
| --- | --- |
| `RESEND_API_KEY` | the key from step 3 |
| `ALERT_FROM` | `Claritai Desk <desk@claritai.ie>` |
| `BASE_URL` | `https://desk.claritai.ie` |
| `ALERT_EMAILS` | *optional* — see below |

`ALERT_FROM` **must** be on the domain Resend verified. If it verified
`send.claritai.ie`, use `Claritai Desk <desk@send.claritai.ie>` or Resend
rejects the send. The address doesn't need to be a real mailbox.

`ALERT_EMAILS` is optional. Leave it unset and alerts go to everyone who has
signed in to Desk, which keeps itself right as the team changes. Set it
(comma-separated) only if you want to override that — to add an address that
has no Desk account, say, or to send only to yourself while testing.

`ALERT_FROM` and `BASE_URL` are already in `render.yaml`, so a blueprint sync
fills them in. `RESEND_API_KEY` is marked `sync: false`, so Render will ask you
for it.

## 5. Prove it works

In Render, open the cron job → **Shell**, and run:

```
npm run test-alert
```

That sends one sample email — subject `DOWN: Test — this is not a real outage` —
and prints who it went to. It's the only way to check delivery without waiting
for a client site to actually break.

If nothing arrives, the log says why: no API key, no recipients, or the error
Resend gave back (an unverified from-address is the usual one).

---

## What actually gets sent

**Only on a change of state.** A site that has been down since Tuesday does not
generate an email every hour — that's how alerts get muted and then ignored.

| Situation | Email? |
| --- | --- |
| Site goes from fine → down | Yes |
| Site still down an hour later | No |
| Site comes back up | Yes |
| SSL drops under 14 days | Yes, once |
| Site is slow (over 5s) | Yes, once |
| A site the monitor has never checked before | No — recorded, not alerted |
| Every site fails at once | Yes, but as "monitoring is not running" |

That last one matters. If every check fails at the network level, the monitor
assumes the problem is itself rather than the whole client estate, writes
nothing, and tells you monitoring is down — because the dangerous failure is the
silent one where nobody is watching and nobody knows it.

One email per run, however many sites changed. Three sites failing together is
one incident, not three.

New sites are deliberately quiet on first sight: the first check has no previous
state to compare against, so everything would look like news. It gets recorded,
appears in Desk, and alerts normally from the next check onward.
