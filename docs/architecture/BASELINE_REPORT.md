# Milestone 0 baseline report

Date: 22 August 2026  
Branch: `codex/product-10x-foundation`

## Existing architecture

- Next.js 16.3.1 App Router application with Route Handlers and `src/proxy.ts` for optimistic protected-route checks.
- React 19.2, TypeScript 5.8, Prisma 6.5, PostgreSQL, Zod, cookie sessions, bcrypt, Nodemailer.
- Existing contexts: authentication/users, supplies, feedback/performance, dashboard, communications/templates, notifications/outbox, and audit.
- Roles: admin, supervisor, employee, viewer; current scope is global and requires organization membership evolution.
- Tests: Vitest unit/integration and Playwright E2E.

## Verified baseline

- Typecheck: passed.
- ESLint zero-warning gate: passed.
- Unit: 5 files, 100 tests passed.
- Integration: supplies 17, feedback 6, dashboard 4, users 15; 42 tests passed.
- Next.js production build: passed; 31 static/dynamic routes generated.

## Preserved constraints

- Existing authentication/session behavior and seed accounts.
- Supply lifecycle, assignment, status history, notification outbox, and API behavior.
- Feedback, dashboard, communications, user administration, audit, and tests.
- Current repository layout until ADR-001 migration gate.

## Current gaps to Milestone 1

- No Organization/Membership or tenant scope.
- User role is a global enum rather than capability plus scope.
- Audit actor relation is email-based and metadata is a string.
- Core lifecycle/status values in supplies are strings rather than typed domain states.
- No shared workflow primitives for assignments, attachments, comments, SLA, idempotency, versioning, or archival.
- No mobile API/session model, client contract package, or offline protocol implementation.
- No clients, contracts, sites, areas, plans, jobs, visits, incidents, time, or operational approval aggregates.

## Milestone 1 measurable gate

- Legacy records are backfilled into one organization without loss.
- Existing API behavior remains green.
- New organization-scoped services reject cross-tenant access in integration tests.
- Capability and scope checks replace global role assumptions for the first migrated slice.
- Every new mutation emits audit and outbox records transactionally.

