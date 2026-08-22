# Diamond Shine — UX/UI product specification

Status: product direction approved, detailed interaction design required per milestone  
Surfaces: Next.js management web application and React Native + Expo field application

## Experience objective

Diamond Shine should feel immediately understandable to people familiar with Jobber and similar field-service tools, while being materially faster and more intelligent for commercial cleaning.

Familiarity comes from recognizable mental models—not copied screens:

- Home/Today, Schedule, Visits, Timesheets, Clients/Sites, Supplies, Quality, and More.
- Clear status labels, list/calendar/map views, visit cards, detail tabs, and predictable primary actions.
- A consistent progression from scheduled work to execution, review, and completion.

Differentiation comes from cleaning-specific intelligence:

- show the next necessary action, not every possible action;
- surface exceptions before records;
- connect negative field observations to owned workflows;
- explain why the system flags something and what resolves it;
- adapt the interface to role, visit state, risk, connectivity, and location confidence.

## UX principles

1. **One obvious next action.** Every operational screen has one dominant action appropriate to its state.
2. **Progressive disclosure.** Routine work stays simple; complexity appears only when a problem, rule, or permission requires it.
3. **Exceptions before administration.** Managers see what needs attention before totals and navigation.
4. **Recognition over recall.** Site instructions, access, teammates, expected duration, materials, and remaining work stay visible at the moment they matter.
5. **Evidence with purpose.** Never request a photo, signature, reason, or GPS event without explaining its operational purpose.
6. **Graceful field failure.** Weak signal, denied permission, GPS drift, client interruption, and missing materials have safe continuation paths.
7. **Calm trust.** Avoid surveillance language. Show employees what is recorded, why, and who can access it.
8. **Fast ordinary path, complete exception path.** Normal completion takes seconds; problems receive structured handling.
9. **No dead observations.** Every problem, blocked task, low-stock answer, or access failure has an owner and next state.
10. **Original visual identity.** Reuse familiar interaction conventions, not Jobber's branding, exact layouts, wording, icons, or visual trade dress.

## Information architecture

### Mobile field app

Primary navigation should stay at five destinations:

1. **Today** — shift state, next visit, acknowledgement, risk, and progress.
2. **Schedule** — day/list/map and upcoming changes.
3. **Work** — active visit, assigned work, incidents, and offline packages.
4. **Time** — shift, driving, visits, supplies, breaks, logs, and corrections.
5. **More** — profile, availability, notifications, downloads, privacy, device health, and help.

When a visit is active, use a persistent compact active-visit bar. Do not replace the entire navigation or hide time state.

### Management web

Group navigation by managerial job rather than database entity:

- **Command Center** — risks, approvals, SLAs, and today's operational health.
- **Schedule** — dispatcher, unassigned work, map, conflicts, and change acknowledgement.
- **Operations** — visits, incidents, quality, rework, and evidence.
- **Clients & Sites** — contracts, service plans, areas, access, and documents.
- **People & Time** — team, availability, timesheets, exceptions, and payroll release.
- **Supplies** — signals, requests, purchasing, movements, deliveries, and stock risk.
- **Commercial** — quotes, invoices, profitability, and integrations when implemented.
- **Settings** — organization, permissions, templates, automation, privacy, and audit.

Use global search and a command palette for experienced users, but never require them for primary workflows.

## Mobile Today experience

The opening screen answers five questions immediately:

1. Am I clocked in and what activity is running?
2. What do I need to do next?
3. Is anything blocking my next visit?
4. Has my schedule changed?
5. What still needs attention before I finish today?

Recommended hierarchy:

- compact shift/timer card;
- urgent acknowledgement or blocker, if any;
- next visit card with time, travel/ETA, site, access readiness, team, and primary action;
- remaining visits as a short timeline;
- unresolved incidents/supply follow-ups;
- offline/sync state only when relevant.

Do not show visit monetary value to field workers. Replace it with operational value: estimated duration, remaining areas, risk, evidence requirements, and team readiness.

## Visit lifecycle UX

### Before arrival

