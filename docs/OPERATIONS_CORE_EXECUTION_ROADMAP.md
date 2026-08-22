# Diamond Shine — Operations Core execution roadmap

Status: approved product direction, pending technical kickoff review  
Target: management web platform plus native/hybrid field app built with React Native and Expo  
Primary outcome: make commercial-cleaning visits schedulable, executable, provable, reviewable, and supply-aware without operational WhatsApp dependency.

## Product boundary

### Operations Core v1 includes

- Multi-tenant organizations, memberships, roles, and scoped permissions.
- Clients, multi-site contracts, sites, areas, access/security details, and cleaning service plans.
- One-off and recurring jobs, generated visits, scheduling, assignment, acknowledgement, and change history.
- Web dispatcher and exception-management experience.
- Expo mobile app for employees and field supervisors.
- Area-based smart checklists, evidence, incidents, supply signals, and visit approval.
- Event-based geolocation and an evidence timeline.
- Offline-first field execution with deterministic synchronization.
- Integration with the existing supply-request workflow.
- Audit, notifications, observability, automated tests, and safe migrations.

### Explicitly deferred

- Full CRM/marketing parity with Jobber.
- Card payment processing and complete accounting integrations.
- Route optimization, marketplace, and AI forecasting.
- Continuous employee location tracking.
- Fully customizable no-code workflow builder.
- Advanced client portal and automated commercial estimating.

## Target technical shape

Use a TypeScript monorepo after an explicit migration plan is approved:

```text
apps/
  web/       Next.js management application
  mobile/    React Native + Expo field application
  api/       shared HTTP/event boundary if separated from Next.js
packages/
  domain/       entities, value objects, policies, state machines
  contracts/    API DTOs, schemas, event contracts
  permissions/  capabilities and scopes
  validation/   shared Zod validation
  api-client/   generated/typed clients and sync transport
  design-tokens/ shared visual tokens, not shared screen components
```

The current Next.js application remains operational during migration. Do not move files or split deployment units until imports, builds, tests, environment variables, and rollback are designed.

## Product invariants

1. Every tenant-owned row is organization-scoped and authorization is enforced server-side.
2. A visit snapshots its service plan so later template edits never rewrite historical proof.
3. Visit completion cannot silently erase missing, blocked, problematic, or overridden work.
4. GPS failure never strands a worker; it creates explicit evidence and review state.
5. Reopening creates a correction/rework event and preserves the original completion.
6. Negative field answers create owned follow-up records when configured.
7. Offline commands are idempotent, ordered, retryable, and conflict-visible.
8. Operational approval and payroll/payment are distinct gates.
9. Sensitive employee evidence has purpose, retention, visibility, and audit controls.
10. Ordinary field interaction must remain faster than checklist rushing plus WhatsApp.

## Milestone 0 — technical definition and safety baseline

Goal: remove architectural ambiguity before feature coding.

Deliverables:

- Architecture decision records for monorepo, API boundary, mobile authentication, offline database, media storage, notifications, background location, and deployment.
- Domain diagram and glossary.
- State machines for visit, incident, supply signal, time entry, approval, and sync command.
- Role/scope permission matrix.
- Threat model, tenant-isolation strategy, GPS/privacy policy, media-retention policy, and audit policy.
- Recurrence specification covering timezone, daylight-saving changes, holidays, cancellations, exceptions, and regeneration.
- Vertical-slice acceptance test specification.
- Current-schema migration and backfill plan.
- Baseline measurement of current unit, integration, E2E, lint, typecheck, and build status.

Exit criteria:

- All decisions are reviewed and no core state transition remains implicit.
- Existing behavior is protected by tests.
- No production-style data is destructively migrated.

Commit sequence:

1. `docs: define operations core product contract`
2. `docs: add domain state machines and authorization matrix`
3. `test: establish operations core safety baseline`

## Milestone 1 — tenancy and workflow primitives

Goal: provide a safe foundation for every future module.

Deliverables:

- Organization and Membership models with migration/backfill for existing users.
- Capability-based authorization with organization, region, contract, and site scopes.
- Reusable assignment, status-event, comment, attachment, SLA, audit-event, and outbox primitives.
- Idempotency keys, optimistic versioning, archival, request correlation, and structured errors.
- Tenant-isolation integration tests for every new repository/service boundary.

Exit criteria:

- Cross-tenant access is impossible in automated tests.
- Existing supplies, feedback, users, and authentication remain functional.
- Every new mutation writes an auditable event.

## Milestone 2 — cleaning domain foundation

Goal: model real contracts and sites without operational free text.

Deliverables:

- Client, Contact, Contract, Site, SiteAccess, Area, ServicePlan, ServicePlanVersion, TaskTemplate, and EvidencePolicy.
- Site coordinates, accuracy/source, configurable geofence bands, access windows, keys, alarm instructions, hazards, parking, emergency contacts, equipment, and consumable points.
- Hierarchical areas: building, floor, zone, room, fixture/asset.
- Web management CRUD, import path, template duplication, archival, and complete audit history.

Exit criteria:

- A real two-site commercial-cleaning contract can be represented without notes for core operating facts.
- Service-plan versions are immutable after use.

## Milestone 3 — jobs, recurrence, visits, and dispatcher

Goal: schedule and safely change a multi-site cleaning operation.

Deliverables:

- Job, RecurrenceRule, Visit, VisitPlanSnapshot, Assignment, Availability, and ScheduleChangeAcknowledgement.
- Deterministic visit generation with idempotent regeneration and per-occurrence exceptions.
- Day/week/month/list dispatcher, unscheduled queue, conflict detection, bulk reassignment, and site readiness.
- Required skills, paired staffing, access responsibility, equipment/material prerequisites, and substitution flow.
- Notification and acknowledgement workflow for assignment and schedule changes.

