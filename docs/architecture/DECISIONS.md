# Operations Core architecture decisions

## ADR-001 — incremental repository evolution

Decision: keep the current Next.js application in place through the tenancy/domain foundation. Introduce workspace/monorepo structure only when the Expo app and shared contracts are added, using an explicit file/import/script migration.

Reason: avoids destabilizing working authentication, supplies, feedback, dashboard, and tests before a shared package boundary exists.

## ADR-002 — shared domain, explicit API

Decision: web and mobile share domain contracts and validation, but mobile communicates only through versioned HTTP/event APIs. Next.js page behavior and server components are never the mobile API.

Initial API style: JSON REST-style route handlers with typed Zod request/response contracts, idempotency header for mutations, cursor pagination, stable error codes, and API version prefix when mobile endpoints launch.

## ADR-003 — organization-first tenancy

Decision: use shared-schema PostgreSQL with mandatory `organizationId`, scoped unique constraints, repository/service filters, and tenant-isolation tests. Do not depend on UI filters or proxy for authorization.

Future defense-in-depth PostgreSQL RLS may be evaluated after application-level tenancy is complete and migration/connection semantics are proven.

## ADR-004 — Expo mobile authentication

Decision: mobile receives short-lived access tokens and rotating, reuse-detected refresh tokens stored with platform secure storage. Web may retain secure HTTP-only cookie sessions. Device sessions can be revoked independently.

No password/session token is stored in AsyncStorage. Organization membership and capabilities are resolved server-side on each protected operation.

## ADR-005 — offline command journal

Decision: use a local transactional database suitable for Expo and an append-only SyncCommand journal. Commands have UUID, organization, device, user, sequence, aggregate, expected version, client time, payload schema version, and dependency IDs.

Server idempotency returns original results. Conflicts are explicit; last-write-wins is forbidden for visits, approvals, time, incidents, stock, and permissions.

## ADR-006 — media lifecycle

Decision: create evidence metadata/intent first, then upload directly to object storage using short-lived signed URLs. Record checksum, MIME, size, capture time, associated task/incident, visibility, retention, and upload state. Support compression, resumable retry, orphan cleanup, and malware/content validation where applicable.

## ADR-007 — notifications and events

Decision: domain transactions write outbox messages. Workers deliver email, push, and internal notifications with idempotency and retry. Push is a hint; authoritative state is fetched/synced from the API.

## ADR-008 — event-based location

Decision: collect location only for configured operational events such as shift/visit start-stop and optional arrival assistance. Continuous tracking is out of scope. Store accuracy, source, policy version, purpose, distance, classification, and retention expiry.

Distance bands are configurable. Location unavailable or suspicious permits continuation with reason and may require review.

## ADR-009 — recurrence

Decision: store recurrence intent with IANA timezone, local wall time/window, start/end policy, and exceptions. Generation is deterministic and idempotent for a bounded horizon. Published visits are independent occurrences; rule edits use prospective application and never rewrite completed history.

Daylight-saving behavior follows local wall time unless contract explicitly fixes UTC. Ambiguous/nonexistent local times create a deterministic documented resolution and audit warning.

## ADR-010 — observability and rollout

Decision: add request correlation, structured domain-transition logs, sync metrics, outbox metrics, and health/readiness checks. New contexts launch behind organization feature flags with reversible migrations and explicit rollback notes.

