# Release Operator Notes

Practical notes for the release captain. The process is deliberately dull: small releases, often, with an easy way back. These notes explain why each rule exists, so you know which ones can bend.

## Release train cadence

A release train leaves every Tuesday and Thursday at 14:00 UTC. Anything merged before 12:00 UTC on the day rides the train; anything later waits for the next one. The captain for the week owns the train from the cut until the canary passes, and hands over by name in the release thread. Nobody ships on a Friday afternoon without the captain's explicit agreement, because a Friday rollback is a weekend page.

## Canary stage

Every release goes to the canary first: two percent of traffic in a single zone. The canary holds for the number of minutes in the environment variable CANARY_HOLD_MINUTES, which is 30 by default and may be raised, never lowered, for a risky change. The promotion check compares error rate, latency and saturation against the previous release on the same zone; any one of the three worse than its threshold stops the promotion and pages the captain. The thresholds have their own guide.

## Feature flags

New behaviour ships dark behind a flag and is turned on separately from the deploy. A flag has an owner, a creation date and an expected removal date, and the weekly hygiene report lists flags that are past due. Do not reuse a flag name for a different purpose, even after the old flag was deleted, because cached clients may still hold the old value.

## Rollback

Rollback is a first-class action, not an admission of failure. The captain can roll back without asking anyone if the canary or the first promotion step looks wrong. A rollback redeploys the previous artifact and does not undo database changes, which is why migrations are written to be compatible with the previous release. After a rollback, write the reason in the release thread before doing anything else.

## Freeze windows

Releases are frozen during the last three business days of a quarter, the week of the annual conference, and any incident of severity two or above. A freeze lifts only when the freeze owner says so in the release thread. A hotfix during a freeze needs the captain and the engineering director to agree, in writing.

## Hotfix path

A hotfix skips the train but not the canary. Branch from the production tag, apply the minimal fix, run the full fast test suite and the canary, then promote. Afterwards the fix must be merged back to the main branch the same day; a hotfix that exists only on a branch is a time bomb for the next train.

## Database migrations

Migrations run before the new code is deployed and must be safe for the old code as well. Adding a column is fine; renaming or dropping one takes three releases: add the new, move readers and writers, drop the old. A migration that locks a large table for more than five seconds needs the storage team's review and a scheduled window.

## Artifact signing

Every artifact is signed in the build pipeline and the deploy step verifies the signature before it unpacks anything. A signature failure is never a flake: stop, do not retry the deploy, and tell the security lead. The signing key is held by the pipeline, not by any person.

## Release notes

The release notes are generated from merge titles, so a vague merge title becomes a vague note. The captain edits the notes before the train leaves; support reads them for customer-facing changes and the sales team reads them for new capabilities.

## Post-release checks

After promotion to every zone, the captain watches the dashboards for thirty minutes and then posts the all-clear. Late regressions are usually saturation: a new code path that is cheap in the canary but expensive at full traffic. Compare the previous release's saturation curve at the same hour of the week, not the same hour of the day.

## Build reproducibility

Builds are reproducible: the same commit produces the same artifact digest. If two builds of one commit differ, treat it as a security incident, not a curiosity. The pinned base image is updated only through a reviewed change.

## Communication

Announce the cut, the canary result, the promotion and the all-clear in the release thread, each in one line. Customers read the status page, which is updated by support, not by the captain; but the captain tells support when the release contains something customer-visible so they can brief the front line.

## Status page etiquette

Support owns the public status page. The captain supplies one plain sentence about what changed and what customers might see. Avoid internal terms such as zone names or flag names; customers know the product, not our fleet.

## Release metrics

The team tracks four numbers per quarter: lead time from merge to production, the share of releases rolled back, the share of releases needing a hotfix within a day, and the minutes of canary hold. A rising rollback share is a signal that the canary thresholds are too loose; a rising hotfix share is a signal that the tests are too thin.

## Dependency updates

Dependency updates ride the normal train, one ecosystem at a time. A major version of a framework gets its own train with an extended canary hold, and never rides with a database migration. Security updates may jump the queue through the hotfix path when the advisory says it is exploited.

## Training new captains

A new captain shadows two trains, runs one under supervision and then takes a week alone. The supervising captain watches the first rollback decision, because a hesitant rollback is the most common way a small issue becomes an incident.

## Environment parity

Staging is deployed from the same artifact as production, with the same flags except where a flag is explicitly environment-scoped. A difference found between staging and production is a bug in the process, and the captain writes it down even if it did not matter this time.

## Handover between captains

The outgoing captain writes three things in the release thread: the state of every train in flight, any flag that is half rolled out, and any known weakness in the canary thresholds. The incoming captain replies with a one-line acknowledgement. A handover without the acknowledgement has not happened, and the outgoing captain stays on call until it does.

## Mobile and desktop clients

Client releases do not follow the train. They go through the app stores, which means a bad client cannot be rolled back, only superseded. For that reason client features are always behind server-side flags, and the server must keep answering old clients for at least six months after a protocol change.

## Incident overlap

If an incident starts while a train is in flight, the captain pauses promotion and tells the incident commander what is deployed where. Promotion resumes only with the commander's agreement. Do not roll back as a reflex during an incident; first ask whether the release is plausibly involved, since a rollback changes the evidence.

## Documentation for releases

Customer-visible changes need a documentation update before the train leaves, written by the author of the change and checked by the captain. A change that alters an API response needs the reference page updated in the same pull request; the captain should refuse to cut a train that contains an undocumented API change.

## When to bend a rule

The cadence and the freeze can bend with the captain's agreement; the canary, the signature check and the rule that migrations are compatible with the previous release cannot. If you find yourself arguing that a safety rule does not apply this time, that is the moment to ask a second captain.

## Weekly review

On Wednesdays the captains review the previous week's trains: every rollback, every hotfix and every canary that held longer than expected. Each gets one line of cause and one line of change. Patterns across weeks become process changes, written up in the team notebook.