Exit criteria:

- A manager can schedule, change, cancel, and reassign a recurring week with full history.
- Employees see only authorized assignments and changes requiring acknowledgement.

## Milestone 4 — Expo field app foundation

Goal: ship a real field product rather than a responsive web wrapper.

Deliverables:

- Expo app shell, secure token storage, session renewal, role-aware navigation, device registration, and push-notification foundation.
- Local encrypted/policy-appropriate database, command journal, sync queue, retry/backoff, connectivity state, and conflict UI.
- Today, visit details, access readiness, team contact, directions, acknowledgement, and offline package download.
- Camera/media capture with compression, resumable upload, metadata, visibility policy, and recovery.
- Accessibility, large touch targets, low-light readability, localization foundation, and device diagnostics.

Exit criteria:

- A worker can authenticate, download today's work, open it without connectivity, and safely resynchronize.
- No navigation depends on manager-only commercial data.

## Milestone 5 — trustworthy visit execution

Goal: prove service delivery without making field work slow.

Deliverables:

- Visit start/stop, area execution, versioned checklist responses, progress, notes, signatures, photos/video, QR/NFC-ready confirmation, and completion review.
- Response semantics: done, N/A, blocked, problem, count, option, text, date, signature, evidence.
- Conditional rules that require reason/evidence or create incidents, supply signals, notifications, escalation, or supervisor review.
- Structured incident lifecycle with severity, owner, SLA, discussion, evidence, resolution, and rework.
- Evidence timeline showing assignment, acknowledgement, arrival, execution, exceptions, completion, reopen, and approval.
- Completion policy by contract/site and auditable overrides.

Exit criteria:

- The vertical slice works from scheduled visit through approved evidence and generated follow-up.
- Zero-minute or evidence-incomplete completion becomes a reviewable exception.
- Reopen never resets history.

## Milestone 6 — attendance, geofence intelligence, and approval

Goal: create fair, trustworthy payable hours.

Deliverables:

- General shift, driving, visit, supplies, office, training, paid/unpaid break, and custom time categories.
- Event-based GPS with coordinate, accuracy, source, site distance, device/server time, and privacy retention.
- Configurable bands: verified, near, suspicious, remote, and unavailable; allow continuation with reason.
- Anomaly engine for overlap, missed clock-out, impossible travel, early/late work, abnormal duration, edited time, remote starts, and repeated reopenings.
- Exception-first supervisor review, immutable approval, payroll periods, and explicit release gate.

Exit criteria:

- Managers review exceptions rather than raw pins.
- Payroll cannot silently approve operationally unreviewed anomalies.

## Milestone 7 — supply integration and replenishment intelligence

Goal: connect field observations to the existing supply lifecycle.

Deliverables:

- Product catalog, units, pack size, substitutions, supplier data, and storage locations.
- Field response: OK, low, out, damaged, not found, optional count/evidence.
- Deduplicated SupplySignal converted into the current Request → Triaged → Approved → Ordered → In transit → Delivered lifecycle.
- Site par levels, stock movements, consumption, receiving discrepancies, transfers, and impacted-visit visibility.
- Supply exception dashboard and SLA notifications.

Exit criteria:

- One low-stock answer creates one owned replenishment workflow, not duplicate messages.
- Delivery updates the appropriate site/location balance and history.

## Milestone 8 — quality, client proof, and operational intelligence

Goal: close the management loop and validate differentiation.

Deliverables:

- Supervisor inspections, sampling, findings, corrective actions, rework, complaints, and feedback.
- Client-safe service report created from approved evidence.
- Manager command center for visits at risk, attendance anomalies, missing proof, incidents, stockouts, rework, SLA breaches, and unacknowledged changes.
- Planned-versus-actual labour, travel, materials, rework, quality cost, and contract/site profitability.
- Pilot analytics and export.

Exit criteria:

- A manager can run the day from prioritized exceptions.
- Pilot customers can verify service without seeing internal employee-sensitive information.

## Delivery rules

- Work one vertical domain slice at a time; do not create disconnected screen-only modules.
- Each slice ships schema migration, domain policy, API contract, web/mobile UI as applicable, authorization, audit, notifications, and tests together.
- Keep commits small and semantic. Never mix refactors, formatting, schema changes, and unrelated features.
- Before each commit run the smallest relevant tests; before each milestone run lint, typecheck, unit, integration, E2E, build, migration rehearsal, and mobile checks.
- Use feature flags for incomplete user journeys.
- Preserve user changes and inspect the worktree before editing or committing.
- Never commit credentials, real client data, employee GPS data, or uploaded evidence.
- Do not copy Jobber UI, wording, branding, or protected assets.

## Definition of Operations Core v1 done

- Web manager can model a contract/site, create a versioned service plan, generate and schedule recurring visits, assign workers, and manage exceptions.
- Mobile worker can operate the complete assigned visit online or offline, including evidence, incidents, materials, and safe completion.
- Supervisor can approve, reject, or send a visit for rework from a single evidence timeline.
- Location and time anomalies are classified fairly and never require manual pin hunting.
- Supply problems create deduplicated, owned replenishment workflows.
- Tenant isolation, permissions, audit, sync, recurrence, and critical state transitions have automated coverage.
- The pilot measures field interaction time, WhatsApp reduction, exceptions detected, false GPS alerts, acknowledgement, stock response, and rework.

