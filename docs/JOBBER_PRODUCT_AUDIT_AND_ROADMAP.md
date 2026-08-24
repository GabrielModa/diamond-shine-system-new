# Diamond Shine x Jobber — product audit and evolution roadmap

Execution companions:

- `docs/OPERATIONS_CORE_EXECUTION_ROADMAP.md`
- `docs/OPERATIONS_CORE_KICKOFF_PROMPT.md`
- `docs/UX_UI_PRODUCT_SPEC.md`

Date: 22 August 2026  
Scope: authenticated Jobber trial, employee screenshots, official Jobber help material, and the current Diamond Shine codebase.

## Product objective

Build a cleaning-operations platform that covers the useful commercial and field-management capabilities of Jobber while being materially better at the work Jobber treats generically: cleaning quality, proof of service, consumables, access/security, incidents, workforce compliance, and operational decision-making.

The target is not a Jobber clone. The target is a single operational system in which each signal created in the field becomes an actionable management record with an owner, SLA, history, and measurable outcome.

## What was tested in Jobber

The authenticated test used fictitious data and exercised the following chain:

1. Created a demo client with two properties.
2. Created a request with service details, an on-site assessment, assigned team member, service line item, price, and internal note.
3. Converted the request into a quote and inspected templates, discounts, taxes, deposits, payment schedules, client-view controls, attachments, messages, disclaimer, signature, PDF, and quote states.
4. Converted the quote into a recurring job.
5. Configured weekly recurrence for one month, producing five visits.
6. Configured per-visit billing, monthly invoice reminders, unit cost, price, and visit instructions.
7. Completed the first visit and verified that the visit could be completed instantly without a checklist or evidence.
8. Generated a draft invoice from the completed visit and inspected payment collection without recording a payment.
9. Inspected timesheets, approval, payroll confirmation, general/visit timers, unpaid break and activity labels.
10. Inspected expenses, job costing, permissions, location timers, checklists, automations, schedules, reports, and account settings.

Test records created in the trial:

- Client: `Demo Client`, two properties.
- Request: `Demo – Recurring Office Cleaning Assessment`.
- Quote: `Demo – Two-Site Recurring Cleaning Proposal`.
- Recurring job: five weekly visits; first visit marked completed.
- Invoice: one draft/awaiting-payment invoice for the completed visit.

No client email, payment, subscription purchase, or real-person invitation was sent.

## Mobile follow-up findings

The Android follow-up was performed while signed in as the account owner/administrator. It therefore validates Jobber's mobile administration experience, but not yet the restricted field-worker experience.

Observed mobile capabilities and behavior:

- Home combines a general `Clock In` action, current-location map, daily visit value, completed count, and today's appointment cards.
- Timesheets expose visit, driving, office, supplies, break, and general time categories. Breaks may be configured as unpaid and started for a predefined duration such as 15, 30, 45, or 60 minutes.
- A scheduled visit exposes `Start Visit` and `Complete Visit` as equal-weight primary actions before any execution evidence exists.
- The visit has Visit, Details, and Notes tabs; camera access is promoted globally and inside notes.
- Notes created elsewhere remain linked across related quotes, jobs, and invoices, confirming a shared-note mechanism but not a structured incident workflow.
- The owner can edit the visit date/time and assigned team directly from mobile.
- Job actions include go to visits, create invoice, close job, collect signature, and delete job.
- Quotes, jobs, invoices, requests, and clients are searchable from one mobile search surface with status chips and recently active records.
- Client records expose client balance, properties, work history, notes, and creation actions.
- An owner can start adding a new user from mobile; the default mobile invitation role is `Worker (Limited access)`, which can view/complete assigned work, view assigned-client details, record time, and edit notes, but cannot see pricing or collect payment.
- Communication is blocked until the account email is verified. The persistent verification banner occupies significant vertical space on nearly every screen.
- Booking confirmation composition is available on mobile, but the fictitious client has no recipient address, producing an explicit missing-email error.
- The owner mobile UI exposes commercial values, quote conversion state, invoice balance, and administrative actions; screenshots from this session must not be treated as representative of the restricted worker UI.

Mobile UX/product observations:

