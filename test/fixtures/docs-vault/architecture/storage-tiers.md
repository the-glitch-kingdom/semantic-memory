---
title: Storage Tiers
tags: [architecture, storage]
domain: architecture
---

# Storage Tiers

Readings move through three tiers as they age.

- Hot (7 days): columnar tables on SSD, serves the live dashboard.
- Warm (90 days): compressed objects in bucket storage, queried on demand.
- Cold (7 years): archival storage, restored only on request.

After the hot window, raw readings are downsampled into 1-minute rollups before they move to warm.
Deletion and holds are governed by the [retention policy](../security/data-retention.md).
Data arrives through the [[ingest-pipeline]].
