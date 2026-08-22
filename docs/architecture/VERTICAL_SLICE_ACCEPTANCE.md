# First vertical slice acceptance specification

Scenario: a supervisor configures one site and service plan, schedules one visit, a worker executes it offline with one low-stock signal, and a supervisor approves the synchronized evidence.

## Setup

- Legacy organization exists with administrator, supervisor, and employee memberships.
- Client and site belong to that organization.
- Site has address, coordinates, access instructions, two areas, and geofence policy.
- Published service plan version contains critical and normal tasks plus consumable rule.

## Management path

- Administrator creates client, contract, site, areas, and service plan draft.
- Publishing creates immutable ServicePlanVersion.
- Recurring job generates exactly one expected visit for the test window and remains idempotent on retry.
- Supervisor assigns employee and publishes schedule.
- Employee receives authorized assignment and acknowledges the current schedule version.

## Mobile/offline path

- Employee downloads the visit package and loses connectivity.
- Employee opens critical access instructions, starts visit, and receives a location classification or explicit unavailable state.
- Employee completes one area normally.
- In the second area, employee marks soap `Low`; the configured conditional flow captures optional count/evidence and creates a local SupplySignal command.
- Employee completes the security close-down task and submits visit.
- Local timeline and progress survive app restart before reconnecting.

## Synchronization

- Reconnect sends each command once logically even if transport retries.
- Server preserves device order, returns authoritative versions, creates exactly one SupplySignal, audit events, and outbox notifications.
- Duplicate command replay returns original result.
- A forced version conflict preserves both sides and produces a resolvable conflict state.

## Review

- Manager Command Center shows visit awaiting review and one supply item with site impact.
- Evidence timeline explains assignment, acknowledgement, location, task outcomes, low-stock signal, completion, and sync timing.
- Supervisor approves visit; approval is immutable and separately releases configured downstream gates.
- Supply signal merges/converts into one owned request with source evidence and SLA.
- Employee cannot see prices, other employees' times, manager-only notes, or raw GPS beyond their own allowed history.

## Quality gates

- Tenant-isolation tests attempt foreign organization IDs on every endpoint.
- State-machine unit tests cover illegal transitions and optimistic conflicts.
- API contract tests cover validation, stable errors, idempotency, authorization, and audit.
- Mobile tests cover offline restart, retry, conflict, denied GPS/camera permission, and expired membership.
- Web E2E covers keyboard/accessibility basics, empty/loading/error states, and supervisor review.
- No critical event is represented only as free-text note.

