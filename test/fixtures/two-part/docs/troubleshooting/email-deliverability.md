---
title: 'Troubleshooting: email deliverability'
tier: reference
domains:
  - troubleshooting
audience:
  - developers
  - devops
tags:
  - api
  - docker
  - authentication
  - oauth
status: complete
last_updated: 2026-08-02
version: 1.0.0
purpose: Symptom → cause → fix for anything email-related. Every entry here is a
  failure that has actually happened, not a hypothetical.
estimated_read_time: 7 minutes
word_count: 1335
last_validated: 2026-08-01
backlinks: []
sources:
  - workers/stg/deploy.sh
  - workers/prod/deploy.sh
  - workers/stg/docker-compose.yml
  - backend/app/services/email_service.py
  - backend/app/config.py
  - backend/app/tasks/email_reconciliation.py
  - backend/app/api/v1/webhooks.py
  - monitoring/alerts/alert-rules.yaml
  - backend/app/core/metrics.py
  - backend/scripts/digitalocean_prod/do-start.sh
  - auth/stg/docker-compose.yml
  - .documentation/observability/loki-droplet-logs.md
  - .documentation/devops/environments-and-deploy-operator-notes.md
  - .documentation/architecture/transactional-email.md
last_verified: '2026-11-09'
---

# Troubleshooting: email deliverability

Symptom → cause → fix for anything email-related. Every entry here is a failure that has
actually happened, not a hypothetical.

**The governing fact:** almost every failure in this system is *silent*. A log line
saying `Sent` means **accepted for delivery**, and a green deploy means the container
started. Neither is evidence a customer received anything. When diagnosing, prefer
evidence from **both** ends — the sink or the vendor log AND our own records.

---

## Quick triage