1. `Start Visit` and `Complete Visit` being adjacent and equally prominent makes accidental or premature completion more likely.
2. “Today's appointments” uses horizontally clipped cards and separates Completed, Active, and To Go, but provides little operational prioritization.
3. The home card reports visit monetary value to the owner; the restricted worker role intentionally hides pricing. Diamond Shine should expose role-specific operational value instead of merely hiding the same card.
4. Editing schedule and team is fast, but there is no visible acknowledgement, coverage, conflict, access-readiness, or reason workflow in the captured screens.
5. The camera is highly accessible, but a photo remains an attachment unless a workflow explicitly requires and classifies it.
6. Search is broad and useful, but its entity/status chips are commercial rather than exception-oriented.
7. A global verification alert can dominate the field viewport. Diamond Shine alerts should be contextual, dismissible where safe, and never permanently consume critical visit space.

Still required for a conclusive worker-mobile test:

- Use a separate `Worker (Limited access)` account rather than the owner account.
- Start a visit while far from the property and capture whether a warning, GPS waypoint, or exception appears.
- Enable account location services and device background location, then test the 200 m automatic/reminder modes.
- Test airplane mode: start/stop general and visit timers, edit a checklist, attach media, complete a visit, reconnect, and inspect conflicts.
- Attach a real test checklist to the job; leave required fields blank and exercise both “go back” and bypass-completion paths.
- Start a general day clock, switch into visit time, driving, supplies, break, and back to general; inspect the resulting chronological time log.
- Complete, reopen, restart, and complete the same visit; verify preservation of time entries and completion history.
- Assign two users to one visit and confirm timer independence, visibility, supervisor edits, and team-contact behavior.
- Change a worker's schedule after assignment and capture push/email notification and acknowledgement behavior.
- Test camera/photo metadata, note visibility, and whether another worker assigned to the same visit can see, edit, or delete it.
- Test unavailable/substitution flows; none are visible in the owner screenshots.

## Jobber product map

| Domain | Jobber delivery | What is good | Material weakness for cleaning operations |
| --- | --- | --- | --- |
| Clients | Client record with contacts, multiple properties, billing address, tags, custom fields, notes, schedule, and work history | Strong shared context and property separation | Property is mostly an address; it does not naturally model rooms, access, keys, alarms, equipment, consumable points, risks, or cleaning standards |
| Requests | Internal or online intake, images, assessment, team, checklist, service line items, and notes | Good optional commercial entry point; converts to quote or job | Generic intake; no operational triage, SLA, incident severity, or cleaning-specific qualification |
| Quotes | Templates, line items, images, messages, discounts, tax, deposits/payment schedule, signature, PDF, approval states | Mature commercial presentation and smooth conversion to job | Costing is service-line based, not generated from site scope, frequencies, tasks, labour standard, consumables, and risk |
| Jobs | One-off or recurring contract; visit schedule, billing schedule, line cost/price, profitability, expenses, labour, notes | Excellent separation of operational recurrence and billing recurrence | One job/location model is weak for multi-site contracts and shared client-level service agreements |
| Visits | Scheduled execution unit with address, instructions, team, notes, line items, reminders, completion/reopen | Simple and fast for field workers | Completion can be instantaneous without checklist/evidence; no exception state, quality gate, handover, supervisor review, or reasoned reopen |
| Schedule | Day/week/month, team/type/status filters, unscheduled work, map, route optimization, find-a-time | Strong dispatcher workspace | Optimizes appointment placement, not cleaning constraints such as keys, alarm windows, paired staff, equipment, security responsibility, travel risk, and site readiness |
| Checklists | Sections plus short/long text, dropdown, checkbox, number, images, date, signature; required fields and auto-attach | Flexible generic form builder | No conditional logic observed; completion can bypass required fields; checkbox design encourages rushing; no N/A/blocked/problem semantics or automatic follow-up actions |
| Timers | General day clock-in; visit timers; driving, office, supplies, break, and custom labels; offline local timer sync | Good chronological day model and payroll connection | Geofenced timers use an account-wide 200 m trigger; no configurable site risk policy, distance severity, reason capture, or manager exception analytics |
| Location | Optional automatic timer or start/stop reminder; GPS waypoints on selected actions | Privacy-conscious and useful automation | Not a quality/control system; geofence does not create a visible exception workflow and geofenced timers require connectivity |
| Team | Field crew, senior crew, crew lead, manager, administrator, plus granular permissions | Strong permission depth and labour-cost support | Permission model is feature-centric, not responsibility-centric; lacks explicit site supervisor, stock custodian, inspector, purchaser, and regional manager scopes |
| Timesheets/payroll | Day/week views, approval queue, payroll confirmation, employee cost, reimbursable expenses | Good handoff from field time to payroll | No lateness, missed-clock, out-of-range, overlap, unrealistic duration, travel anomaly, or contract-hours exception center |
| Expenses/job costing | Receipt/supplier invoice upload, accounting code, job link, reimbursement, labour and expense costing, profit margin | Strong commercial control | Expense is accounting-first; it does not manage stock, consumption, requisition, supplier fulfilment, delivery to site, or waste |
| Invoices/payments | Invoice by completed visit, service date, deposits, client view, payment states, reminders, payment collection | Mature billing lifecycle | Operational acceptance and quality evidence are not prerequisites for billing |
| Automations | Quote/invoice date follow-ups and auto-archive, plus communication automations | Useful basic reminders | Trigger/action set observed is narrow; no operational event engine for incidents, stock, quality, attendance, checklist exceptions, or SLA escalation |
| Insights | Leads, requests, quote conversion, recurring value, revenue, heatmap, profit/loss, receivables, cashflow, job value | Strong owner-level commercial overview | Weak cleaning-operational intelligence: no compliance, site health, exception frequency, stock risk, proof quality, rework, absence cover, or service-level performance |
| Client experience | Email, client hub, online request/booking, quote approval, PDFs, payment | Complete customer-facing commercial loop | No cleaning-specific service report, area-level proof, issue resolution timeline, stock visibility, or quality trend |

