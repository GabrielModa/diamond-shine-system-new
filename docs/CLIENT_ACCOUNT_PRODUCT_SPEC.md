# Diamond Shine — Client Account product model

## Product goal

A cleaning manager should not need to understand the internal chain `Client -> Site -> Contract -> ServicePlan -> ServicePlanVersion -> Job -> Visit` to onboard or maintain a customer.

The visible product model is:

`Client account -> Locations -> Cleaning services -> Schedule -> Execution history`

The internal domain remains unchanged because its separation protects auditability, history and scheduling integrity.

## Client account

A client account answers four operational questions:

1. Who is the customer?
2. Where do we clean?
3. What have we agreed to deliver?
4. What work is coming next and what has already been completed?

The default experience must work for a residential customer with one home and one weekly service, while still supporting commercial customers with several locations and different services.

## New client flow

The normal onboarding flow has two lightweight steps:

### 1. Client

Required:
- client name
- client type

Optional:
- legal name
- primary contact
- contact email / phone
- billing email

### 2. First location

The location can be skipped and added later.

When added, collect only the operational basics:
- location name
- address
- city / postcode
- entry notes

Advanced location configuration such as precise coordinates, geofence thresholds, hazards, alarm procedure, parking and equipment remains available through advanced/internal tooling when needed. It is not required for normal onboarding.

The client record is allowed to exist before a location or service exists. If client creation succeeds but location creation fails, retry must resume the location step rather than duplicate the client.

## Cleaning service setup

A service is configured from inside the Client Account.

Visible fields:
- location
- service name
- service start
- optional agreement end
- frequency
- weekdays when relevant
- preferred start time
- people required
- expected duration
- cleaning instructions / checklist lines

The user sees one action: `Activate service`.

The server creates the required technical records atomically:
- Contract
- ServicePlan
- TaskTemplates
- ServicePlanVersion
- Job
- future Visit occurrences

If this operation fails, it must not leave a partial service chain behind.

Preferred cleaners belong to location / scheduling policy. The service setup defines how many people are required; Schedule remains the primary place for staffing and conflict resolution.

## Service versioning

Published service instructions are immutable for historical execution.

A completed or already executed Visit must continue pointing at the ServicePlanVersion that was valid when that work was performed.

The UI may show a human-friendly `Service version N`, but managers are not required to publish or manage technical versions manually.

## Change service — effective from

Changing an active service is a future-dated operation, not a destructive edit.

The manager chooses:
- Effective from
- new frequency / weekdays / time
- people required
- expected duration
- cleaning instructions
- optional new agreement end

Rules:
1. Past Visits remain untouched.
2. In-progress / completed execution is never rewritten by a future service change.
3. Only future planned Visits from the effective instant are replaced.
4. A new immutable service snapshot is used when service content changes.
5. If the content snapshot is identical, the existing ServicePlanVersion can be reused.
6. The previous recurring Job ends at the effective boundary.
7. A new Job owns the new recurrence from that boundary forward.
8. The latest eligible default team may be carried forward, but workforce eligibility remains authoritative.
9. Assigned employees receive a schedule-change notice when the regenerated work actually assigns them.
10. The change is audit logged.

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
Addresses, access context and optional preferred team information.

### Service
Human-readable current agreement: recurrence, required people, duration, agreement period and cleaning instructions.

### Schedule
Upcoming generated Visits with staffing coverage and operational state.

### Activity
Recent completed work. This is the beginning of the customer operational history, not a duplicate of Field Control or Quality.

## Navigation policy

Normal navigation:

### Run operations
- Command centre
- Schedule
- People control
- Field control
- Timesheets
- Supplies
- Inbox

### Analytics
- Operations intelligence
- Quality control
- Service feedback
- Service performance

### Manage business
- Clients
- People & access
- Audit trail

`Work orders` and the existing technical `Service setup` workspace remain permission-protected and directly addressable as advanced/internal registries during the transition, but they are not part of the normal manager navigation.

## Module boundaries

- Clients defines what was sold and where.
- Schedule defines when and who delivers it.
- People Control describes workforce context now and ahead.
- Field Control verifies today's execution and operational exceptions.
- Timesheets closes recorded time for payroll.
- Quality / Insights evaluate outcomes and trends.

No module should silently rebuild another module's responsibility.

## Product principles

1. Simple case, simple UI.
2. Complexity appears only when the customer's operation requires it.
3. Preserve historical truth.
4. No partial multi-record setup.
5. No technical object names required for normal workflows.
6. Contextual navigation over generic destinations.
7. One visible definition for each operational fact.
8. Backend validation remains authoritative.
