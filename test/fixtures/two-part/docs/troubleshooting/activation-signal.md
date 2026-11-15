---
title: Troubleshooting Activation and Usage Signals
tier: guide
domains:
  - troubleshooting
audience:
  - developers
  - admin
tags:
  - zoho
  - revops
  - troubleshooting
  - activation
status: complete
last_updated: 2026-08-11
version: 1.0.0
purpose: '**Symptom to cause to the command that answers it, for product usage signals reaching Zoho and ZMA.**'
last_validated: 2026-08-11
backlinks: []
sources:
  - backend/app/celery_app.py
  - backend/app/tasks/usage_snapshot_tasks.py
  - backend/app/services/usage_snapshot.py
  - backend/app/services/activation.py
  - backend/app/services/zoho_lifecycle.py
  - backend/app/services/zoho_lead_mapper.py
  - backend/app/services/team_status.py
  - backend/app/services/market_watch_status.py
  - backend/app/services/stripe_service.py
  - backend/app/routers/scoring.py
  - backend/app/models/organization_invitation.py
  - backend/app/models/scan_config.py
  - backend/scripts/check_lifecycle_vocabulary.py
  - backend/tests/unit/test_zoho_push_chokepoint.py
  - workers/prod/docker-compose.yml
  - backend/app/services/zoho_service.py
  - .claude/rules/operational-runbook.md
last_verified: '2026-11-10'
---

# Troubleshooting: activation and product usage signals

Symptom → what it means → the command that answers it. For how the surface works, see
[`revops/product-usage-signals.md`](../revops/product-usage-signals.md).

⚠ **Read the WORKER log, not the backend's.** `push_lead_to_zoho` runs on the workers
droplet, and App Platform's log API returns a non-deterministic slice that routinely
omits the window you need.

```bash
docker logs celery-worker-production --since 30m 2>&1 \
  | grep -iE "push_lead_to_zoho|refusing stage|activation"
```

---

## The field is empty in Zoho for an org that has clearly analyzed deals

**Most likely: the org predates 2026-08-11 and there was no backfill.** NULL
`activated_at` means "not activated" and, for older orgs, "we do not know when". This is
by design — see the no-backfill section in the feature doc. Such an org will jump
straight to `Activated` the next time it scores a deal, never showing `Not Activated`.

Check the system of record first, not Zoho:

```sql
SELECT org_id, name, activated_at FROM organizations WHERE org_id = '<id>';
```

- `activated_at` set → we activated it; the problem is downstream (push or sync).
- `activated_at` NULL → we never did; the problem is upstream (the deal never scored).

```sql
SELECT deal_id, deal_score FROM deals WHERE org_id = '<id>';
```

⚠ **`deal_score = 0` is a real score, not "unscored".** Only `NULL` means never
analyzed. If you see zeros and no activation, that is a bug — the falsy-zero trap.

---

## The value is in the CRM but not in ZMA

The CRM→ZMA sync is event-driven and takes **minutes**, not seconds. It runs when a Lead
changes.

1. Confirm the field is **mapped**: ZMA → Settings → Integrations → Apps → Zoho CRM →
   the Leads sync → **FIELD MAPPING**. A field that exists in both systems but has no
   mapping row never moves.
2. Confirm the ZMA field exists at all:
   ```bash
   curl -s "https://marketingautomation.zoho.com/api/v1/lead/allfields?type=json" \
     -H "Authorization: Zoho-oauthtoken $T" | jq -r '..|objects|select(has("FIELD_NAME"))
     | select(.FIELD_NAME|test("CF")) | "\(.FIELD_NAME) | \(.DISPLAY_NAME)"'
   ```
   ⚠ The host is `marketingautomation.zoho.com`. `ma.zoho.com` is the **UI**.

⚠ **ZMA slot numbers are allocated per TYPE, not sequentially.** `Activation Status`
became `CONTACT_CF8` and `Activated Date` became `CONTACT_CF26`, created seconds apart.
Never derive a ZMA field name by incrementing the last one you saw.

---

## `Activated_Date` moved

**A second activation push happened.** It should be impossible: the write is
`UPDATE … WHERE activated_at IS NULL RETURNING`, so only one caller can win.

