# Scalability baseline

This document records the minimum operational safeguards for database growth and production observability. Dashboard polling is intentionally out of scope.

## Database connections

- Local development and long-lived Node servers may use a direct PostgreSQL connection and `DATABASE_CONNECTION_MODE=direct`.
- Serverless or horizontally auto-scaling production should use a provider transaction pooler and set `DATABASE_CONNECTION_MODE=pooled`.
- `npm run production:check` reports the connection-mode contract as a recommended readiness check. It does not expose the database URL.
- For Supabase, application runtime traffic from serverless hosts should use the transaction pooler. Keep direct/session connections for migrations and administrative tasks.
- Monitor provider-side active connections, pool saturation and wait time. Do not increase pool size blindly.

## Migration history

The existing local `diamond_shine/public` database is treated as a preserved legacy development database. Do not run `prisma migrate reset` or accept a reset prompt against it.

Use the read-only doctor before migration work:

```bash
npm run db:migrations:doctor
```

The doctor prints only host/database/schema metadata and runs `prisma migrate status`; it never mutates the database and never prints credentials.

For future schema development, use a clean dedicated development database or schema. Production/staging releases use `prisma migrate deploy`. Use `prisma migrate resolve --applied` only after manually verifying that the database already contains the exact migration change; it is not a generic drift repair command.

The feedback trigram indexes are intentionally managed by SQL migration because they rely on the PostgreSQL `pg_trgm` extension and operator classes. Do not remove them merely because they are not represented as ordinary B-tree indexes in the Prisma model.

## Feedback text search

Migration `20260907034000_feedback_trigram_indexes` enables `pg_trgm` and adds GIN trigram indexes for:

- `feedback_entries.employeeName`
- `feedback_entries.clientLocation`
- `feedback_entries.comments`

This targets the existing case-insensitive `contains` filters. Exact organization/submitter/employee/category access continues to use the existing B-tree indexes.

## Observability

The application emits structured, secret-safe log events:

- `server_request_error`: uncaught server error metadata from Next.js instrumentation. It excludes headers, query strings, request bodies and error messages.
- `slow_db_operation`: Prisma model/action and duration when an operation exceeds `PRISMA_SLOW_QUERY_MS` (500 ms by default in production; 0 disables it).

`GET /api/health` preserves the existing readiness contract and also returns dependency latency under `data.latencyMs`. It emits a `Server-Timing` header for database and evidence-storage checks.

For an on-demand p50/p95 sample:

```bash
HEALTH_CHECK_URL="https://your-host/api/health" npm run observability:health-latency
```

Use hosting/provider logs to alert on sustained `server_request_error` volume, repeated `slow_db_operation` events, elevated health p95 and connection-pool saturation.

## Repository protection target

The `main` branch should require pull requests and the repository Quality Gate before merge, while blocking force-pushes and deletion. Repository administration settings are separate from application code and must remain enabled even when CI is green.
