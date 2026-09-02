# Diamond Shine — Client Account product model

## Product goal

A cleaning manager should not need to understand the internal chain `Client -> Site -> Contract -> ServicePlan -> ServicePlanVersion -> Job -> Visit` to onboard or maintain a customer.

The visible product model is:

`Client -> Service -> Visit`

- **Client** answers who we work for and where cleaning happens.
- **Service** answers what was agreed, how often, for how long and how many cleaners are required.
- **Visit** is one concrete execution of that service on a date and time.

The internal domain remains separated because that protects auditability, history and scheduling integrity.

## Client account

A client account answers four operational questions:

1. Who is the customer?
2. Where do we clean?
3. What have we agreed to deliver?
4. What work is coming next and what has already been completed?

The default experience must work for a residential customer with one home and one weekly service, while still supporting commercial customers with several locations and different services.

## New client flow

Normal operational onboarding is one continuous flow, not separate technical screens.

### Client

Required:
- client name
- client type

Optional:
- legal name
- primary contact
- contact email / phone
- billing email

### Service address

A service address is required for a normal operational client because Map, routing, capacity and geofence checks depend on a trusted location.

Rules:
- the address must be selected from the Google Maps-backed address search;
- the selected result stores structured address fields plus latitude / longitude;
- `coordinateSource` is recorded as geocoded;
- residential accounts default the internal location label to `Home` when no label is supplied;
- commercial location labels are optional human labels such as `Ranelagh Clinic` or `Grand Canal Office`;
- address line 2 and entry/access notes remain optional.

The user should not be asked to understand `Site` as a separate setup object. It exists internally.

After creation, the primary action is `Create client & continue to service setup`.

## Cleaning service setup

A service is configured from inside the Client Account.

Visible fields and canonical labels:
- Location
- Service name
- Service starts
- Contract ends (optional)
- Frequency
- Service days when relevant
- Preferred time
- People required
- Expected duration
- Cleaning instructions

These labels are the product vocabulary. Other modules should not invent equivalent labels with different meanings.

The user sees one action: `Activate service`.

The server creates the required technical records atomically:
- Contract
- ServicePlan
- TaskTemplates
- ServicePlanVersion
- recurring/one-off Job
- future Visit occurrences

If this operation fails, it must not leave a partial service chain behind.

A one-off contracted service is still configured here with `Frequency = One-off`. It is not a separate recurrence workflow inside Schedule.

Preferred cleaners belong to location / scheduling policy. The service setup defines how many people are required; Schedule remains the primary place for actual assignment and conflict resolution.

## Schedule product boundary

Schedule is a dispatch workspace for concrete Visits. It does not define a client's recurring obligation.

Schedule may:
- assign or replace cleaners on a Visit;
- move one Visit to a different date/time;
- resolve staffing gaps and conflicts;
- manage acknowledgement;
- cancel one Visit with a reason;
- add one extra Visit to an already configured client service;
- use Capacity Finder to choose a workable time.

Schedule must not expose:
- Job name;
- recurrence setup;
- repeat interval;
- contract end as part of visit creation;
- ServicePlan as a technical concept the manager needs to understand.

### Add visit

`+ Add visit` creates exactly one occurrence attached to an existing active client service.

Visible fields:
- Client service
- Reason
- Visit start
- Duration
- People required
- Assigned cleaning team
- Dispatch note (optional)

`Duration` and `People required` inherit the active service defaults when a service is selected, but can be adjusted for that one extra Visit. Changing them does not change the recurring service.

Reasons may include:
- Extra cleaning
- Client request
- Cover visit
- Deep clean
- Other

If the manager wants to change frequency, normal days, preferred time, expected duration, people required or cleaning instructions for future recurring work, the action belongs in `Client Account -> Change service`.

An extra Visit created from Schedule is an operational occurrence. A later recurring service change must preserve it unless a manager explicitly edits/cancels that Visit.

## Service versioning

Published service instructions are immutable for historical execution.

