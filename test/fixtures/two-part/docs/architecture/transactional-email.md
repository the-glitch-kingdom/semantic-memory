---
title: Transactional email architecture
tier: reference
domains:
  - architecture
audience:
  - developers
  - devops
  - admin
tags:
  - api
  - docker
status: complete
last_updated: 2026-08-02
version: 1.0.0
purpose: '**What this is:** how Acme sends email, which transport
  serves which caller, and the three configuration traps that have each caused a
  real outage.'
estimated_read_time: 6 minutes
word_count: 1006
last_validated: 2026-08-01
backlinks: []
sources:
  - .documentation/architecture/transactional-email.md
  - .claude/rules/operational-runbook.md
last_verified: '2026-11-09'
---

# Transactional email architecture

**What this is:** how Acme sends email **through ZeptoMail**, which transport
serves which caller, and the three configuration traps that have each caused a real outage.

> ⚠ **This is not every sender.** Zoho Marketing Automation is a second, independent sender
> that reaches customers without touching ZeptoMail: different MTA, `admin@` rather than
> `noreply@`, absent from ZeptoMail's logs, and invisible to the bounce webhook and the
> nightly reconciliation sweep described below. It is configured entirely in the ZMA console,
> so **nothing in this repository references it and no grep will find it**.
> Inventory and traps: [ZMA journeys and lifecycle email](../revops/zma-journeys-and-lifecycle-email.md).
> This scoping note was added 2026-08-24 after GH #1419, where a customer-facing email with
> wrong dates was hunted through the backend for some time because this page reads as the
> complete answer.

This document did not exist until 2026-08-01. #823 replaced Brevo with ZeptoMail across
the backend, the workers and Keycloak on 2026-07-07 and produced no documentation at
all — the only written record lived in `.claude/rules/operational-runbook.md`, which is
an agent context file, not something a human is pointed at. The gap is why
`EMAIL_TRANSPORT` was never set in any deployed environment for three weeks, which is
what caused GH #1206.

---

## The shape

Two transports, **one ZeptoMail account**, and two entirely separate paths into it.

```
                                            ┌──────────────────────────┐
 backend (App Platform) ──┐                 │  ZeptoMail (one account) │
 celery workers (droplet) ─┼─► EmailService  ├──► API   :443  ──────────┤
                          │   .send_email    │                          │
                          │                  │                          │
 Keycloak (auth droplet) ─────────────────── ├──► SMTP  :2525 ──────────┤
   realm `smtpServer`                        └──────────────────────────┘
                                                        │
                                     bounce, minutes later, asynchronously
                                                        ▼
                                    POST /api/v1/webhooks/zeptomail  (GH #1206)
```

| Caller | Transport | Configured by |
|---|---|---|
| Backend + Celery workers | ZeptoMail **REST API** over HTTPS 443 | `ZEPTOMAIL_TOKEN` |
| Keycloak (verification, reset, OTP) | ZeptoMail **SMTP on port 2525** | realm `smtpServer` block |
| Dev, and staging since 2026-08-01 | **Mailpit** SMTP sink | `SMTP_HOST` + `EMAIL_TRANSPORT=smtp` |

**Port 2525 is not a preference.** DigitalOcean droplets block outbound 25, 465 and 587.
2525 is the only port open, and ZeptoMail happens to listen on it. Validated from the
droplet — do not "correct" it to 587.

---

## Where it lives

| Concern | File |
|---|---|
| **The chokepoint** — every send passes through here | `backend/app/services/email_service.py` → `EmailService.send_email` |
| Transport selection | same file → `_resolve_transport` |
| ZeptoMail API client | `backend/app/services/zeptomail_service.py` |
| Keycloak's SMTP config | `keycloak/realms/acme.yaml` → `smtpServer` |
| Async sends (welcome, trial, batch) | `backend/app/tasks/` — these run on the **workers droplet** |
| Bounce handling | [Email deliverability](../features/notifications/email-deliverability.md) |
| Bounce webhook auth | `backend/app/api/v1/webhooks.py` → `zeptomail_webhook` |

The single chokepoint is load-bearing: it is why the transport branch, the send metric
and the "accepted, not delivered" warning each exist in exactly one place.

### ⚠ The bounce webhook is authenticated by a STATIC HEADER, not an HMAC

Zoho documents an HMAC (`producer-signature`). **Their console cannot produce one.**
Verified 2026-08-02 against the live console: the Add-webhook form offers only a static
"Authorization headers" key/value pair, and its Verify request reached production with no
signature at all. The endpoint accepts an HMAC if one ever arrives, but the live
mechanism is:

```
X-Acme-Webhook-Token: <ZEPTOMAIL_WEBHOOK_SECRET>
```

That is a bearer credential, not a signature — replayable by whoever holds it. Rotating
it means updating **both** Vault and the console webhook's key value, then redeploying
the backends. Full rationale:
[Email deliverability → Security](../features/notifications/email-deliverability.md).

---

## Why the chokepoint matters more than it looks

`EmailService.send_email` logs on success. That log line says the message was
**accepted for delivery** — ZeptoMail returns 201 the moment it queues — and it is
routinely mistaken for proof of delivery. It is not. The rejection arrives
asynchronously, minutes later, at the bounce webhook.

For six months there was no listener, so:

> 48 of 72 sampled sends bounced (67%), and every single log line said success.

