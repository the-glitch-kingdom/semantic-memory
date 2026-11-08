---
title: Pull request guards
type: guide
tags: [operational]
domain: operational
last_verified: {{ago:30}}
---

# Pull request guards

Every pull request runs a guard script before it can merge. The script rejects stray debug output, oversized files and missing licence headers.

The guards are defined in `scripts/ci/guards.sh`.
