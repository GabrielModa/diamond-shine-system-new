# Schedule Intelligence & Service Continuity

This checkpoint makes the cleaning commitment authoritative before stable v1. It does **not** turn employee availability into the definition of whether customer work exists.

## Domain contract

```text
SERVICE OBLIGATION
≠ VISIT
≠ STAFFING
≠ WORKER AVAILABILITY
≠ ACKNOWLEDGEMENT
```

A recurring Job is the service obligation. A Visit is one occurrence. Assignments answer who can execute that occurrence. Availability answers whether a particular cleaner can execute it. Acknowledgement answers whether assigned people received/accepted it.

The server is the only schedule-health authority. Desktop Schedule, Manager Home, Field Control and manager/supervisor mobile consume `/api/schedule-health`; none of those clients recomputes coverage or recurrence truth independently. `summary.attention` is the shared count of actionable health entries (staffing gaps, missing schedule, unscheduled services, cleaner overlaps and pending acknowledgements); it is an issue count, not a distinct-Visit count.

## Health states

- `covered`: active assignments meet `requiredWorkers`.
- `needs_staff`: some active assignments exist but fewer than `requiredWorkers`.
- `unassigned`: zero active assignments.
- `expected_not_scheduled`: recurrence says an occurrence belongs in the window but no executable Visit exists.
- `unscheduled_service`: a published Service Plan has no active/paused Job.
- `service_paused`: the missing occurrence is intentionally covered by a bounded Service Pause (or an indefinitely paused Job).
- `cleaner_overlap`: the **same person** is assigned to overlapping operational visits. Different clients at the same clock time with different cleaners are valid.
- `acknowledgement_pending`: active staffing exists but one or more assignees have not acknowledged.

Active assignment remains `assigned | notified | seen | acknowledged`. Cancelled/missed visits remain history and never count as operational work.

## Continuity horizon

`POST /api/schedule-health` can repair/extend a selected range. The production worker endpoint extends active recurring Jobs idempotently using the existing `Visit(jobId, generationKey)` uniqueness boundary.

Run the worker with:

```sh
npm run schedule:continuity
```

Recommended production cadence: hourly, with `SCHEDULE_CONTINUITY_HORIZON_DAYS=120` unless operations deliberately chooses another 30–365 day horizon. The existing `NOTIFICATION_WORKER_SECRET` protects the internal endpoint; no second public secret is introduced.

A generated Visit is created even when the default team cannot fully cover it. The allocator assigns only active executable cleaners who are free of declared unavailability, school/personal leave and visit overlap. Remaining capacity becomes a visible coverage gap rather than deleting the customer's obligation.

## Default recurring team

New Jobs persist `JobDefaultAssignee` rows in the order chosen by the scheduler. Future occurrences attempt those people in priority order up to `requiredWorkers`.

The migration does **not** infer a default team for historical Jobs from old assignment snapshots. That would silently convert past staffing into future contractual intent. Existing recurring Jobs without defaults still get future Visits, safely unassigned until management decides staffing.

## Service Pause

A bounded pause targets exactly one scope:

- entire client;
- one site;
- one recurring Job/service.

Dates are interpreted in the target operational timezone and the “until” date is inclusive. Before mutation, the preview returns affected future visits, unique assigned cleaners, planned labour hours and any `in_progress` blocker.

Confirming a pause:

1. creates an auditable Service Pause;
2. cancels only `scheduled | dispatched | acknowledged` affected visits;
3. links those historical cancellations to the pause;
4. releases capacity because cancelled visits are non-operational;
5. notifies previously assigned cleaners;
6. never silently cancels a visit already in progress.

Ending early records `endedEarlyAt`; it never silently rewrites cancelled Visit history. Future cancelled occurrences from that pause surface as explicit review items so a manager can decide what to reschedule.

## UX boundaries

Desktop keeps the existing calendar and adds a dense health rail with clickable counts and filters: All operational, Problems only, Needs staff, Missing schedule, Paused, Unacknowledged. Missing recurrence is rendered as a dashed/ghost operational card. Unscheduled published plans provide a direct Create schedule action. Pause always uses preview → confirm.

Manager Home replaces its local `any assignment = covered` shortcut with the shared schedule-health attention count. Field Control shows the same shared visit/attention aggregate beside execution-only telemetry. Manager/supervisor mobile exposes **Operations today** from More, preserving the five primary employee navigation destinations. Employee mobile continues to display only executable assigned work.

## Intentionally not faked: Travel Risk

Travel risk belongs in the same future health language, but this checkpoint does not emit it without an authoritative route-duration input per cleaner transition. A heuristic straight-line or browser-only estimate would violate the shared-truth rule. Add `travel_risk` only when the server routing layer can provide deterministic, testable transition windows.

## Verification

Targeted checks after applying the package:

```sh
npx prisma generate
npm run db:deploy
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration:scheduling
npm run test:integration:continuity
npm run mobile:typecheck
npm run mobile:lint
npm run mobile:export
```

Then reseed demo data as the repository contract requires and run the complete gate:

```sh
npm run verify
```

Do not run the destructive repository `verify` against production. Production keeps the separate non-destructive release gate defined by V13.
