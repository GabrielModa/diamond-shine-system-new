# Diamond Shine — Production Runbook (V12)

This runbook is the deploy/operations contract after Product Readiness V11. V12 makes misconfiguration visible instead of silently falling back to development behavior.

## Production topology

Use Node.js 20+, PostgreSQL 16+, HTTPS at the public origin, and persistent evidence storage mounted at the absolute path configured by `EVIDENCE_STORAGE_ROOT`. The application must not rely on the repository-local `.data/uploads` fallback in production.

The notification queue is durable in PostgreSQL, but delivery still needs a scheduler. Run `npm run notifications:worker` at least once per minute from the production platform scheduler/cron. The endpoint is protected by an independent `NOTIFICATION_WORKER_SECRET`.

## Required production configuration

`npm run production:check` is the source-of-truth preflight. It prints check names only, never secret values. Required configuration:

- `DATABASE_URL`: production PostgreSQL connection string.
- `SESSION_SECRET`: independent random secret, 32+ characters.
- `NEXTAUTH_URL`: public HTTPS origin.
- `NOTIFICATION_WORKER_SECRET`: independent random secret, 32+ characters and different from `SESSION_SECRET`.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` and paired `SMTP_USER`/`SMTP_PASS` when SMTP authentication is used. `EMAIL_TRANSPORT=json` is not production delivery.
- `EVIDENCE_STORAGE_ROOT`: explicit absolute path backed by persistent storage/volume.
- `GOOGLE_MAPS_API_KEY`: server-side Routes API key.
- `EXPO_PUSH_ACCESS_TOKEN`: authenticated Expo push project token.

Never commit `.env`, credentials, database dumps or evidence files.

## Deploy sequence

1. Confirm the previous production release/tag and take a database backup.
2. Build an immutable release from a clean tagged commit.
3. Run `npm ci` and `npx prisma generate`.
4. Run `npm run production:check` using production secrets.
5. Run `npm run db:deploy` exactly once for the release.
6. Start the application with `npm start` behind HTTPS.
7. Wait for `/api/health/live` = 200, then `/api/health` = 200.
8. Start/enable the one-minute notification worker schedule.
9. Run `npm run production:smoke` against the public origin.
10. Validate one manager login and one field/mobile login before declaring the release healthy.

Do not run demo seed commands against production.

## Health model

`GET /api/health/live` proves the Node process can answer requests. It intentionally does not touch dependencies.

`GET /api/health` is readiness. In production it fails closed (503) when required configuration is incomplete, PostgreSQL is unavailable, or evidence storage cannot be prepared. The response exposes check names/status only, never secret values.

Use liveness for process restarts. Use readiness to decide whether traffic should reach the instance.

## Evidence durability

Evidence is operational proof and must survive application restarts/redeploys. Mount a persistent encrypted volume at `EVIDENCE_STORAGE_ROOT`. Back up that volume separately from PostgreSQL and test restoration. If the chosen hosting platform has ephemeral/serverless filesystem only, do not launch until this adapter is moved to durable object storage.

## Notification worker

Schedule:

```sh
npm run notifications:worker
```

Recommended cadence: every minute. A failed invocation must alert operations; the durable queue already handles per-job retry/exhaustion. Monitor exhausted jobs in the Communications delivery view.

## Backups and restore drills

Create a PostgreSQL custom-format backup with:

```sh
npm run db:backup
```

`pg_dump` must be installed on the machine running the command. The script avoids placing the database password in command-line arguments. Copy every successful dump to encrypted off-site storage. Recommended baseline: daily backup, 30-day retention, plus a backup immediately before migrations.

A backup is not proven until restored. At least monthly during pilot and quarterly after stabilization, restore the latest dump into an isolated PostgreSQL instance, run `npm run db:deploy`, then run health/smoke checks against that restored environment. Never test restores over the live database.

## Migration and rollback policy

Production migrations are forward-only. Prefer expand/migrate/contract changes: add compatible schema first, deploy application changes, migrate data, and remove old fields only in a later release. Do not combine destructive schema removal with the first application release that stops using it.

If application code is bad but the migration is backward-compatible, route traffic back to the previous immutable image/tag. If a migration is not backward-compatible, restore/repair only under an explicit incident plan; never improvise a reverse migration against live data.

## Release gate

Before tagging a V12/V13 release from a development machine, the repository gate remains:

```sh
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run db:seed:demo
rm -rf .next
npm run build
npm run mobile:export
npm run test:e2e
git diff --check
```

`npm run verify` now preserves the required integration → demo reseed → E2E order automatically. `npm run verify:release` additionally runs the strict production configuration preflight, so it is intended for an environment containing real production configuration rather than the local demo environment.

## Incident minimum

Record release/tag, UTC start time, affected organization/users, observed symptom, last known good release, mitigation, data correction (if any), and the regression test added afterwards. Do not delete audit/history rows to make an incident disappear.