## Validated weaknesses we should exploit

1. A visit with no checklist was completed in one action. Jobber documents that even required checklist fields may be bypassed by choosing to complete the visit anyway.
2. Stock control in the employee example is only a set of checked items. It does not express current quantity, low/out/damaged/not-found state, expected consumption, urgency, owner, or fulfilment.
3. Location timers trigger within 200 m and are account-wide. They do not provide the configurable distance bands and exception-management model needed for credible attendance control.
4. The checklist builder has generic inputs but no observed conditional flow that turns a negative answer into an incident, replenishment request, escalation, or mandatory proof.
5. Notes are flexible but become an unstructured substitute for incidents and operational communication.
6. Job costing is strong after costs are recorded, but materials are expenses rather than an inventory and replenishment lifecycle.
7. Permissions are detailed but do not naturally scope people by region, contract, site, shift, or operational responsibility.
8. Jobber is commercially mature but operationally permissive. That is the principal differentiation opportunity.

## Current Diamond Shine baseline

The current repository already has a sound foundation for the specialized layer:

- Authentication, invite/reset tokens, rate limiting, sessions, role-based access, audit log, and PostgreSQL migrations.
- Roles: administrator, supervisor, employee, and viewer.
- Supply request lifecycle: Requested, Triaged, Approved, Ordered, In transit, Delivered, Rejected, and Cancelled.
- Supply line quantities, assignment, due date, status history, notification outbox, retries, and operational email templates.
- Employee feedback/performance, dashboard queues, communications, user management, audit UI, and test coverage.

The largest gap is now architectural rather than cosmetic: clients, sites, contracts, jobs, visits, areas, checklists, incidents, time, and quality do not yet exist as first-class connected entities.

## Target product model

The core chain should be:

`Organization -> Client -> Contract -> Site -> Service plan -> Job -> Visit -> Area execution -> Evidence/exception -> Approval -> Billing`

Cross-cutting chains:

- `Checklist response -> incident or supply signal -> owner -> SLA -> resolution -> audit`.
- `Site inventory -> consumption -> forecast -> replenishment need -> approval -> purchase -> shipment -> receipt -> stock movement`.
- `Schedule -> assignment -> acknowledgement -> arrival/geofence event -> time entry -> exception review -> payroll approval`.
- `Quality inspection/client feedback -> finding -> corrective action -> rework -> trend -> employee/site score`.

### Non-negotiable product rules

