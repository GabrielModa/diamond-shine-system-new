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
- **Employee counters are employee-scoped.** A cleaner's Today, Schedule, response count and Time view must never include another worker's assignment or time.

## Time flow

### Cleaner

A cleaner does not run a separate General / Office / Driving / Supplies clock from the main Time tab. Their normal paid field time is recorded against assigned Visits.

1. **Start work** starts this employee's Visit time.
2. **Start another visit** stops the current timer at the switch time and starts the new Visit timer. The previous Visit is not auto-completed.
3. **Pause** stops the Visit-work segment and starts a Visit break segment.
4. **Resume** stops the break segment and starts a new Visit-work segment.
5. **Finish work** stops this employee's active Visit segment and opens closeout.
6. **Resume work** is allowed after Finish work if the employee tapped it by mistake and the Visit has not been submitted yet.
7. **Closeout** happens after work time stops.
8. **Submit & finish visit** marks delivery complete only after required closeout conditions are satisfied. After this step the field record is final unless Operations explicitly reopens it.

### Supervisor

Field supervisors may also use a Jobber-style non-visit clock for approved operational time outside scheduled Visits:

- General
- Driving
- Office
- Supplies

The supervisor sees one current clock and may switch category; switching stops the previous category at the same moment before starting the new one.

Starting or stopping a timer must never fabricate scheduled time or silently rewrite an earlier time entry.

## Employee-facing visit states

Use simple field language. Do not expose backend lifecycle names such as `acknowledged`.

- **Needs confirmation** — employee must respond to the assignment/schedule change.
- **Confirmed** — assigned and ready; this employee is not currently timing the visit.
- **In progress** — this employee has a running Visit timer.
- **Paused** — this employee has a running break associated with the Visit.
- **Finish visit** — this employee recorded Visit work, stopped the timer, and the Visit still needs closeout/submission.
- **Done** — Visit completed.
- **Cancelled / Missed** — non-operational history states.

A teammate's running timer must not make the current employee appear `In progress`.

## Today

Today is execution-first, not another schedule list.

Show:

- today's scheduled service hours;
- this employee's Visit work recorded;
- Visits completed / scheduled;
- current or next Visit as the dominant action;
- later Visits compactly;
- schedule-response attention only when action is actually required for this employee.

A recurring schedule may create many future Visit occurrences but still require only one employee response. Response counters use the canonical employee commitment set rather than counting every future occurrence independently.

Do not label Visit-only recorded time as total `Workday` time.

## Schedule

Schedule is planning-first.

- Show this employee's future Visits grouped by operational day.
- Show scheduled hours and Visit count per day.
- Allow practical planning windows (7 / 14 / 30 days).
- `Confirmed` and `Needs confirmation` summaries are interactive filters.
- Recurring schedule confirmation is requested once and reused until the schedule materially changes.

## Schedule responses

Schedule responses are reached from Today/Schedule only when needed.

For recurring work:

- one confirmation covers matching upcoming occurrences;
- do not ask for confirmation every week;
- ask again when a material schedule change creates a new commitment.

For one-off Visit changes, the response applies to that occurrence only.

## Time

Time is the current worker's own timeline.

For cleaners:

- show only their own Visit-work entries in the primary Time experience;
- show a clear active Visit card when one exists;
- direct Start / Pause / Resume / Finish back to the Visit;
- do not offer General, Driving, Office or Supplies clocks.

For field supervisors:

- show their own Visit and approved non-Visit time;
- provide clear `Clock in` / `Clock out` language;
- allow explicit General, Driving, Office and Supplies categories;
- keep one active timer and make category switching atomic.

Historical records remain auditable even if a role is later restricted from creating that type of time.

### Overnight work

Time entries may cross midnight. Never truncate or reject an entry because the calendar date changes.

Daily totals must allocate the overlap belonging to each operational day. Example:

- 23:00 start
- 01:30 stop
- total entry = 2h30
- daily totals split the interval at local midnight rather than assigning all 2h30 to the start date.

## Materials

Keep requesting materials separate from managing stock.

### Cleaner

- **Request supplies** from the Visit.
- Pick catalog item(s), quantity and priority.
- Add an optional note.
- Send a tracked request to Operations.
- Do not expose site stock counts, par levels or replenishment administration as a cleaner task.

### Supervisor / stock manager

- May count site stock.
- A saved stock count may evaluate reorder thresholds and create replenishment according to the existing materials rules.

Use the same catalog and request model as the web app so mobile does not create a parallel supplies workflow.

## GPS / location

For the initial product:

- capture location at relevant clock events when permission/device data is available;
- do not block normal work solely because GPS is unavailable or outside a geofence;
- do not show distance, risk classification or fraud-oriented wording to the employee;
- make location review data available to Operations/admin;
- never change payable time automatically from GPS alone.

Geofence reminders/automation can be added later behind an explicit policy.

## Closeout and photos

- Checklist/proof appears after Visit work stops.
- Required checklist items may block `Submit & finish visit`.
- A general closeout photo is **optional by default**. A specific configured service/task evidence rule may still require proof where the contract genuinely needs it.
- Camera UX is capture → preview → explicitly use/save or retake. Never disappear back to the Visit without making it clear whether the photo was accepted.
- Multiple optional photos may be added.
- `Report issue` and `Request supplies` are focused actions, not permanently expanded forms.
- A field issue uses one focused screen: type, description, urgency, send; photos are optional and multiple photos may be attached after the issue exists.
- Completing a Visit must never leave that employee's Visit timer running.
- Stopping a timer must never imply that the Visit itself was delivered.
- `Finish work` is reversible until final submit; `Submit & finish visit` is not an accidental timer button.

## Corrections and auditability

- Keep the original time record and any review/correction trail.
- Employee can request correction when time/location evidence is wrong.
- Admin review/approval is separate from Visit completion.
- Do not silently overwrite approved payroll facts.

## Performance baseline

The field app should not re-download and rewrite the same operational package every time the worker changes tabs.

- Share fresh Visit snapshots across mounted tabs for a short period.
- Manual refresh and reconnect still force a real sync.
- Paint directly from a successful server snapshot while persisting the same snapshot for offline use; do not immediately read the identical payload back out of SQLite before rendering.
- Detail screens may refresh their own record when opened.
- Optimize perceived field speed before adding more dashboard data.

## Scope discipline

Do not add enterprise workflow states, policy engines or extra employee steps unless an observed operational requirement justifies them.

When choosing between sophistication and clarity, prefer the smallest workflow that preserves accurate time, service delivery, employee ownership and an auditable record.
