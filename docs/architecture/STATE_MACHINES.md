# Operations Core state machines

All transitions require organization scope, actor identity, expected version, authorization, audit event, and durable outbox handling where side effects exist.

## Visit

```text
draft -> scheduled -> acknowledged -> ready -> in_progress -> submitted
submitted -> approved
submitted -> review_required -> approved
submitted/review_required -> rework_requested -> in_rework -> resubmitted -> approved
scheduled/acknowledged/ready -> cancelled
scheduled/acknowledged/ready -> missed
```

- `scheduled`: published and assigned or explicitly unassigned.
- `acknowledged`: required workers have accepted the latest critical version.
- `ready`: time/access/team/material prerequisites evaluated.
- `in_progress`: at least one authorized start event exists.
- `submitted`: worker has completed the field review; policy evaluation runs.
- `review_required`: anomaly, override, critical exception, or contract policy requires supervisor action.
- `approved`: operational proof accepted; downstream release gates may proceed.
- `rework_requested`: original execution remains immutable; correction scope and reason are explicit.
- Cancellation/missed transitions require reason and never erase assignments or reminders.

## Incident

```text
open -> triaged -> assigned -> investigating -> action_required -> resolved -> verified -> closed
open/triaged/assigned/investigating/action_required -> duplicate
resolved/verified/closed -> reopened
```

- Severity and SLA are set at creation/triage and changes are audited.
- `resolved` requires resolution code and narrative; `verified` may be required by policy.
- Duplicate links to the canonical incident and retains source evidence.

## Supply signal and replenishment

```text
signal: captured -> evaluated -> merged | converted | dismissed
need: requested -> triaged -> approved -> ordered -> in_transit -> delivered
need: requested/triaged/approved -> rejected | cancelled
need: ordered/in_transit -> partially_delivered -> delivered
```

- Dismissal and merge require reason.
- Delivery creates stock movement and discrepancy when received quantity differs.

## Time entry

```text
running -> stopped -> submitted -> approved -> payroll_released -> paid
stopped/submitted -> review_required -> corrected -> submitted
approved -> approval_reopened -> review_required
```

- Only one mutually exclusive active category per worker unless an explicit organization policy allows overlap.
- Corrections append revisions; approved values are never overwritten in place.
- Marking paid cannot auto-approve an operational exception.

## Operational approval

```text
pending -> auto_approved | review_required
review_required -> approved | rejected | rework_requested
approved -> reopened
```

- Auto-approval stores policy version and facts.
- Human decisions require actor and optional/required reason based on result.

## Sync command

```text
local_pending -> queued -> sending -> accepted -> applied
sending -> retryable_failed -> queued
sending -> conflict -> resolved -> queued | discarded
sending -> permanently_rejected
```

- `accepted` means server persisted the command envelope; `applied` means domain mutation completed.
- Duplicate command IDs return the original result.
- Conflict resolution preserves local and server versions for audit/support.