- No important field observation dies inside a note.
- Never hard-block a worker solely because GPS is inaccurate or connectivity is poor; record evidence, distance, accuracy, reason, and risk instead.
- A completed visit must explicitly represent completed, not applicable, blocked, or problem for required work—not only checked/unchecked.
- Negative answers may create structured follow-up automatically.
- Every managerial queue has an owner, SLA, severity, history, and next action.
- Offline execution is a first-class state with deterministic sync and conflict handling.
- Commercial billing can reference operational acceptance and proof without forcing every client into the same policy.
- Multi-tenant boundaries and contract/site scoping are enforced in the data model, API, UI, and audit trail.

## Delivery roadmap

### Phase 0 — architecture and tenancy foundation

Goal: make the current app safe to grow without rewriting each module later.

- Add `Organization`, membership, organization-scoped roles, and tenant keys to operational records.
- Introduce permission capabilities and scopes: organization, region, client, contract, and site.
- Standardize lifecycle events, assignments, SLA timers, attachments, comments, and notification subscriptions as reusable primitives.
- Add idempotency keys, optimistic concurrency/version fields, soft deletion/archival, and outbox processing guarantees.
- Create migration/backfill strategy for current users, supply requests, feedback, templates, and settings.
- Add tenant-isolation and authorization integration tests before exposing new modules.

Exit criteria: every read/write path is tenant-scoped; reusable workflow primitives are production-tested; existing features remain green.

### Phase 1 — clients, contracts, sites, and cleaning operating model

Goal: establish the domain that every future workflow depends on.

- Clients with contacts, billing data, tags, documents, communication preferences, and multiple sites.
- Contracts/service agreements spanning one or many sites.
- Site profile: coordinates, geofence policy, access windows, keys, alarms, parking, hazards, emergency contacts, photos, equipment, consumable points, and site-specific instructions.
- Area hierarchy: building, floor, zone, room, fixture/asset.
- Service plans with task standards, frequencies, estimated minutes, staffing, skills, equipment, chemicals, consumables, security close-down, and evidence policy.
- Import wizard for existing clients/sites and reusable cleaning templates.

Exit criteria: a manager can model a real multi-site cleaning contract without using free-text notes for core operating data.

### Phase 2 — jobs, recurring visits, scheduling, and workforce assignment

Goal: match Jobber's useful scheduling core while specializing it for cleaning.

- One-off and recurring jobs with independent visit and billing recurrence.
- Visit generation with exceptions, holidays, blackout windows, paired staffing, required skills, key responsibility, and equipment constraints.
- Dispatcher day/week/month/list/map views, unscheduled queue, bulk edit, find-a-time, conflict detection, and route/travel estimates.
- Assignment acknowledgements, schedule-change acknowledgement, availability, substitution request, absence cover, and team contact card.
- Mobile “Today” experience with next action, access readiness, co-workers, directions, offline package, and critical instructions.

Exit criteria: a multi-site week can be scheduled and safely changed without WhatsApp coordination.

### Phase 3 — execution, smart checklists, evidence, and incidents

Goal: make a visit genuinely trustworthy while keeping field UX fast.

- Area-based checklist templates with versions and visit snapshots.
- Response types: done, N/A, blocked, problem, quantity, option, text, date, signature, photo/video, meter reading, and QR/NFC confirmation.
- Conditional rules: require reason/evidence, reveal follow-up questions, create incident, create supply need, notify/escalate, or require supervisor approval.
- Fast UX: progressive disclosure, group completion where safe, remembered N/A reasons, voice input, scan-to-area, and clear remaining-work count.
- Structured incidents for access, alarm, damage, safety, client presence, equipment, pest, quality, and other; severity, owner, SLA, chat/history, attachments, resolution, and rework.
- Completion policy by contract/site: warning, supervisor override with reason, or hard requirement for critical safety/security tasks only.
- Reopen creates an auditable correction/rework event and never silently resets the original execution.

Exit criteria: every exception from a visit reaches the correct queue automatically, and ordinary completion remains faster than checkbox rushing plus WhatsApp.

### Phase 4 — attendance, geofence intelligence, offline, and payroll

Goal: produce reliable hours and exceptions without blocking legitimate work.

