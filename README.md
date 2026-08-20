# Diamond Shine Operations Suite

Operational workspace for supply requests, performance feedback, SLA ownership, communications, audit, and role-based administration.

## Product roles

- **Employee:** submits supply requests and tracks, repeats, or cancels their own requests.
- **Supervisor:** manages operational requests and submits employee evaluations.
- **Administrator:** owns the dashboard, users, communications, assignment, audit, and all supervisor capabilities.
- **Viewer:** receives a read-only home workspace.

## Local setup

Requirements: Node.js 20+ and PostgreSQL 15+.

1. Copy `.env.example` to `.env` and replace all placeholder values.
2. Install dependencies with `npm ci`.
3. Prepare and seed the database with `npm run db:setup`.
4. Start the application with `npm run dev`.

The development seed creates `admin@ds.ie`, `super@ds.ie`, `employee@ds.ie`, and `viewer@ds.ie` with the local-only password `password123`. Never use these credentials in production.

`SESSION_SECRET` is mandatory in production and should be a cryptographically random value of at least 32 characters. Configure SMTP variables to enable invitations, resets, and operational notifications.

## Quality gate

Run the same checks used by CI:

```bash
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e
```

Integration and E2E tests require a reachable PostgreSQL database in `DATABASE_URL`. Run `npm run db:seed` before E2E tests. Playwright may require `npx playwright install chromium` once on a new machine.

### Existing databases

If a database was previously created from this same schema with `prisma db push`, back it up, verify that it matches the current schema, then mark the baseline once with `npx prisma migrate resolve --applied 20260821010000_baseline`. New and CI databases should use `npm run db:deploy`; production must not use `db push`.

## Release criteria

- TypeScript, unit, integration, production build, and E2E checks pass.
- Production has unique `SESSION_SECRET`, PostgreSQL, HTTPS, and working SMTP configuration.
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
- `npm run test:integration` — API tests against PostgreSQL.
- `npm run test:e2e` — browser journeys with Playwright.
