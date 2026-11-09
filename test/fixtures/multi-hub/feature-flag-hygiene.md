# Feature Flag Hygiene

Flags are cheap to add and expensive to keep. This page describes the weekly clean-up.

## Weekly report

The hygiene report lists flags past their expected removal date, flags with no owner, and flags whose value has been identical in every environment for sixty days. The captain reads it on Mondays and assigns each stale flag to its owner.

## Removing a flag

Remove the flag in two steps: first delete the code that reads it, leaving the winning behaviour in place, then delete the flag definition in the next train. Doing both in one change risks clients holding the old definition.

## Naming

Flag names describe the behaviour, never the project: use new-invoice-layout, not q3-launch. Flags with a project name outlive the project and nobody remembers what they do.