- General day clock plus visit, driving, supplies, office, paid/unpaid break, training, and custom categories.
- Configurable site distance bands, initially: normal <=150 m, warning 151–250 m, suspicious 251–700 m, critical >700 m; accuracy-aware and configurable per organization/site.
- Out-of-range clock-in is allowed but records coordinates, accuracy, distance, source, reason, device time, server time, and manager-review state.
- Automatic anomaly detection: missed clock-out, overlap, impossible travel, early/late arrival, unusually short/long visit, off-schedule work, repeated remote starts, and edited entries.
- Offline event journal, deterministic sync, conflict UI, device health, and background-location diagnostics.
- Timesheet approval and payroll periods with exception-first review and immutable approval history.

Exit criteria: management can trust payable hours and investigate anomalies without punishing staff for GPS or network failure.

### Phase 5 — smart inventory and procurement

Goal: turn the existing supply lifecycle into a differentiated materials system.

- Product catalog, units, pack sizes, categories, approved substitutes, suppliers, prices, lead times, and safety documents.
- Inventory locations: central store, vehicle, site cupboard, and employee custody.
- Field stock response: OK, low, out, damaged, not found; optional count and evidence.
- Deduplicate signals by site/product/window and create one replenishment need with severity and predicted stockout.
- Min/par levels, expected consumption from service plan, actual consumption, waste/damage, cycle counts, and forecast.
- Approval, purchase order, supplier communication, ordered/in-transit/delivered, partial delivery, receiving discrepancy, transfer, and stock ledger.
- Link stockouts to impacted visits, SLA risk, substitute recommendation, and manager/client communication.
- Supplier performance, site consumption variance, shrinkage, emergency purchase rate, and cost-per-visit analytics.

Exit criteria: “soap is low” becomes an owned, deduplicated, forecasted fulfilment workflow—not a message.

### Phase 6 — quality, client portal, and commercial layer

Goal: connect operational proof to retention and revenue.

- Inspections, random sampling, scoring rubrics, client feedback, complaints, corrective actions, rework, and recurring-problem detection.
- Employee coaching history separated from disciplinary access; fair scores adjusted for site complexity and evidence completeness.
- Client portal with upcoming/completed visits, service reports, area proof, incidents, resolutions, requests, approvals, documents, and communication preferences.
- Cleaning-specific estimating from areas, task frequencies, productivity standards, labour burden, travel, equipment, chemicals, consumables, overhead, margin, and risk.
- Quotes, variations/change orders, signatures, deposits, recurring pricing, invoices, credit notes, payments, and accounting integrations.
- Configurable rule: invoice after visit completion, after supervisor approval, after client acceptance, or on contract schedule.

Exit criteria: sales, delivery proof, quality, and billing share one source of truth.

### Phase 7 — operations intelligence and automation engine

Goal: turn the unified data model into a defensible management product.

- Role-specific command centers for worker, supervisor, operations manager, stock/procurement, quality, finance, and owner.
- Operational health: visits at risk, unacknowledged changes, access risk, attendance anomalies, checklist exceptions, incidents, stockouts, rework, and SLA breaches.
- Contract/site profitability with planned vs actual labour, material consumption, travel, rework, and quality cost.
- Flexible event-condition-action automation with templates and guardrails.
- Forecast staffing, absence impact, stock demand, contract margin erosion, repeated root causes, and churn risk.
- Export/API/webhooks, audit reports, retention controls, GDPR tooling, backup/restore drills, observability, and SLOs.

Exit criteria: managers work from prioritized exceptions rather than browsing screens or chasing messages.

## Recommended implementation order

The correct order is domain-first, not screen-first:

1. Tenancy, permissions, workflow primitives, and migrations.
2. Client/contract/site/area/service-plan model.
3. Jobs, recurring visit generation, scheduling, and assignments.
4. Visit execution, smart checklist engine, evidence, and incidents.
5. Time/geofence/offline/payroll.
6. Inventory/procurement built on the existing supply lifecycle.
7. Quality/client/commercial modules.
8. Intelligence, automation, integrations, and optimization.

Building dashboards, maps, or quote polish before phases 0–3 would create attractive screens on an unstable domain and force expensive rewrites.

## First implementation milestone

The next shippable milestone should be **Operations Core v1**, not “all of Jobber.” It includes phases 0–3 with:

- multi-tenant clients and sites;
- cleaning service-plan templates;
- recurring jobs and visits;
- day/week dispatcher and employee Today view;
- versioned smart checklist with problem/N/A/blocked responses;
- structured incident creation;
- existing supply request integration;
- audit, notifications, responsive UX, and automated tests.

