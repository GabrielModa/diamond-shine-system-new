# Operations Core — master kickoff prompt

Copy the prompt below into the development task when implementation is authorized.

---

You are the senior product engineer responsible for evolving the existing Diamond Shine system into a cleaning-operations platform that is materially stronger than generic field-service software.

Repository: `diamond-shine-system-new`.

Read completely before acting:

1. `AGENTS.md`
2. `docs/JOBBER_PRODUCT_AUDIT_AND_ROADMAP.md`
3. `docs/OPERATIONS_CORE_EXECUTION_ROADMAP.md`
4. `docs/UX_UI_PRODUCT_SPEC.md`
5. `README.md`
6. The current Prisma schema, package scripts, tests, authentication, authorization, audit, notification, supplies, feedback, and dashboard implementations.
7. The relevant local Next.js 16 documentation in `node_modules/next/dist/docs/` before changing Next.js code, as required by `AGENTS.md`.

## Mission

Deliver Operations Core v1 as two purpose-built products backed by one domain:

- a Next.js management web application;
- a React Native + Expo field application for employees and field supervisors.

The product promise is:

> Make every commercial-cleaning visit schedulable, executable, provable, reviewable, and supply-aware without operational WhatsApp dependency.

The winning workflow is:

`service plan -> recurring visit -> acknowledged assignment -> verified arrival -> area execution -> structured incident/supply signal -> supervisor approval -> client-ready proof`

Do not build a Jobber clone. Preserve Jobber's useful principles—commercial entity linkage, recurring scheduling, chronological time categories, role separation—and replace its operational weaknesses with a cleaning-first domain.

## Non-negotiable constraints

- Do not start feature coding immediately.
- Begin with Milestone 0 from the execution roadmap and produce the technical-definition artifacts for review.
- Do not restructure into a monorepo until an ADR and safe migration sequence are approved.
- Preserve all existing functionality and user changes.
- Never use destructive Git or database operations.
- Do not commit secrets, personal data, real GPS data, or customer evidence.
- Every tenant-owned read and write must be organization-scoped and server-authorized.
- GPS may create evidence and exceptions but must not strand a legitimate worker because of accuracy or connectivity failure.
- Offline behavior is a first-class workflow, not a later cache enhancement.
- Visit templates are versioned and visits retain immutable snapshots.
- Reopen creates an auditable correction/rework event; it never resets history.
- Operational approval is distinct from payroll and billing.
- Avoid checkbox theatre: use done, N/A, blocked, problem, quantity, and evidence semantics with conditional follow-up.
- Field UX must be faster than the current combination of generic checklists and WhatsApp.
- Preserve familiar field-service mental models without copying Jobber's UI, wording, branding, icons, layouts, or visual trade dress.
- Every operational screen must have one state-appropriate primary action; never place start and completion as equal adjacent actions.
- Accessibility, offline, loading, empty, error, permission-denied, and recovery states are part of feature completion.

## Required first response and work

First inspect the repository and report:

1. Current architecture, modules, database, auth, permissions, audit, notifications, testing, and deployment assumptions.
2. Existing worktree changes that must be preserved.
3. Gaps between the current code and Milestone 0.
4. Technical risks, unclear decisions, and any conflict in the proposed roadmap.
5. A proposed sequence of ADRs and review checkpoints.
6. A milestone goal stated in measurable acceptance criteria.

Then create only the Milestone 0 artifacts:

- product/technical scope and exclusions;
- domain glossary and entity relationship proposal;
- state machines for Visit, Incident, SupplySignal, TimeEntry, OperationalApproval, and SyncCommand;
- role/capability/scope matrix;
- ADRs for repository topology, API boundary, Expo authentication, offline data/sync, media, push, event-based location, and deployment;
- recurrence and timezone specification;
- privacy, security, retention, and threat-model notes;
- migration/backfill plan;
- vertical-slice acceptance-test specification;
- initial web/mobile information architecture, core journey maps, and interaction-risk review based on `docs/UX_UI_PRODUCT_SPEC.md`;
- baseline verification report.

Do not proceed to Milestone 1 until these artifacts have been reviewed and explicitly approved.

## Engineering approach after approval

- Implement one end-to-end domain slice at a time.
- Start each slice with invariants, state transitions, API contracts, and acceptance tests.
- Include migration, server authorization, domain/service logic, audit events, notifications, web/mobile UI where applicable, and automated verification in the same slice.
- Use idempotency, optimistic concurrency, outbox/event delivery, and deterministic offline commands.
- Prefer explicit state machines and typed capabilities over loose strings and UI-only permission checks.
- Keep APIs suitable for both web and mobile; do not make the mobile app depend on Next.js page behavior.
- Keep shared packages focused on domain, contracts, validation, permissions, API client, and design tokens. Do not force web components into React Native.
- Instrument critical transitions and sync failures from the beginning.

## Git and verification discipline

- Inspect `git status` and diffs before every work unit.
- Create a `codex/` prefixed branch unless the user specifies another branch.
- Use small semantic commits aligned with the roadmap's recommended sequence.
- Never commit unrelated existing changes as if they were newly created.
- Run focused tests during development and the full relevant quality gate before milestone completion.
- Report exactly what was changed, tested, committed, deferred, and what remains risky.
- Stop and request review at every milestone gate; do not silently expand scope.

## Product success criteria

- At least 95% of visits complete with critical tasks resolved or explicitly overridden.
- At least 90% of schedule changes are acknowledged before shift start.
- Median employee interaction outside cleaning remains under two minutes per visit.
- Operational WhatsApp messages fall by at least 80% in the pilot.
- Fewer than 5% of clock-ins require manager review after geofence calibration.
- At least 95% of low/out stock signals become owned replenishment workflows.
- Duplicate supply requests remain below 1% per site/product/week.
- Managers operate from prioritized exceptions rather than manually reviewing maps and records.

The immediate objective is not to write the most code. It is to make the domain, security boundaries, offline model, state transitions, and first vertical slice precise enough that the platform can grow without a rewrite.

---
