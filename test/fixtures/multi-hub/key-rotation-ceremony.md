# Signing Key Rotation Ceremony

The steps for replacing the token signing key. Two people take part: the operator and a witness from security.

## Preparation

Announce the rotation in the handover thread the day before. Confirm the ring currently holds the current, next and previous keys and that no earlier rotation is half finished.

## The rotation

Promote the next key to current, generate a new next key, and demote the old current key to previous. The service begins signing with the promoted key after the ring is published, which takes up to one minute across the fleet.

## Retiring the old key

The key that was previous before the rotation is deleted only after 36 hours, longer than any session. The witness records the deletion time in the audit trail and signs the entry.