This milestone creates the spine to which geofence, stock, quality, finance, and analytics can attach without redesigning the product.

## Product success metrics

- >=95% of visits completed with all critical tasks resolved or explicitly overridden.
- >=90% of schedule changes acknowledged before shift start.
- <2 minutes median employee interaction time outside the cleaning work itself.
- >=80% reduction in operational WhatsApp messages for access, incidents, supplies, and schedule changes.
- <5% of clock-ins requiring manager review after calibration.
- >=95% of stockout signals converted into owned replenishment workflows automatically.
- <1% duplicate replenishment requests per site/product/week.
- >=90% of incidents assigned inside 5 minutes and resolved within contract SLA.
- Measurable reduction in rework and repeat findings by site.
- Contract margin visible with labour, materials, travel, expense, and rework cost coverage.

## Build discipline

- One domain slice per branch/commit; migrations and tests ship with the slice.
- Every phase starts with model/API contract and acceptance tests, then field UX, management UX, and analytics.
- Preserve backward compatibility through explicit backfills and feature flags.
- Do not copy Jobber's UI or trademarks. Reuse validated workflow ideas and implement an original cleaning-first interaction model.
- Test with at least the employee, supervisor, scheduler, stock controller, quality inspector, finance, and owner journeys.

## Post-visit management audit

The authenticated desktop test after completing a visit exposed the manager-side audit and payroll flow.

### What Jobber records

- The timesheet separates general, supplies, visit, driving, office, break, and custom time categories.
- Each start and stop can contain an individual GPS waypoint. Clicking the location icon opens the coordinate on a map with employee and timestamp.
- The daily GPS Waypoints report showed a chronological event list: clock in/out, timer start/stop, and visit completion. In the test it contained 19 events for a few minutes of interaction.
- A completed visit records who completed it and at what time, and exposes the completion GPS point.
- The job aggregates labour entries, duration, cost, expenses, scheduled visits, invoice status, revenue, cost, and an average profit-margin card.
- Timesheets have separate approval and payroll stages. Payroll can include unapproved hours and automatically approve them when marked paid.
- The manager can manually create or edit time entries, complete future visits, reopen completed visits, and mark payroll paid.

### Why the audit is operationally weak

- GPS is a collection of isolated pins, not a movement trail or meaningful visit-compliance analysis.
- The system does not compare a waypoint with the assigned property's coordinates and does not display a clear distance-from-site result.
- No automatic severity exists for near, suspicious, or remote starts; the manager must open pins and interpret the map manually.
- A zero-minute visit was accepted, marked complete, linked to labour, GPS, billing, and payroll without a quality exception.
- Completion GPS proves where the phone was at one instant, not that cleaning was performed in the required areas.
- There is no correlation between dwell time, checklist progress, evidence photos, area coverage, incidents, materials, expected duration, and the final completion decision.
- The raw waypoint feed is noisy: repeated clock-in events are shown individually without deduplication, anomaly grouping, or a manager-friendly narrative.
- Payroll can convert unapproved hours into paid hours during the payment action, weakening separation between operational approval and financial closure.
- Profitability uses manually supplied unit cost and logged labour but does not expose cleaning-specific material consumption, travel, rework, quality failures, or exception cost.

### Diamond Shine target: visit evidence timeline

For every completed visit, produce one evidence timeline rather than scattered records:

1. Assignment issued and acknowledged.
2. Travel started, optional route and ETA.
3. Arrival recorded with GPS accuracy and distance from the site boundary.
4. Visit started with geofence classification: verified, near, suspicious, remote, or GPS unavailable.
5. Area/task progress with timestamps, responsible worker, exceptions, and required evidence.
6. Materials consumed, low-stock signals, incidents, access/security events, and corrective actions.
7. Completion attempt evaluated against minimum duration, critical checklist items, unresolved incidents, required photos, signatures, and site-exit procedure.
8. Supervisor review state: auto-approved, needs review, approved with reason, rejected, or sent for rework.
9. Timesheet and payroll released only after the configured operational approval gate.
10. Client-facing service report generated from approved evidence, with sensitive internal data excluded.

The manager dashboard should prioritize exceptions—remote starts, impossible duration, missing evidence, repeated reopenings, abnormal travel, duplicated GPS events, unresolved stockouts, and rework—instead of requiring managers to inspect maps one pin at a time.