| Symptom | Jump to |
|---|---|
| Bounce-rate alert fired | [High bounce rate](#high-bounce-rate) |
| Sweep is finding bounces the webhook missed | [Webhook not delivering](#the-webhook-is-not-delivering) |
| Keycloak email fails, `535 Authentication Failed` | [Keycloak 535](#keycloak-535-authentication-failed) |
| Mail is in neither Mailpit nor ZeptoMail | [Mail in neither system](#the-mail-is-in-neither-system) |
| Staging is sending real email | [Staging sends real mail](#staging-is-sending-real-email) |
| A customer says they never got it, our log says sent | [Sent but never arrived](#log-says-sent-customer-says-no) |
| Deployed a fix, nothing changed | [Deploy shipped nothing](#the-deploy-reported-success-and-shipped-nothing) |
| `NoEmailSentRecently` fired | [No sends at all](#no-email-at-all) |

---

## High bounce rate

**Alert:** `EmailBounceRateHigh` (>5%) or `EmailBounceRateCritical` (>15%).

Sustained rates above 5% damage the reputation of the **sending domain**, which degrades
delivery to real paying customers — not just to whichever addresses are bouncing. Treat
it as a production issue even when every bouncing address is synthetic.

**1. Find out which environment is responsible.**

```promql
sum by (environment, bounce_type) (increase(email_bounce_total[6h]))
```

`environment` comes from the `client_reference` stamp. `unattributed` means the send
predates 2026-08-01 — not that it was production.

**2. Find out which addresses.**

```sql
SELECT email, bounce_type, reason, count(*), max(bounced_at)
FROM email_bounces
WHERE created_at > now() - interval '24 hours'
GROUP BY 1,2,3 ORDER BY 4 DESC;
```

**3. Decide from the shape of the list.**

| What you see | Cause | Fix |
|---|---|---|
| `@test.com` / `@example.com` addresses | A non-production environment is sending real mail | [Staging sends real mail](#staging-is-sending-real-email) |
| Real customer domains, `Mailbox not found` | Typos at signup, or churned accounts | Nothing urgent. Consider signup-time validation. |
| One domain, all at once | That receiver is blocking us | Check the `diagnostic_message` column for their stated reason |
| A sudden spike with no address pattern | Reputation problem already in progress | Escalate; check the ZeptoMail console bounce report |

⚠ **Do not clear the suppression list to "fix" the rate.** Re-sending to an address that
already hard-bounced is what turned a handful of dead addresses into 48 bounces — we sent
to `user@example.com` and `user@example.com` **six times each** after they
hard-bounced on the first attempt.

---

## The webhook is not delivering

**Alert:** `EmailBouncesOnlyFoundByReconciliation`.

This does **not** mean bounces increased. It means the real-time path stopped working and
the nightly backstop is now the only thing finding them — so deliverability data is up to
24 hours stale.

**Confirm:**

```sql
SELECT detected_via, count(*) FROM email_bounces
WHERE created_at > now() - interval '48 hours' GROUP BY 1;
```

Healthy looks like `webhook` dominating. `reconciliation` alone is the fault.

**Then work down this list:**

1. **Is the route alive?** An empty POST should return **401** (signature missing), not
   404. A 404 means the route moved or the deploy did not land.
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST \
     https://api.acme.example/api/v1/webhooks/zeptomail -d '{}'
   ```
2. **Does the secret match?** `ZEPTOMAIL_WEBHOOK_SECRET` in Vault must equal the
   **key value** of the Authorization header configured on the webhook in the ZeptoMail
   console (header name `X-Acme-Webhook-Token`). A mismatch produces a 401 on
   every event, and the only place that shows up is the console's delivery attempts.

   ⚠ **There is no HMAC.** ZeptoMail's console cannot produce one — the Add-webhook form
   offers only a static Authorization header. If you are looking for an "Authentication
   Key" field to compare against, it does not exist. → [architecture](../architecture/transactional-email.md)

   The prod log distinguishes the failure modes precisely:

   | Log line | Meaning |
   |---|---|
   | `carried neither producer-signature nor X-Acme-Webhook-Token` | the console webhook has no Authorization header configured |
   | `Invalid ZeptoMail webhook token in ...` | header present, value does not match Vault |
   | `Invalid ZeptoMail webhook signature` | an HMAC was sent and failed (unexpected — investigate) |
3. **Check the console.** ZeptoMail → Agents → the agent → Webhooks → delivery attempts.
4. **Is the secret set at all?** Unset means the endpoint denies **everything** by
   design. Check the backend logs for `ZEPTOMAIL_WEBHOOK_SECRET is unset`.

**Meanwhile you are not losing data** — the sweep is catching them. This is a degraded
state, not an outage.

---

## Keycloak `535 Authentication Failed`

```
org.keycloak.email.EmailException: Password based SMTP connect failed
Caused by: jakarta.mail.AuthenticationFailedException: 535 Authentication Failed
  at LoginActionsService.resetCredentialsPOST
```

**Cause:** the realm's SMTP credentials resolve **empty** — typically because
`SMTP_USER` / `SMTP_PASSWORD` were deleted from Vault while the realm still points at
`smtp.zeptomail.com:2525`.

**Why it is confusing:** the failure happens *before any message is accepted*, so the
mail appears in **neither** Mailpit **nor** ZeptoMail's log. It looks like the send never
happened at all.

**Fix — point the realm at the sink and turn auth OFF:**

```
host 10.0.0.3 · port 1025 · auth OFF · starttls OFF · ssl OFF
```

`auth OFF` is load-bearing. Mailpit accepts any credentials, but an **empty** AUTH
exchange is not the same as **no** AUTH, and it 535s too.

Verify with Realm Settings → Email → **Test connection**, not by triggering another
password reset.

**Diagnosing without droplet access:** query `{container="keycloak-staging"}` in Loki — the
full stack trace is there. Confirm it is *new* rather than longstanding by counting
occurrences over 7 days.

---

## The mail is in neither system

Not in Mailpit, not in ZeptoMail's log. The send failed before anything accepted it.

| Check | Command |
|---|---|
| Keycloak SMTP auth | see [Keycloak 535](#keycloak-535-authentication-failed) |
| Is Mailpit even running? | `docker ps \| grep mailpit` on the workers droplet |
| Is it listening where you think? | `ss -lntp \| grep -E '1025\|8025'` → expect `10.0.0.3:1025` and `127.0.0.1:8025` |
| Backend transport resolution | look for `transport:` in the startup logs — it is **lazy**, firing on first send, not boot |

---

## Staging is sending real email

**Cause, in almost every case:** `EMAIL_TRANSPORT` is unset, so it defaults to `auto` —
and **`auto` only prefers SMTP when `app_env == "development"`**. On staging it falls
through to ZeptoMail regardless of every `SMTP_*` value.

**⚠ Setting it in Vault does nothing.** `EMAIL_TRANSPORT` is a plain pydantic setting,
absent from `config.py`'s `_SECRETS` mapping.

| Where | How |
|---|---|
| Backend | App Platform environment variable → `EMAIL_TRANSPORT=smtp` |
| Workers | `workers/stg/docker-compose.yml` — **all three** celery services |

**⚠ Do not write empty `SMTP_USER`/`SMTP_PASSWORD` to Vault — DELETE the keys.**
`config.py` reads `_from_vault(v) or os.getenv(v)`; an empty value is falsy and falls
through to the App Platform env, which still held retired **Brevo** credentials. Writing
empty would have resurrected them.

**Verify from both ends.** The message must exist in the sink *and* not exist at the
vendor:

```bash
ssh -L 8025:127.0.0.1:8025 root@workers-staging-1   # then http://localhost:8025
```

Then confirm ZeptoMail's most recent send timestamp is **unchanged** from before your
test. One direction alone proves nothing.

---

## Log says "sent", customer says no

This is the failure the whole system was built for. `Sent`/`accepted` means ZeptoMail
queued it, and nothing more.

**1. Check our own record first:**

```sql
SELECT * FROM email_bounces WHERE email = lower('customer@example.com')
ORDER BY created_at DESC;

SELECT email, email_deliverable, email_bounced_at FROM users
WHERE lower(email) = lower('customer@example.com');
```

**2. If we have nothing, ask the vendor:**

```bash
TOK=$(curl -s -X POST https://accounts.zoho.com/oauth/v2/token \
  -d refresh_token="$ZOHO_REFRESH_TOKEN" -d client_id="$ZOHO_API_CLIENT_ID" \
  -d client_secret="$ZOHO_API_CLIENT_SECRET" -d grant_type=refresh_token | jq -r .access_token)

curl -s -H "Authorization: Zoho-oauthtoken $TOK" \
  "https://api.zeptomail.com/v1.1/email?to=customer@example.com"
```

⚠ `ZEPTOMAIL_TOKEN` will **not** work here — it is send-only and 401s on GET. This needs
the **Zoho OAuth** token with `Zeptomail.email.READ`.
⚠ A **trailing slash 404s** (`/v1.1/email/?…`), which reads like the endpoint does not
exist when it does.
⚠ `to` is optional and `?offset=N` paginates (20/page), so you can sweep the whole log.

**3. If the vendor also shows a clean delivery**, the message reached their mail server
and the problem is on their side — spam folder, a rule, or a silently discarding
receiver. Check `diagnostic_message` on any related bounce for the receiver's own words.

**4. Consider suppression.** If the address is on ZeptoMail's suppression list, sends
stop with no error visible to us. Reading that list needs a scope we do not yet have
(**#1214**) — check the console manually.

---

## The deploy reported success and shipped nothing

`workers/{stg,prod}/deploy.sh` builds the image from **whatever is on disk**. Since GH #1239
it syncs the checkout itself (`git fetch origin main` then `git merge --ff-only origin/main`) and
exits with an error if the droplet checkout has diverged. `SKIP_PULL=1` deploys the checkout
as-is, which reintroduces the old trap: a clean, healthy-looking deploy that ships none of your
changes, with a green log identical either way.

```bash
./deploy.sh                 # pulls first; do not set SKIP_PULL=1 unless you mean it
git log --oneline -1        # confirm the code actually landed
```

Never `docker compose down` on a droplet — it removes the tailscale container and drops
your SSH session.

**Three deploy targets, and missing one fails silently:** backend (App Platform), the
workers droplet (where async email actually runs), and the Keycloak image (only for
theme/SPI changes). A backend-only deploy does **not** update the workers.

---

## No email at all

**Alert:** `NoEmailSentRecently` — zero send attempts in 6 hours.

This exists because the bounce-rate alerts structurally **cannot** see it: with no sends,
numerator and denominator are both zero and every ratio reads healthy. A silent email
system looks exactly like a working one.

| Check | Meaning |
|---|---|
| Is traffic genuinely zero? | Overnight in a low-traffic environment this may be real |
| `celery inspect ping` on the workers droplet | Async sends run there, not on App Platform |
| Backend logs for `No email transport configured` | `EMAIL_TRANSPORT` resolved to `none` |
| `ZEPTOMAIL_TOKEN` present in Vault | It is in `REQUIRED_VARS`, so absence blocks container start |

---

## Related

- [Transactional email architecture](../architecture/transactional-email.md)
- [Email deliverability and bounce handling](../features/notifications/email-deliverability.md)
- `monitoring/alerts/alert-rules.yaml` → `acme.email.deliverability`