- Show site name, address, schedule/window, teammate names and contact policy, access status, required equipment/materials, hazards, and critical instructions.
- Primary action: `Start travel` or `Get directions`, depending on organization policy.
- Highlight only new/changed instructions and require acknowledgement for critical changes.

### Arrival

- Detect location as supporting evidence, not an opaque gate.
- Display understandable state: `At site`, `Near site`, `Location uncertain`, or `Away from site`.
- If suspicious, show distance/accuracy and request a short reason while allowing safe continuation.
- Never expose raw coordinates as the main employee message.

### Active visit

- Replace Jobber's adjacent `Start Visit` and `Complete Visit` buttons with one state-dependent primary action.
- Header: elapsed time, planned time, site, sync state, and pause/stop menu.
- Body: areas ordered by service plan or efficient route, each showing status and exceptional requirements.
- Sticky footer: `Continue next area`; completion appears only after all areas have explicit outcomes.
- A visible `Report problem` action remains accessible without dominating normal execution.

### Area/task execution

- Default to area cards with task groups, not one enormous checklist.
- Support Done, N/A, Blocked, and Problem; never overload one checkbox.
- Permit safe group completion only for low-risk repetitive tasks.
- Negative choices reveal only the required reason/evidence/follow-up fields.
- Show remaining critical items and estimated remaining effort.
- Autosave locally; never require a manual `Save Progress` button during routine execution.

### Completion

- Present a concise completion review:
  - completed areas/tasks;
  - unresolved/overridden items;
  - required evidence;
  - materials reported;
  - incidents and security close-down;
  - time versus expected range.
- Primary action reflects policy: `Submit for review`, `Complete visit`, or `Request supervisor approval`.
- Prevent accidental completion with clear separation from timer controls, not repetitive confirmation dialogs.
- Success screen explains sync/review status and the next visit/action.

### Reopen/rework

- Use `Request correction` or `Start rework` rather than silently returning to normal state.
- Explain who requested it, why, what must change, and whether extra time is payable.
- Preserve original evidence and visually distinguish correction evidence.

## Manager Command Center

The default manager screen should not be a generic KPI dashboard. It should provide prioritized queues:

- visits at risk now;
- unacknowledged changes;
- access/material/team readiness blockers;
- late, missed, abnormally short, remote, or reopened visits;
- completion awaiting review;
- critical incidents and SLA breaches;
- stockouts affecting future work;
- rework and repeated quality findings.

Each item must show:

- severity and due/SLA state;
- concise reason generated from evidence;
- accountable owner;
- affected client/site/visit;
- recommended next action;
- explainable confidence, not a mysterious score.

Support saved views, filters, bulk low-risk actions, keyboard navigation, and links back to the exact evidence.

## Visit evidence review

Replace raw pins and scattered records with one timeline:

- assignment and acknowledgement;
- travel and arrival classification;
- visit start with location accuracy/distance;
- area execution and evidence;
- incidents and materials;
- completion attempt and policy evaluation;
- reopen/rework;
- supervisor decision;
- payroll/client-report release.

Use a split review layout on desktop:

- left: chronological timeline and exceptions;
- center: selected evidence, task, or map context;
- right: policy result, discussion, owner, and decision actions.

Never make the manager inspect a map manually to discover that a start occurred far away. State the measured distance, threshold, accuracy, history, and recommended action.

## Scheduling UX

- Offer day/week/month/list/map while preserving filters across views.
- Visit cards show site, time/window, estimated duration, team, readiness, status, and risk—not full client prose.
- Drag/drop changes open a lightweight impact preview: conflicts, travel, access, skills, materials, affected workers, and required acknowledgement.
- Separate `draft changes` from `published schedule`; workers should not receive partial edits.
- Display acknowledgement state and escalation for unread critical changes.
- Provide availability/substitution requests inside the workflow instead of external messages.

## Supplies UX

### Field

- Ask about consumables at the relevant area or site-exit moment.
- One-tap states: OK, Low, Out, Damaged, Not found.
- Only request quantity/photo when policy or anomaly needs it.
- Immediately confirm: existing request found, request created, urgency, owner, expected update.

### Management

