# Single Sign-On Onboarding with SAML

A checklist for connecting a customer's identity provider using SAML.

## Exchange of metadata

Ask the customer for their metadata URL, not a pasted file, so that certificate renewals are picked up by the daily refresh. Give them our assertion consumer address and our entity identifier from the tenant settings page.

## Attribute mapping

The service needs three attributes: a stable user identifier, an email address and a display name. The group attribute is optional and, if present, maps to roles through a table the tenant owner edits. The default group attribute name expected is memberOf-groups, and customers whose provider uses another name must tell us.

## Test before enforcing

Test with one administrator in a private window while password login is still enabled. Only after a successful login should the tenant owner enforce single sign-on for everyone. Enforcing first and testing later is the most common reason for a customer locking themselves out.

## Just-in-time accounts

First login by an unknown user creates a viewer account when just-in-time provisioning is on. It is off by default because it surprises tenants who expected an invitation to be required.
