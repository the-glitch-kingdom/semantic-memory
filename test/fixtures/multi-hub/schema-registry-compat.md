# Schema Registry Compatibility Rules

Tenants register event schemas, and the registry checks each new version against the previous one.

## Allowed changes

Adding an optional field and widening a number type are allowed. Removing a required field and changing a field's type are rejected. The registry's verdict is final for the tenant, but operators can grant a one-time exception with the schema lead's approval.

## Why rejection matters for ingest

An event that does not match the registered schema is dropped at the shaper when the field is unknown and fails shaping when a type is wrong. Tenants that skip the registry find out only when events arrive in the failure topic.

## Version retention

The registry keeps the last twenty versions per schema. Older versions are archived and cannot be registered again.
