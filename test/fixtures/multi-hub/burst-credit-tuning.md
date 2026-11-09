# Burst Credit Tuning

Burst credits let a tenant exceed its steady rate for a short time. This guide explains how to size them for a tenant that is being throttled during known spikes, such as a nightly batch job.

## How credits accrue

A tenant earns credits while it is below its steady limit, at a refill of 50 credits per second per tenant, up to a ceiling. Each event above the steady limit spends one credit. When the credits run out the tenant is throttled back to the steady limit.

## Sizing the ceiling

Estimate the size of the largest expected spike in events and the duration of the quiet period before it. The ceiling needs to cover the spike minus what the refill supplies during the spike. A ceiling that is too high lets one tenant crowd out others at the receiver, so never exceed one hundred times the steady limit without a capacity note.

## Checking the result

After changing a ceiling watch the throttled-rate panel for the tenant for two spikes. If throttling persists but the credits are not exhausted, the cause is somewhere else, usually a client that retries without backing off.
