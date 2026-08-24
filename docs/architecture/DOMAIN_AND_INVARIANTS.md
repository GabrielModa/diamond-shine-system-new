# Operations Core domain and invariants

## Bounded contexts

### Identity and tenancy

- **Organization** — tenant and legal/operating boundary.
- **Membership** — a user's relationship to an organization, role, status, locale, and default scope.
- **CapabilityGrant** — capability plus scope (`organization`, `region`, `contract`, `site`, `self`).

### Commercial cleaning model

- **Client** — customer account; may contain several contacts and contracts.
- **Contract** — commercial/service agreement spanning one or more sites.
- **Site** — physical operating location with coordinates, access, risk, equipment, and local policy.
- **Area** — hierarchical serviceable unit within a site.
- **ServicePlan** — reusable intent for work at a site/contract.
- **ServicePlanVersion** — immutable published version of areas, tasks, standards, staffing, expected duration, materials, and evidence rules.

### Planning and execution

- **Job** — one-off or recurring commitment based on a service plan version.
- **RecurrenceRule** — timezone-aware generation rule and exception policy.
- **Visit** — one scheduled execution occurrence.
- **VisitPlanSnapshot** — immutable execution requirements captured for a visit.
- **Assignment** — worker responsibility, acknowledgement, and substitution state.
- **AreaExecution** — actual outcome for one area during a visit.
- **TaskResponse** — typed response and evidence for one snapshotted task.
- **Evidence** — media, signature, measurement, note, QR/NFC, or location evidence with visibility and retention.

### Exceptions and follow-up

- **Incident** — structured operational problem with severity, owner, SLA, evidence, resolution, and rework.
- **SupplySignal** — field observation about a product/location that may merge into a replenishment need.
- **OperationalApproval** — independent review of service evidence.
- **CorrectiveAction/Rework** — requested correction preserving original history.

### Attendance and synchronization

- **TimeEntry** — categorized payable/non-payable interval with evidence and review state.
- **LocationEvent** — event-based coordinate, accuracy, source, distance classification, and retention metadata.
- **SyncCommand** — idempotent mobile mutation envelope with device ordering and conflict information.
- **DomainEvent/OutboxMessage** — durable transition notification for side effects.

## Aggregate boundaries

- Organization owns Membership and grants.
- Contract references Client and owns its site participation and policy overrides.
- Site owns Area hierarchy and site access/risk configuration.
- ServicePlan owns immutable ServicePlanVersion records after publication.
- Job owns recurrence intent but Visit is independently versioned and addressable.
- Visit owns VisitPlanSnapshot, Assignment participation, AreaExecution, TaskResponse, completion attempts, and approval references.
- Incident and SupplySignal are independent aggregates linked to their originating visit/task so they can outlive visit execution.
- TimeEntry is independently reviewable and linked to a visit/activity when applicable.

## Required identifiers and metadata

Every tenant-owned aggregate has:

- globally unique `id`;
- non-null `organizationId`;
- `createdAt`, `updatedAt`, and creator/updater identity where meaningful;
- optimistic `version` for mutable workflow aggregates;
- archival fields instead of destructive deletion after operational use;
- stable audit target type/id;
- optional external/import identifiers with organization-scoped uniqueness.

## Core invariants

1. Server-side authorization scopes every tenant-owned read and write.
2. Cross-organization references are rejected in domain/service code and protected by integration tests.
3. A published ServicePlanVersion is immutable.
4. A generated Visit stores a VisitPlanSnapshot; history never depends on the current template.
5. A visit cannot be `approved` before it is `submitted` or `completed` according to policy.
6. Completion evaluates every critical snapshotted task as done, N/A, blocked, problem, or explicitly overridden.
7. A blocked/problem response is never silently converted to done.
8. Reopen/correction appends events and creates rework state; it never deletes the original completion.
9. Location evidence supports a decision but GPS unavailability alone never prevents safe continuation.
10. Location classification considers configured band and reported accuracy.
11. Operational approval, time approval, payroll release, and billing release are distinct decisions.
12. A SupplySignal may merge with an active need, but its source evidence is preserved.
13. Sync commands are idempotent per organization/device/command ID.
14. Commands from one device have a monotonically increasing sequence; gaps are visible and retryable.
15. Media metadata is recorded before upload completion and can recover without losing its task/incident association.
16. Employees cannot see client prices, payroll of others, internal quality discipline, or evidence outside their scope.
17. Client-safe reports exclude internal notes, sensitive location history, and employee-management data.

## Initial data chain

```text
Organization
  -> Client
    -> Contract
      -> Site
        -> Area
        -> ServicePlan -> ServicePlanVersion
          -> Job -> Visit -> VisitPlanSnapshot
            -> Assignment
            -> AreaExecution -> TaskResponse -> Evidence
            -> Incident / SupplySignal
            -> OperationalApproval / Rework
            -> TimeEntry / LocationEvent
```

## Migration assumptions

- Existing users become members of one seeded legacy organization.
- Existing User.role maps to a membership role without immediately removing the legacy column.
- Existing supplies and feedback receive the legacy organization ID through a deterministic backfill.
- Dual-read/write is permitted only behind a feature flag and must have a removal milestone.
- No migration infers clients/sites from unvalidated free-text locations automatically; imports create reviewable draft mappings.

