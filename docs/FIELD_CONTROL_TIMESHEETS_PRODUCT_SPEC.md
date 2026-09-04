# Field Control + Timesheets product boundary

## Product rule

These screens must not behave like two versions of the same workflow.

- **Field Control** answers: _What is happening in today's execution and what operational exception needs a manager decision now?_
- **Timesheets** answers: _How much time was recorded in this period, what is payroll-ready, what is still blocked, and what should be exported to accounting?_

## Field Control

### Owns

- today's visit execution
- active visit timers
- live execution state
- GPS / geofence evidence
- worker correction challenges
- proof/evidence review
- incidents
- operational exception decisions

### Does not own

- Schedule Health / staffing coverage
- period payroll totals
- accounting export
- generic historical timesheet review

### Primary views

1. **Live board**
   - all visits today
   - live now
   - attention
   - no timer
   - completed
2. **Review queue**
   - GPS / execution
   - evidence
   - worker challenges
3. **Incidents**
   - all open
   - critical
   - acknowledged / in progress

### Counter semantics

- Visits today = operational-day visits returned by Field Control
- Live now = active visit execution sessions
- Needs review = unique operational review cases
- Open incidents = active incidents

Metric cards are navigation/filter entry points. They must use the same semantics as the view they open.

## Timesheets

### Owns

- date-period review
- employee/client/work-type/status filtering
- recorded hours
- approved/payroll-ready hours
- pending approval hours
- running timers in the selected period
- payroll preview grouped by employee
- accounting export

### Does not own

- investigation of GPS incidents
- evidence inspection
- incident resolution
- live execution monitoring

Operational exceptions link back to Field Control instead of duplicating the same investigation UI.

### Dynamic metrics

All Timesheets metrics recalculate from the exact same filtered entry set.

Changing employee, status, work type, client or search must change:

- Recorded hours
- Approved hours
- Awaiting approval
- Challenges
- Running timers
- Payroll ready
- Payroll preview rows
- filtered export scope

The review period is the outer data window. List filters operate inside that period.

## Payroll semantics

- **Recorded**: ended time that exists in the selected period.
- **Approved / payroll-ready**: `TimeEntry.status === approved`.
- **Awaiting approval**: ended entries still `completed` or `needs_review`.
- **Operational review**: `needs_review` or an open worker challenge. Resolve these in Field Control.
- **Running**: not payroll-ready.
- **Rejected**: excluded from payroll-ready hours.

Timesheets can approve clean `completed` time. Entries with operational exceptions should link to Field Control first.

## Export

Export must always use the same loaded review period and must state its scope.

### Payroll summary

One row per employee:

- employee
- email
- recorded hours
- approved / payroll-ready hours
- pending hours
- challenges
- operational reviews
- running timers
- number of entries

### Detailed entries

One row per time entry:

- date
- employee
- email
- work type
- client
- site
- start
- end
- duration
- review status
- open challenge
- location signal
- maximum recorded distance

Current implementation exports UTF-8 CSV so it opens directly in Excel, Numbers and common accounting/payroll tools without adding a spreadsheet dependency. A native XLSX export can be added later if a client requires it.

## Cross-navigation

- Timesheets operational exception -> `/field-control?entry=<timeEntryId>`
- Field Control execution review -> `/timesheets?entry=<timeEntryId>`

Context must survive navigation.

## UX principles

- icons must improve scanning, not decorate every label
- status color describes operational meaning, not selected state
- filters never silently change counter definitions
- selected employee/filter context must propagate to all Timesheets metrics
- Field Control remains day/live focused
- Timesheets remains period/close focused
- avoid duplicated manager decisions across both screens

## Acceptance checklist

1. Field Control contains no Schedule Health summary masquerading as execution state.
2. Live metric opens the same set represented by the live counter.
3. Review counter equals unique review cases.
4. Timesheets cards change immediately when filtering one employee.
5. Payroll preview uses the same filters as the cards.
6. Export clearly states current-filter vs full-period scope.
7. Operational exceptions in Timesheets deep-link to Field Control.
8. Clean recorded time can be approved in Timesheets without opening Field Control.
9. Running/rejected time is never counted as payroll-ready.
10. No screen presents operational exception approval and payroll closing as the same task.
