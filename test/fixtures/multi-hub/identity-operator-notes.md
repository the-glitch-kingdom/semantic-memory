# Identity Operator Notes

What to know when the login service misbehaves, and the choices behind its defaults. The service is small but everything depends on it, so changes go slowly.

## Session lifetimes

A browser session lives twelve hours from login and is renewed on activity up to a hard cap of seven days. Idle sessions are removed by the reaper, which wakes every SESSION_IDLE_REAPER_SECONDS (default 300). Lowering the interval frees memory sooner and raises load on the session store, so do it only with a reason. A user who says they were logged out after lunch is usually hitting the twelve hour rule, not a bug.

## Token rotation

Access tokens last fifteen minutes and are refreshed with a rotating refresh token. Each refresh invalidates the previous token. If an old refresh token is presented a second time the whole token family is revoked, on the theory that it was stolen. This is the cause of most reports of a user being logged out on two devices at once.

## Single sign-on

Enterprise tenants connect their own identity provider. The service supports SAML and OpenID Connect. Onboarding is mostly certificate and attribute-mapping work and has its own guide. Until a tenant has tested a login end to end, keep password login enabled for its admins, or you will lock the customer out of their own onboarding.

## Lockout policy

Five failed password attempts within ten minutes lock the account for fifteen minutes. The lockout counter is per account and per source network, so one attacker cannot lock out a user from everywhere. Support can unlock from the console; unlocking does not reset the counter for the source network, which surprises people.

## Service accounts

Machine callers use service accounts with long-lived keys, which carry a mandatory owner and an expiry no more than a year away. A service account without an owner is reported weekly and disabled after thirty days. When an owner leaves, ownership moves to their team lead automatically.

## Break-glass access

There is a break-glass admin login for the case where the identity provider itself is down. Its use pages the security lead, is recorded verbatim in the audit trail and expires after two hours. Nobody should use it for convenience; the quarterly review reads every use aloud.

## Signing keys

Tokens are signed by a key ring of three keys: current, next and previous. The rotation ceremony has a guide of its own. Never remove the previous key before every token signed with it has expired, which takes at least as long as the longest session.

## Audit trail

Every login, logout, lockout, key change and role change is written to the audit trail with the actor, the target and the source address. The trail is append-only. Searching it by user is fast; searching by source address is slow and should be limited to a day.

## Common support questions

"I cannot log in from the new laptop" is nearly always the lockout counter or a skewed laptop clock invalidating the token. "My integration stopped" is nearly always an expired service account key. "I was logged out" is session lifetime or token family revocation.

## Password policy

Passwords must be at least twelve characters and are checked against a list of known breached passwords at the time they are set. There is no forced periodic change. A user whose password appears in a newly published breach list is asked to change it at the next login, not locked out; the prompt cannot be skipped for administrators.

## Multi-factor enrolment

Multi-factor is required for administrators and optional for everyone else unless the tenant enforces it. A user can enrol an authenticator app or a hardware key. Recovery codes are shown once at enrolment, ten of them, and each works once. Support cannot read recovery codes back and should not promise to; they can only reset the enrolment after an identity check.

## Role model

Roles are cumulative: viewer, editor, administrator, owner. A tenant must always have at least one owner and the service refuses to remove the last one. Role changes take effect at the next token refresh, which can be up to fifteen minutes; anyone who changes a role and sees no effect should wait a refresh before assuming a fault.

## Invitations

An invitation link is valid seven days and works once. Re-sending an invitation invalidates the earlier link. Invitations to an address that already has an account in another tenant create a membership, not a second account.

## Session store

Sessions live in a replicated key-value store with a three node quorum. Losing a single node is invisible; losing two makes logins fail closed, which is the intended behaviour. Existing tokens keep working until they expire, because token validation does not need the store.

## Rate limits on login

Login attempts are limited per source network to sixty a minute, over and above the per-account lockout. Corporate users behind one address can hit that on a Monday morning; support can raise the limit for a named network for a day.

## Offboarding

When a user is removed, active sessions are revoked immediately, service accounts they own are reassigned, and pending invitations they sent stay valid. The audit trail keeps their name for the legal retention period even after the account is deleted.

## Federation metadata refresh

SAML metadata from an identity provider is fetched again every day at 02:00 UTC. A provider that rotates its signing certificate without publishing the new one in advance will break logins for that tenant at the next refresh. The customer's identity team usually knows within the hour; our side is to confirm the fetch error in the log and ask them to republish the metadata.

## Clock skew

Token validation tolerates ninety seconds of clock skew between the service and a caller. A laptop or a build server that is further off than that sees every token as expired or not yet valid. Support's first question for a mysterious "invalid token" is the caller's clock.

## Deprecation notes

The legacy basic-authentication endpoint is on its way out. It still works for tenants that had it before the cutoff but is not offered to new tenants, and each request to it is logged with a deprecation header. Do not add features to it.

## Handover notes

Record any lockout exceptions, break-glass uses and pending key rotations in the handover thread. The next on-call must know whether a rotation is half finished before they touch the key ring.

## Security reviews

Every quarter the security lead reviews administrator counts per tenant, service accounts without owners, break-glass uses, and the longest-lived refresh tokens. Findings become tickets. Operators help by keeping the audit trail query saved in the team notebook so that the review always uses the same definitions.

## Testing changes

Never test a login change on a production tenant's admin. The staging environment has a copy of the identity provider configuration with fake users, and the changes that matter most, such as lockout or token lifetime, have a replay test that runs every night.

## Language and localisation

Login and error pages are localised in eleven languages; the fallback is English. A translation fix is a content change and rides the normal train. Do not edit error strings in the console to answer one customer, since the next deploy overwrites them.

## Mobile sessions

Mobile apps keep a longer session of thirty days with a device-bound refresh token. A lost phone can be revoked from the account page or by support; revocation takes effect at the next refresh, so combine it with a password change when the loss is serious.

## Capacity and latency

The login service targets a median of eighty milliseconds and a ninety-ninth percentile of four hundred. Most of the tail is the password hash, which is deliberately slow and runs on a dedicated pool. Do not tune the hash cost down to improve latency; add hash workers instead, and tell the security lead if the cost parameter ever needs to change.
