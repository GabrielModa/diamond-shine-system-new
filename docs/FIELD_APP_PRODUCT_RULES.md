# Field App Product Rules

Status: product baseline for the employee mobile app.

## Product baseline

Diamond Shine follows a simple Jobber-style field workflow unless a commercial-cleaning requirement clearly needs different behavior.

The employee app should answer four questions through four primary tabs:

- **Today** — What should I do now?
- **Schedule** — What work is coming up?
- **Time** — What time have I actually recorded?
- **More** — Secondary tools, profile and settings.

Schedule responses are an action flow, not a primary navigation destination.

## Core concepts

- **Schedule is planned work.** Scheduled duration never becomes worked time automatically.
- **Time is recorded work.** Time entries are the source of truth for what the employee actually worked.
- **Visit completion is separate from time.** Stopping a timer does not silently complete a visit.
- **Location is evidence.** GPS may inform Operations review but should not expose technical distance/risk messaging to the field employee.
- **One employee, one active timer.** A worker cannot have two simultaneous active time entries.
- **Crew time is individual.** One employee's timer state never makes another employee appear to be working.

## Jobber-style time flow

1. **Clock in** starts `General` time.
2. **Start visit** records visit work. If another activity is active, the previous activity is stopped at the switch time before visit work starts.
3. **Start another visit** stops the current timer at the switch time and starts the new visit timer. The previous visit is not auto-completed.
4. **Break** separates break time from visit work.
5. **Resume** stops the break timer and resumes visit work.
6. **Finish work** stops the employee's visit timer.
7. **Closeout** happens after work time stops when required checklist/evidence is available.
8. **Submit & finish visit** marks delivery complete only after required closeout conditions are satisfied.
9. **Clock out** stops the employee's active non-visit timer.

Starting or stopping a timer must never fabricate scheduled time or silently rewrite an earlier time entry.

## Employee-facing visit states

Use simple field language. Do not expose backend lifecycle names such as `acknowledged`.

- **Needs confirmation** — employee must respond to the assignment/schedule change.
- **Confirmed** — assigned and ready; this employee is not currently timing the visit.
- **In progress** — this employee has a running visit timer.
- **Paused** — this employee has a running break associated with the visit.
- **Finish visit** — this employee recorded visit work, stopped the timer, and the visit still needs closeout/submission.
- **Done** — visit completed.
- **Cancelled / Missed** — non-operational history states.

A teammate's running timer must not make the current employee appear `In progress`.

## Today

Today is execution-first, not another schedule list.

Show:

- today's scheduled service hours;
- this employee's visit work recorded;
- visits completed / scheduled;
- current or next visit as the dominant action;
- later visits compactly;
- schedule-response attention only when action is actually required.

Do not label visit-only recorded time as total `Workday` time.

## Schedule

Schedule is planning-first.

- Show future visits grouped by operational day.
- Show scheduled hours and visit count per day.
- Allow practical planning windows (7 / 14 / 30 days).
- `Confirmed` and `Needs confirmation` summaries are interactive filters.
- Recurring schedule confirmation is requested once and reused until the schedule materially changes.

## Schedule responses

Schedule responses are reached from Today/Schedule only when needed.

For recurring work:

- one confirmation covers matching upcoming occurrences;
- do not ask for confirmation every week;
- ask again when a material schedule change creates a new commitment.

For one-off visit changes, the response applies to that occurrence only.

## Time

Time is the employee's own timeline.

- Show only the current employee's entries.
- Show a clear live timer when one exists.
- Provide simple `Clock in` / `Clock out` language for General time.
- Allow Driving, Office and Supplies as explicit categories.
- Keep Break distinct from paid visit work according to policy.
- Display entries newest first with start/end times and durations.

### Overnight work

Time entries may cross midnight. Never truncate or reject an entry because the calendar date changes.

Daily totals must allocate the overlap belonging to each operational day. Example:

- 23:00 start
- 01:30 stop
- total entry = 2h30
- daily totals split the interval at local midnight rather than assigning all 2h30 to the start date.

## GPS / location

For the initial product:

- capture location at relevant clock events when permission/device data is available;
- do not block normal work solely because GPS is unavailable or outside a geofence;
- do not show distance, risk classification or fraud-oriented wording to the employee;
- make location review data available to Operations/admin;
- never change payable time automatically from GPS alone.

Geofence reminders/automation can be added later behind an explicit policy.

## Closeout

- Checklist/proof appears after visit work stops.
- Required closeout items may block `Submit & finish visit`.
- `Report issue` and `Request supplies` are focused actions, not permanently expanded forms.
- Completing a visit must never leave that employee's visit timer running.
- Stopping a timer must never imply that the visit itself was delivered.

## Corrections and auditability

- Keep the original time record and any review/correction trail.
- Employee can request correction when time/location evidence is wrong.
- Admin review/approval is separate from visit completion.
- Do not silently overwrite approved payroll facts.

## Scope discipline

Do not add enterprise workflow states, policy engines or extra employee steps unless an observed operational requirement justifies them.

When choosing between sophistication and clarity, prefer the smallest workflow that preserves accurate time, service delivery, employee ownership and an auditable record.
