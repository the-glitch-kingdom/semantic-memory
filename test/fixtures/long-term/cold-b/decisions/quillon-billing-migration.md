---
title: Quillon billing migration
type: decision
---
# Quillon billing migration

We moved invoicing from the nightly Quillon batch to event-driven charges. Invoices are now issued the moment a usage event closes. The old batch ran at 02:00 UTC and was retired after two clean months of parallel running.

Rollback plan: replay the usage events into the batch importer.