## Final product and engineering review

### Strategic product gaps in Jobber

- It is a system of records and transactions, not a cleaning operations control system. Managers can find data, but must interpret and connect it manually.
- It optimizes the generic commercial funnel—request, quote, job, invoice, payment—more strongly than service execution, quality, compliance, and replenishment.
- The field experience is permissive: fast completion is prioritized without proving that contractual work was delivered.
- “Property” is too shallow for cleaning. It lacks an operational digital twin of buildings, floors, areas, access points, keys, alarms, hazards, equipment, consumable stations, and cleaning standards.
- Checklists capture answers but do not reliably orchestrate consequences. A problem should become an incident, a low-stock answer should become replenishment, and a security failure should become an escalation.
- Communication is fragmented across notes, email, SMS, alerts, and external messaging because there is no structured operational conversation attached to an owned issue.
- Scheduling assigns appointments but does not manage readiness: access, keys, paired staff, skills, equipment, materials, acknowledgement, substitution, and absence cover.
- Location data is retained but not converted into confidence, anomaly severity, or a fair review workflow.
- Time, visit completion, operational approval, payroll, and invoicing are connected too loosely; invalid execution can flow downstream.
- Job costing is accounting-oriented and incomplete for cleaning: planned versus actual labour, travel, chemicals, consumables, equipment, rework, complaints, and quality cost are not unified.
- Reporting describes commercial history more than operational risk. Managers still need to hunt instead of receiving prioritized exceptions.
- Generic configuration gives breadth but places the burden of designing cleaning workflows on each customer.

### Product risks for Diamond Shine

- Building a complete Jobber replacement before validating the cleaning wedge would create years of scope and a mediocre product.
- Excessive GPS surveillance would damage employee trust and create GDPR, battery, accuracy, and fairness risks. Store the minimum evidence needed, explain it clearly, and prefer event-based location over continuous tracking.
- A rigid proof system can punish legitimate field work during poor connectivity, unsafe conditions, client interruption, or GPS failure. Allow continuation with reason and route exceptions to review.
- Long checklists recreate Jobber's checkbox problem. Require evidence only where risk or contractual value justifies it and measure field interaction time.
- Employee performance scores can become unfair if site complexity, understaffing, access delays, missing supplies, and rework causes are ignored.
- Multi-tenant, permission, audit, offline-sync, and recurrence mistakes become expensive to repair after customers depend on them; they must precede feature volume.
- Commercial features such as quotes, payments, and accounting should integrate later without contaminating the operational core or delaying validation.

### Defensible product wedge

The first market promise should be narrow and measurable:

> Diamond Shine makes every commercial-cleaning visit schedulable, executable, provable, reviewable, and supply-aware without WhatsApp coordination.

The winning loop is:

`service plan -> recurring visit -> acknowledged assignment -> verified arrival -> area execution -> structured exception/supply signal -> supervisor approval -> client-ready proof`

This loop is the source of differentiation and must work before pursuing broad CRM, marketing, payment, or marketplace parity.

### Engineering gate before implementation

Before coding the next milestone, produce and review these artifacts with a senior engineer:

1. Product brief with target customer, primary jobs-to-be-done, exclusions, success metrics, and pilot assumptions.
2. Domain model and invariants for organization, client, contract, site, service plan, job, visit, area, assignment, execution, evidence, incident, supply signal, approval, and time entry.
3. State machines for visit, incident, replenishment, timesheet, and operational approval.
4. Authorization matrix by role and scope, including tenant-isolation tests.
5. Recurrence and schedule-change rules, with timezone, daylight-saving, holiday, cancellation, and regeneration cases.
6. Offline event and conflict model, including idempotency, ordering, retries, duplicate suppression, and media upload recovery.
7. Geolocation/privacy policy covering consent, accuracy, retention, employee visibility, manager access, and exception review.
8. API contracts, migration/backfill plan, observability, feature flags, and rollback strategy.
9. Vertical-slice acceptance tests for one complete visit from scheduling to supervisor approval and supply follow-up.
10. Pilot plan with real cleaners and managers, measuring completion time, exceptions caught, WhatsApp reduction, false GPS alerts, and rework.

No implementation phase should start from a screen list alone. The approved domain invariants, state machines, and vertical-slice acceptance tests define the build.