Look for `activated_at` having been cleared, or for a code path assigning it outside
`activation.record_deal_activation`. A moved date silently destroys time-to-activation
for that customer, which is the whole reason the field exists.

---

## `Plan_Tier` is stale after an upgrade or downgrade

The tier is resolved inside `zoho_lifecycle.advance_lifecycle_stage` from `org.tier`, so
it refreshes on **every** push from there — the three billing webhooks, activation, team
status, Market Watch. If it is stale, one of these is true:

1. **No push has happened since the tier changed.** The commonest cause and not a bug:
   the value updates on the next lifecycle write, not at the instant of the tier change.
   There is deliberately no dedicated "tier changed" moment — the billing webhooks that
   change a tier are themselves push moments.
2. **`org.tier` itself is stale**, in which case the CRM is reporting the database
   correctly and the bug is upstream in billing.
3. **The push came from a path that does not go through `advance_lifecycle_stage`** —
   the two registration `push_lead` calls pass the tier explicitly. A third such path
   added without it would omit the key, and the mapper's falsy strip means Zoho keeps
   the old value. **The record looks fine.** That is the failure mode to suspect when
   one org is stale and others are not.

⚠ A tier that never changes when it should is **not** the downgrade guard. That guard
pops `lifecycle_stage` and nothing else — `Plan_Tier` is unguarded on purpose.

---

## `Team Active` never fired, though somebody joined

The status is recomputed from `organization_invitations`, so check the row first:

```sql
SELECT status, created_at, accepted_at FROM organization_invitations WHERE org_id = '<org>';
```

- **No row with `status = 'accepted'`** → the value is correct and the invitation flow is
  the thing to look at, not this signal.
- **An accepted row exists but Zoho says `Invited`** → the push after the accept commit
  did not happen or did not land. Check the worker log for that org's registrant email.

⚠ **Check WHICH Lead you are looking at.** The push targets the org's **registrant**, not
the person who just joined. If the new teammate has their own Lead carrying team fields,
something bypassed `advance_lifecycle_stage` and upserted on their email — that is a
second Lead for one company, and it will keep diverging.

---

## A Market Watch was deleted but the field still says `Configured`

`Market_Watch_Status` is a **live count of `enabled` scan configs**, recomputed on create
and on delete. So:

```sql
SELECT scan_config_id, enabled FROM scan_configs WHERE org_id = '<org>';
```

- **Another watch is still enabled** → `Configured` is correct. The field is "has at least
  one", not "has this one".
- **All disabled and Zoho still says `Configured`** → the push after the delete commit did
  not land. Worker log first.

⚠ `DELETE /api/v1/scoring/scan-configs/{id}` is a **soft** delete (`enabled = False`; the row stays,
because leads carry `scan_config_id`). A row still being present is therefore not evidence
the delete failed — read `enabled`, not the row count.

---

## A usage field is a day stale

**Correct.** `AI_Credit_Status`, `Engagement_Level` and `Last_Active_Date` are written by a
nightly job (04:15 UTC), not from a request path. "As of last night" is the freshness
contract for those three — and `Last_Active_Date` is a timestamp that is itself stale.

Everything else on the Lead is written within seconds of the action. Do not reason about
the two groups the same way.

---

## Everyone reads `Dormant`, or every usage field is blank

**Check the JOB, not the mapper.** A mapper problem would affect the event-driven fields
too; this pattern means the nightly task did not run or exited early.

```bash
# did it run at all?
docker logs celery-beat-production --since 24h 2>&1 | grep -i usage-snapshot
docker logs celery-worker-production --since 24h 2>&1 | grep -i "usage snapshot"
```

The task logs one summary line per run: `usage snapshot: N pushed, N unchanged, N failed`.

- **No line at all** → beat did not fire it. Check the beat container is up and that
  `push-usage-snapshots-nightly` is in `celery_app.conf.beat_schedule`.
- **`status: skipped, reason: kill_switch`** → `ZOHO_LIFECYCLE_ENABLED` is false in that
  environment. Read it off **PID 1**, not `docker exec printenv`.
- **A high `failed` count** → per-org errors are logged individually with the org id. One
  org failing does not stop the run, by design.

⚠ **Deploy the WORKER, not just the backend.** The task and the mapper both execute on the
workers droplet. A backend-only deploy leaves the old code running there with nothing
erroring — the field simply never appears.

