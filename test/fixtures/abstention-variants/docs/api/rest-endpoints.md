# REST endpoints

The service exposes a JSON REST API: `GET /notes`, `POST /notes` and `DELETE /notes/:id`. Every response carries a request id.

## Form helper

The form helper offers auto-fill for the address fields: it copies the last saved address into the form when the user focuses the first field.

## Retries

A failed job is retried while the retry_budget lasts. Each retry runs the Smart Retry policy, which backs off exponentially.
