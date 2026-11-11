# Cluster certificate rotation runbook

Everything the on-call needs to rotate the cluster certificates: how to rotate the cluster certificates before they expire, the order of the nodes, and the checks afterwards.

## How to rotate the cluster certificates

To rotate the cluster certificates, run the rotation job from the bastion host. Rotate the cluster certificates one control-plane node at a time, wait for the node to rejoin, then move to the next. Rotating the cluster certificates takes about twenty minutes per node, and the cluster certificates are valid for ninety days after each rotation.

## Node order

Start with the follower nodes and finish with the leader. Never rotate two nodes at once, because the cluster needs a quorum while the certificates change.

## Cost notes

The bastion host is billed by the hour. Shut it down after the rotation. Nothing else in this runbook costs anything.

## Holiday schedule

Rotations are not scheduled in the last week of December. If the certificates would expire in that week, rotate them early, in the first week of December.

## Contacts

The platform lead owns exceptions. The security team is told after every rotation.
