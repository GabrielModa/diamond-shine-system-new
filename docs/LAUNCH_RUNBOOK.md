# Diamond Shine — V13 Pilot & Launch Readiness

V13 is the final construction checkpoint for Diamond Shine v1. After this checkpoint the codebase is treated as a **release candidate**. Manual product review and pilot findings can still create regression fixes, but they do not reopen the foundation unless a real launch blocker is discovered.

## What V13 proves

V13 closes the gap between “production-capable code” and “a release we can responsibly put in front of real operators”. It adds a non-destructive launch verification path, protects production from demo seeding, exercises real manager/employee/mobile authentication against the deployed origin, verifies browser security headers and makes source/tag synchronization explicit.

## Critical safety rule

`npm run verify` is the repository/test gate and is intentionally destructive to the configured test database because integration tests clean and reseed fixtures. **Never run `npm run verify` against the production DATABASE_URL.**

`npm run verify:release` is the deployed-environment gate. It is deliberately non-destructive: production configuration check, migration status, health/security smoke and pilot authentication smoke only.

## 1. Source release candidate

From a clean local checkout after the complete repository gate:

```sh
npm run release:source-check
```

Before final tagging, `main` must be clean and equal to `origin/main`. After tagging, run it again with:

```sh
RELEASE_TAG=v1.0.0-rc.1 npm run release:source-check
```

The V13 checkpoint tag is separate from the eventual stable `v1.0.0` tag. Promote the same tested commit to `v1.0.0` only after the manual/pilot sign-off, or include only explicit regression fixes found during that sign-off.

## 2. Production infrastructure evidence

Before any pilot user is invited, record evidence for all of the following:

- production PostgreSQL reachable and `npm run db:migrations:status` reports no pending migration;
- fresh pre-deploy database backup copied to encrypted off-site storage;
- latest backup restored into an isolated database at least once and the restored application passes readiness/smoke;
- `EVIDENCE_STORAGE_ROOT` is an encrypted persistent volume and evidence survives a restart/redeploy;
- HTTPS certificate and DNS are correct for `NEXTAUTH_URL`;
- SMTP sends to an external mailbox;
- Google Routes returns a real route from the deployed server key;
- Expo push reaches at least one registered pilot device;
- notification worker scheduler runs at least once per minute and exhausted jobs are visible to operations;
- monitoring/alerts cover application unavailability, database failure, worker failure and backup failure.

Do not mark an item complete based only on configuration existing. Verify the behavior.

## 3. Deployed automated gate

Use dedicated pilot accounts, not demo credentials. Export their credentials only in the operator shell/secret manager:

```sh
export PILOT_ADMIN_EMAIL='...'
export PILOT_ADMIN_PASSWORD='...'
export PILOT_EMPLOYEE_EMAIL='...'
export PILOT_EMPLOYEE_PASSWORD='...'

npm run verify:release
```

This performs:

1. strict production configuration validation;
2. Prisma migration status (read-only);
3. liveness/readiness and browser security-header smoke;
4. real admin web login and client API access;
5. real employee web login and assigned-work API access;
6. real employee mobile bearer login, inbox access and session revocation.

The pilot smoke creates/revokes an authentication session only. It does not create clients, jobs, visits, time entries, supplies, quality records or other operational data.

## 4. Manual role walkthrough — required before stable v1

Use the product as an operator, not as a developer. Record Pass / Bug / Improvement separately.

| Role | Required walkthrough |
| --- | --- |
| Organization admin | Home exceptions → client/site/service plan → schedule/assign/cancel → workforce coverage → field control → timesheet review → materials lifecycle → quality action → communications acknowledgement tracking → users/access → audit → intelligence |
| Field supervisor | Live field board → GPS/time exception → incident → visit evidence review/rework → quality inspection/action → team communications |
| Cleaner / employee | Role Home → upcoming visit → acknowledge/decline → mobile start/heartbeat/tasks/evidence/complete → inbox acknowledgement → supply request → time record/correction request |
| Stock controller | Materials queue → assign/approve/order/transit/deliver → stock count shortage idempotency |
| Quality inspector | Inspection → failed critical standard → corrective action → resolution → verification → client-safe preview |
| Finance / reviewer | Timesheet period → payable totals → approve/reject/dispute consistency |
| Viewer / restricted role | Can read only what capability grants permit; management mutations remain blocked |

Repeat the high-value cleaner path on a real phone with poor connectivity and after reconnecting. Confirm queued mutations/evidence synchronize without duplicate operational actions.

## 5. Failure drills

Before stable v1 sign-off, deliberately verify:

- application restart while users have existing sessions;
- temporary PostgreSQL outage produces readiness failure rather than silent partial operation;
- temporary notification provider failure leaves jobs retryable/exhausted instead of losing them;
- invalid/removed push token is deactivated;
- evidence storage unavailable makes readiness fail and does not silently switch to ephemeral local storage;
- rollback to the previous immutable application release is understood and timed;
- restore procedure is documented with the actual platform commands/owners.

## 6. Go / no-go

**GO** only when all automated gates are green, production infrastructure evidence exists, the manual role matrix has no unresolved Must Fix item, backup/restore is proven, and the rollback owner knows exactly which previous release is safe.

**NO-GO** for any unresolved data-loss risk, permission leak, inability to execute/record a clean, inconsistent payroll/coverage calculations, unproven backup restore, ephemeral evidence storage, broken notification path for critical schedule changes, or failed readiness/security smoke.

## 7. After V13

After V13 the project is no longer in foundation construction. Manual findings are classified as:

- **Release blocker / regression:** fix, add regression coverage where viable, rerun the affected gate and the final release gate.
- **Should improve:** backlog for the first post-v1 product iteration unless it materially harms pilot operations.
- **Future opportunity:** roadmap, not a reason to delay stable v1.

The stable `v1.0.0` tag is a business/operational sign-off on a tested release candidate, not a claim that the product will never receive another bug fix or feature.
