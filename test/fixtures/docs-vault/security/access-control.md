---
title: Access Control
tags: [security, access]
domain: security
---

# Access Control

Staff sign in through single sign-on using OIDC. Three roles exist:

- deckhand: read-only dashboards
- engineer: dashboards plus rule editing and replay
- harbormaster: full administration, including user management

Service credentials are scoped per integration and must be refreshed on schedule, see
[rotating api keys](../operational/rotating-api-keys.md).