---

## A usage value went BACKWARDS

**Correct, and do not add a downgrade guard.** All three periodic fields legitimately move
backwards, unlike everything the parent shipped:

- `AI_Credit_Status` resets to `Unused` at the start of each allowance period.
- `Engagement_Level` falls when someone's activity narrows or ages out of the 30-day
  window.
- `Last_Active_Date` is overwritten on every run — that is its purpose.

A guard here freezes the field forever. That is the rank-10 `Cancelled` trap in
`LIFECYCLE_RANK`, where nothing outranked it so a returning customer could never be written
again.

⚠ `Plan_Tier` and `Market_Watch_Status` are bidirectional too. Only the activation and team
fields are monotonic.

---

## `AI_Credit_Status` is blank for a customer

Check the tier first:

- **Bronze** → correct and permanent. Bronze has an allowance of 0, so a percentage is
  undefined and the field is omitted rather than computed. Blank means *not applicable*.
  Bronze is the trial state, so **most of the Trial User Journey population has this field
  blank by design**.
- **Any paying tier** → the field should be present. If it is not, the org has probably not
  been pushed since the field shipped; check the job's summary line.

---

## Nothing at all is reaching Zoho, from any moment

Check the switch before anything else:

```bash
docker exec celery-worker-production sh -c 'tr "\0" "\n" < /proc/1/environ | grep ZOHO_LIFECYCLE'
docker logs celery-worker-production --since 1h 2>&1 | grep "SKIPPED"
```

A `SKIPPED` line means it is **off on purpose**. No line and no Leads means it is broken.
That distinction is exactly what the log exists to provide.

⚠ `docker exec printenv` shows only `.Config.Env` and will report the compose default
while the process runs something else.

→ [`revops/zoho-kill-switch.md`](../revops/zoho-kill-switch.md)

---

## A whole Lead stopped updating, not just one field

**A Zoho upsert is all-or-nothing.** One bad `api_name` or one badly-shaped value loses
the **entire record**, not that field. Zoho reports rejections inside an HTTP 200 body, so
a 200 is not success (`backend/app/services/zoho_service.py` checks the row `status`). Suspect this whenever a push that used to work
stops after a field was added.

```bash
python backend/scripts/check_lifecycle_vocabulary.py     # 0 sync · 1 drift · 2 could not check
```

⚠ **Exit 2 is not exit 0.** "The picklists disagree" and "I never managed to look" are
different answers.

Common shapes:
- a `datetime` field sent a bare `.isoformat()` on a naive datetime → rejected. It needs
  an offset and no microseconds; `_zoho_datetime` is the only thing that should produce
  one.
- a picklist sent a **display label** instead of the stored value (Zoho renders
  "Closed Won", stores `Paid Subscriber Won`).

---

## A converted Lead lost its activation date on the Deal or Account

**Lead conversion copies custom fields, and same-named fields auto-map.** A field named
differently across modules is dropped, silently.

This was live for hours on 2026-08-11: Deals and Accounts carried `Activation_Date` (no
"d") while Leads and Contacts had `Activated_Date`. Corrected while both held zero rows.

```bash
python backend/scripts/check_lifecycle_vocabulary.py   # names this specific drift
```

⚠ `api_name` is **immutable**. The fix is a new field plus a retirement, never a rename
— and retiring does not delete: the option returns with `"type": "unused"` forever.

⚠ "The conversion rule is disabled" is not a fix. It is the luck that hid the last one.

---

## A teammate got their own Lead

**Zoho upserts on `Email`.** Pushing the acting user's address instead of the
registrant's creates a *second* Lead and splits one customer's funnel across two
records.

`zoho_lifecycle.advance_lifecycle_stage` resolves the registrant
(`is_primary DESC, created_at ASC`) precisely to prevent this. If you find a duplicate,
look for a push composed outside that function —
`tests/unit/test_zoho_push_chokepoint.py` is what should have caught it.

---

## Related

- [`revops/product-usage-signals.md`](../revops/product-usage-signals.md)
- [`revops/zoho-kill-switch.md`](../revops/zoho-kill-switch.md)
- [`revops/lifecycle-stage-vocabulary.md`](../revops/lifecycle-stage-vocabulary.md)