That is the origin of GH #1206 and the reason the log line now reads
`accepted by <transport> … — acceptance, NOT delivery`.

---

## ⚠ Trap 1: `EMAIL_TRANSPORT` defaults to `auto`, and `auto` only means SMTP in dev

```python
if settings.app_env == "development":
    if self.smtp_host:
        return "smtp"
```

Read that carefully. On **staging**, `app_env` is `staging`, so `auto` falls through to
ZeptoMail **no matter what every `SMTP_*` value says**. Setting `SMTP_HOST` to a Mailpit
sink and expecting staging to use it does nothing.

That is exactly what happened: staging sent real mail to seeded `@test.com` and
`@example.com` addresses that do not exist, and the resulting bounces landed on the
**production** sending domain's reputation — degrading delivery to real paying customers,
not to the dead test addresses.

**`EMAIL_TRANSPORT` is NOT in Vault.** It is a plain pydantic setting absent from
`config.py`'s `_SECRETS` mapping, so writing it to Vault does **nothing**. Set it:

| Where | How |
|---|---|
| Backend | App Platform environment variable |
| Workers | `workers/{stg,prod}/docker-compose.yml` — **all three** celery services |

Pinned by `backend/tests/unit/test_email_transport_resolution.py`.

---

## ⚠ Trap 2: an empty Vault value falls through to the environment

`config.py` resolves secrets as `_from_vault(v) or os.getenv(v)`. An empty string is
falsy, so **writing an empty value to Vault does not clear a setting** — it silently
falls back to whatever the App Platform environment holds.

Staging's App Platform env still held retired **Brevo** credentials. Writing an empty
`SMTP_USER` to Vault would have resurrected them.

**To clear a secret, DELETE the Vault key.** Then clear the stale value from the App
Platform spec too.

---

## ⚠ Trap 3: deleting the SMTP secrets breaks Keycloak, silently and in both directions

Keycloak reads `SMTP_USER` / `SMTP_PASSWORD` through `init-auth.sh`. Delete them from
Vault while the realm still points at `smtp.zeptomail.com:2525` and every Keycloak email
dies with:

```
org.keycloak.email.EmailException: Password based SMTP connect failed
Caused by: jakarta.mail.AuthenticationFailedException: 535 Authentication Failed
```

The failure happens **before any message is accepted**, so the mail appears in *neither*
Mailpit *nor* ZeptoMail's log. It looks like the send never happened.

**Fix:** point the realm at the sink *and turn auth OFF*.

```
host 10.0.0.3 · port 1025 · auth OFF · starttls OFF · ssl OFF
```

`auth OFF` is the load-bearing part. Mailpit accepts any credentials, but an **empty**
AUTH exchange is not the same as **no** AUTH, and it 535s too. Verify with Realm
Settings → Email → **Test connection**, not another password reset.

There is a fourth, related trap: a realm re-import **rewrites live SMTP from the
environment**, and `init-auth.sh` writing `SMTP_USER=` passes the preprocessor's
`REQUIRED_VARS` check (a *presence* test, not a non-empty test). A re-import can
therefore blank production's working credentials with no import error. Verify the Vault
values are non-empty before deploying a realm change.

---

## Environments

| | Transport | Recipient reality |
|---|---|---|
| **Dev** | Mailpit (`localhost:8025`) | Nothing leaves the machine |
| **Staging** | Mailpit sink on `workers-staging-1` | Nothing leaves the VPC (since 2026-08-01) |
| **Production** | ZeptoMail API + SMTP 2525 | Real customers |

Staging's sink runs as `mailpit-staging` on the workers droplet: SMTP on
**`10.0.0.3:1025`** (VPC, so both the App Platform backend and Keycloak on
`10.0.0.2` reach it) and the web UI on **`127.0.0.1:8025` — loopback only**.

⚠ **Never publish port 8025.** That inbox holds every verification link, password reset
link and billing email staging sends. Read it through a tunnel:

```bash
ssh -L 8025:127.0.0.1:8025 root@workers-staging-1   # then http://localhost:8025
```

The workers droplets have **no DigitalOcean firewall attached** (the only firewall,
`web-access`, covers the auth droplets only). The loopback binding is the sole
protection, not defence-in-depth.

---

## Deploying an email change

Three targets, and missing one fails **silently**:

1. **Backend** — App Platform (`doctl apps create-deployment <id>`)
2. **Workers droplet** — where async email actually runs. `git pull && ./deploy.sh`.
   The script rebuilds from whatever is already on disk, so **without the pull it
   reports a clean, healthy deploy and ships none of your changes.**
3. **Keycloak image** — only if the theme or an SPI changed; a realm re-import does not
   update a baked-in theme.

Never `docker compose down` on a droplet — it removes the tailscale container and drops
your SSH session.

---

## Related

- [ZMA journeys and lifecycle email](../revops/zma-journeys-and-lifecycle-email.md) — the second sender, which bypasses everything on this page
- [Email deliverability and bounce handling](../features/notifications/email-deliverability.md) — what happens after a send is accepted
- [Troubleshooting: email deliverability](../troubleshooting/email-deliverability.md) — symptom → fix
- [Email templates and configuration](../features/notifications/examples/email-config.md) — template inventory
- `.claude/rules/operational-runbook.md` — the operational half, auto-loaded for agents
