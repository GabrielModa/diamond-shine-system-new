# Diamond Shine Operations Suite

Cleaning operations platform with a management workspace and an offline-first field application. It connects commercial intake, clients and sites, recurring schedules, field execution, timesheets, quality, materials, communications, analytics, audit and access control in one tenant-safe workflow.

## Product surfaces

- **Management web:** command center, dispatch calendar, clients and sites, people, visit control, materials, quality, communications, commercial pipeline, reports and operational intelligence.
- **Diamond Shine Field:** native iOS/Android app for schedules, GPS-assisted attendance, individual timers, breaks, structured checklists, evidence photos, incidents, stock counts, replenishment requests, notices and offline synchronization.
- **Shared operational API:** role/capability authorization, organization isolation, audit trails, idempotent field sync, private evidence delivery, revocable mobile sessions and push notification registration.

## Product roles

- **Employee:** executes assigned work, records time/evidence/incidents/materials, receives notices, and manages their own requests.
- **Supervisor:** dispatches and monitors visits, manages operational exceptions, quality and replenishment, and reviews employee performance.
- **Administrator:** owns the commercial-to-operations system, access, communications, assignments, analytics and audit, plus all supervisor capabilities.
- **Viewer:** receives a read-only home workspace.

## Local setup

Requirements: Node.js 20+ and PostgreSQL 15+.

1. Copy `.env.example` to `.env` and replace all placeholder values.
2. Install dependencies with `npm ci`.
3. Prepare and seed the database with `npm run db:setup`.
4. Start the application with `npm run dev`.

The development seed creates `admin@ds.ie`, `super@ds.ie`, `employee@ds.ie`, and `viewer@ds.ie` with the local-only password `password123`. Never use these credentials in production.

`SESSION_SECRET` is mandatory in production and should be a cryptographically random value of at least 32 characters. Configure SMTP variables to enable invitations, resets, and operational notifications.

## Field app

From `apps/mobile`, copy `.env.example` to `.env.local`, set `EXPO_PUBLIC_API_URL` to an HTTPS endpoint reachable by the device and set `EXPO_PUBLIC_EAS_PROJECT_ID`. Native builds use `apps/mobile/eas.json`; configure FCM v1 and APNs credentials in EAS before production submission.

The mobile app stores its session in the platform keychain and its offline queue in SQLite. Each mobile sign-in creates a server-side session that can be revoked. Logging out deactivates the device push token and revokes the session.

## Production infrastructure

- Use PostgreSQL with automated encrypted backups and a rehearsed restore procedure.
- Mount `EVIDENCE_STORAGE_ROOT` as a persistent private volume. Evidence files are validated by content signature and are served only through an authenticated, tenant-scoped API.
- Set `NOTIFICATION_WORKER_SECRET` to an independent random value of at least 32 characters. Invoke `POST /api/internal/notifications/process` on a short recurring schedule with `Authorization: Bearer <secret>` to deliver queued email and push notifications with retry control.
- Configure `EXPO_PUSH_ACCESS_TOKEN` when Expo push access-token security is enabled.
- Terminate TLS before the app and monitor `GET /api/health`; only `200` with `status: ready` is healthy.

## Quality gate

See the complete [web and mobile testing guide](docs/TESTING.md) for a practical end-to-end demonstration, seeded local accounts and the offline validation scenario.

Run the same checks used by CI:

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run build
npm run mobile:export
npm run test:e2e
```

Integration and E2E tests require a reachable PostgreSQL database in `DATABASE_URL`. Run `npm run db:seed` before E2E tests. Playwright may require `npx playwright install chromium` once on a new machine.

### Existing databases

If a database was previously created from this same schema with `prisma db push`, back it up, verify that it matches the current schema, then mark the baseline once with `npx prisma migrate resolve --applied 20260821010000_baseline`. New and CI databases should use `npm run db:deploy`; production must not use `db push`.

## Release criteria

- TypeScript, zero-warning lint, unit, integration, production build, and desktop/mobile E2E checks pass.
- Production has unique `SESSION_SECRET`, PostgreSQL, HTTPS, and working SMTP configuration.
- Production has a private persistent evidence volume, notification worker secret/schedule, Expo project, FCM/APNs credentials and tested mobile revocation.
- Database backup and restore have been tested before rollout.
- Initial administrator credentials are not seed credentials.
- Supply and feedback recipient lists are verified in Communications.
- Mobile and desktop smoke tests cover login, request submission/tracking, feedback, dashboard queues, assignment, and logout.
- Infrastructure monitors poll `/api/health`; only a `200` response with `status: ready` is considered ready for traffic.

## Key commands

- `npm run dev` — development server.
- `npm run build` — optimized production build.
- `npm run db:setup` — generate Prisma client, apply schema, and seed local data.
- `npm run db:deploy` — apply versioned migrations in CI/production.
- `npm run db:seed` — reseed development/test data.
- `npm run test:unit` — deterministic business and security tests.
- `npm run lint` — zero-warning framework, hooks, and accessibility lint.
- `npm run test:integration` — API tests against PostgreSQL.
- `npm run test:e2e` — browser journeys with Playwright.
- `npm run mobile:export` — validates the static web/mobile bundle, including the SQLite worker.
- `npm run verify` — complete local release gate.