- Default to stock risk and fulfilment queues, not a flat request table.
- Merge duplicate signals visibly and retain their source evidence.
- Show impact: affected sites/visits, predicted stockout, substitute, supplier lead time, and SLA.
- Receiving must support partial delivery, discrepancy, transfer, and proof.

## Intelligent interaction patterns

- **Contextual recommendations:** suggest staffing, evidence, replacement product, or resolution, but require human confirmation for consequential decisions.
- **Explainable anomaly cards:** show rule, facts, confidence, and correction path.
- **Adaptive evidence:** increase proof requirements for risk, repeated failures, critical areas, or contractual obligations—not every task.
- **Change highlighting:** show what changed since last visit or acknowledgement.
- **Smart defaults:** derive tasks, time, evidence, and consumables from the service plan while keeping overrides auditable.
- **Deduplication:** recognize repeated incidents/supply signals before creating another record.
- **Recovery guidance:** when sync, GPS, camera, or permission fails, present exact steps and preserve work.
- **Role-aware summaries:** employee sees next action; supervisor sees approval context; owner sees contract health.

Do not use generative AI as a substitute for deterministic rules in payroll, permissions, safety, compliance, or state transitions.

## Visual system

- Create a distinct Diamond Shine identity with high-contrast neutrals and a restrained operational accent palette.
- Color never carries status alone; pair it with label, icon, and shape.
- Use semantic tokens for success, information, warning, danger, blocked, offline, and review.
- Minimum mobile touch target: 44×44 points; prefer 48–56 for field primary actions.
- Use a compact but breathable density on desktop and gloved-hand-friendly density on mobile.
- Establish clear type hierarchy and plain-language labels; avoid all-caps task walls.
- Cards are for bounded decisions or summaries, not every piece of content.
- Bottom sheets suit short mobile choices; full screens suit checklists, evidence, and complex recovery.
- Use skeletons for predictable loading, inline retry for failed sections, and never destroy entered data on errors.
- Motion communicates state change and progress; respect reduced-motion preferences.
- Support dark/low-light mode after the foundational design tokens are stable.

## Accessibility and inclusion

- Target WCAG 2.2 AA for web and equivalent mobile accessibility practices.
- Screen-reader names, focus order, keyboard access, visible focus, dynamic type, contrast, and error association are release requirements.
- Avoid idioms and punitive language; prepare localization and date/time/unit formatting from the start.
- Support users with limited technical literacy through plain verbs, examples, undo, and contextual help.
- Consider gloves, wet hands, bright sunlight, low light, noisy environments, and older/low-end Android devices.

## Privacy UX

- Explain location collection during onboarding and at the moment permissions are requested.
- Provide a worker-visible location-event history and correction/dispute path.
- Distinguish organization policy, device permission, current recording state, and retention.
- Never imply continuous tracking when only event-based evidence is collected.
- Manager views must display purpose and access boundaries for sensitive evidence.

## UX measurement

- Median non-cleaning interaction time per visit under two minutes.
- Time to locate and start the next visit.
- Schedule-change acknowledgement rate and latency.
- Checklist abandonment, bulk-completion, N/A/problem, and override rates.
- Completion reversal/reopen and accidental-action rate.
- Offline success, sync retry, conflict, and lost-input rate.
- False-positive GPS review rate and worker dispute rate.
- Manager time from exception creation to first meaningful action.
- Supply-signal duplication and conversion to owned request.
- Accessibility task-completion results across representative devices.

## Design and validation workflow

For every milestone:

1. Define the user, context, job, risk, and measurable outcome.
2. Map happy path, exception paths, permission variants, offline path, and recovery.
3. Produce low-fidelity flows before visual polish.
4. Prototype critical mobile and manager interactions with realistic data.
5. Test with at least one employee and one manager representative.
6. Capture decisions in interaction specifications and acceptance tests.
7. Implement with design tokens and reusable patterns.
8. Verify responsive behavior, accessibility, empty/loading/error/offline states, and analytics.

Familiarity is successful when a Jobber user understands the product quickly. Differentiation is successful when that user completes work with fewer taps, fewer messages, fewer mistakes, and substantially more trustworthy operational outcomes.

