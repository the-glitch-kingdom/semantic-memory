---
title: Edge certificates
type: guide
tags: [operational]
domain: operational
last_verified: {{ago:30}}
---

# Edge certificates

## Issuing

Requests go through the internal CA portal and are approved by the network team.

## Rotating the edge certificate

Rotate the edge certificate 21 days before it expires. Run `certctl rotate --pool edge-a` and let it stage the new certificate on 10 percent of the nodes for 30 minutes.
If the handshake error rate stays under 0.2 percent, promote it to every node. Keep the previous certificate installed for 48 hours so that pinned clients can still connect.

## Troubleshooting

A handshake failure after rotation almost always means a missing intermediate certificate in the bundle.
