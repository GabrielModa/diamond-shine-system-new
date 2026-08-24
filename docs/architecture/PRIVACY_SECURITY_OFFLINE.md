# Privacy, security, offline, and recurrence specification

## Threat priorities

- Cross-tenant data access through missing filters or guessed IDs.
- Privilege escalation through legacy role/UI-only checks.
- Refresh-token theft or reuse from a lost device.
- Evidence upload substitution, oversharing, or indefinite retention.
- GPS misuse, inaccurate disciplinary decisions, and unauthorized browsing.
- Offline replay, duplicate mutations, out-of-order transitions, and clock tampering.
- Recurrence duplication or destructive regeneration.
- Outbox duplication or side effects outside the originating transaction.

## Controls

- Capability/scope authorization inside services and route handlers.
- Tenant-aware database access helpers and integration tests.
- Short access tokens, rotating refresh family, device/session revocation, and reuse detection.
- Rate limits, schema/body-size validation, content-type allowlists, signed media access, and audit.
- Server time alongside client time; device clock drift is evidence, not trusted chronology.
- Idempotency and expected aggregate version for mobile mutations.
- Encryption in transit, provider-managed encryption at rest, secret rotation, backups, and restore drills.

## Location privacy

- Explicit onboarding explanation and just-in-time platform permission request.
- Event purpose and recording state visible to the employee.
- Worker can review their own location events and submit correction/dispute.
- Manager sees exception-oriented evidence only within scope; raw history access is separately audited.
- Retention is organization policy bounded by employment/legal requirements; default should be minimized and documented before production.
- Client reports never include employee coordinates.

## Offline protocol

1. Device downloads authorized visit packages with version and expiry.
2. Local mutations commit domain projection plus SyncCommand atomically.
3. Media intent and local reference are recorded before network upload.
4. Sync sends ordered commands with idempotency and dependencies.
5. Server authenticates current membership, validates scope/schema/version, persists command result, applies domain mutation, and writes audit/outbox.
6. Device applies authoritative result and advances acknowledgement cursor.
7. Retryable failures back off; permanent authorization/policy failures preserve local work for support/export.
8. Conflicts show facts and permitted resolution; critical data is never silently overwritten.

## Recurrence cases that require automated coverage

- Europe/Dublin DST spring-forward and fall-back.
- Monthly dates absent in shorter months.
- Holiday skip, move, and supervisor-confirm policies.
- Rule edited after some occurrences are completed.
- Cancellation of one occurrence versus future series.
- Assignment changes without regenerating visit identity.
- Concurrent generation/retry and duplicate suppression.
- Contract end shortened/extended and published-visit policy.