A completed or already executed Visit must continue pointing at the ServicePlanVersion that was valid when that work was performed.

The UI may show a human-friendly `Service version N`, but managers are not required to publish or manage technical versions manually.

## Change service — effective from

Changing an active service is a future-dated operation, not a destructive edit.

The manager chooses:
- Effective from
- new frequency / service days / preferred time
- People required
- Expected duration
- Cleaning instructions
- optional new Contract end

Rules:
1. Past Visits remain untouched.
2. In-progress / completed execution is never rewritten by a future service change.
3. Only future Visits generated by the previous recurring service rule are replaced.
4. Manual extra Visits created in Schedule are preserved.
5. A new immutable service snapshot is used when service content changes.
6. If the content snapshot is identical, the existing ServicePlanVersion can be reused.
7. The previous recurring Job ends at the effective boundary.
8. A new Job owns the new recurrence from that boundary forward.
9. The latest eligible default team may be carried forward, but workforce eligibility remains authoritative.
10. Assigned employees receive a schedule-change notice when regenerated work actually assigns them.
11. The change is audit logged.

## Multiple locations and multiple services

Complexity is progressive.

Residential example:

- Maria O'Brien
  - Home
    - Weekly cleaning · Friday · 1 cleaner · 2h

Commercial example:

- TechCorp Ireland
  - Grand Canal Office
    - Weekday office cleaning
    - Monthly deep clean
  - Sandyford Office
    - Tue / Thu cleaning

A client may have several locations and a location may have several services. The default screen should not expose extra hierarchy when it is not present.

## Client Account sections

### Profile
Customer identity and contact/billing context.

### Locations
Verified service addresses, access context and optional preferred team information.

### Service
Human-readable current agreement: recurrence, People required, Expected duration, agreement period and Cleaning instructions.

### Schedule
Upcoming generated and manually-added Visits with staffing coverage and operational state.

### Activity
Recent completed work. This is customer operational history, not a duplicate of Field Control or Quality.

## Navigation policy

Normal navigation:

### Run operations
- Command centre
- Schedule
- Live operations
- Plan coverage
- Field control
- Timesheets
- Supplies
- Inbox

### Analytics
- Operations intelligence
- Team performance
- Quality control
- Service feedback
- Service performance

### Manage business
- Clients
- People & access
- Audit trail

`Work orders` and the existing technical `Service setup` workspace remain permission-protected and directly addressable as advanced/internal registries during the transition, but they are not part of normal manager navigation.

## Module boundaries

- Clients defines who the customer is, where cleaning happens and what service was sold.
- Schedule operates concrete Visits and decides who executes them.
- Live operations describes what is happening now.
- Plan coverage helps plan workforce capacity and routing ahead.
- Field Control verifies today's execution and operational exceptions.
- Timesheets closes recorded time for payroll.
- Quality / Insights evaluate outcomes and trends.

No module should silently rebuild another module's responsibility.

## Consistency rules

1. The same operational fact has one canonical label and definition.
2. `People required` always means the required headcount for a service or Visit.
3. `Assigned cleaning team` always means the actual people assigned to a Visit.
4. `Expected duration` is the service default; `Duration` in Add visit is the concrete Visit duration inherited from that default.
5. `Preferred time` belongs to service recurrence; `Visit start` belongs to a concrete Visit.
6. Cleaning instructions belong to the service snapshot; Dispatch note is Visit-specific context only.
7. A selected employee/date/filter must scope every visible count and action that claims to describe the current view.
8. Backend validation remains authoritative for workforce eligibility and conflicts.

## Product principles

1. Simple case, simple UI.
2. Complexity appears only when the customer's operation requires it.
3. Preserve historical truth.
4. No partial multi-record setup.
5. No technical object names required for normal workflows.
6. Contextual navigation over generic destinations.
7. One visible definition for each operational fact.
8. Service configuration and Visit dispatch are separate responsibilities.
9. Backend validation remains authoritative.
