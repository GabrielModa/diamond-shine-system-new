# Diamond Shine — Product Behavior Registry

Audit baseline: GitHub `main` after System Integrity V10 (`21ad9bb88db35c988eb850817c0f35c311dfec0f`).

This registry is the permanent Product Behavior Gate backlog. It records **what decision each module exists to support, the domain invariants it must respect, UX/UI expectations, current gaps, and required tests**. A module is not considered finished because its happy path works.

## Shared invariants

1. **Tenant membership/capability is authoritative.** A global/legacy user role must not decide access inside a tenant.
2. **Active assignment means:** `assigned | notified | seen | acknowledged`. `declined | removed` do not count for access, coverage, conflicts or capacity.
3. **Operational visit means:** not `cancelled` and not `missed`. Cancelled/missed remain historical records.
4. **Cancellation releases future capacity immediately**, cannot be executed, is auditable and must reach previously assigned cleaners.
5. **School/personal leave/manual unavailability/visit overlap are one scheduling decision**, not separate UI-only concepts.
6. **Recurring service is defined in the service/site timezone.** Local contractual time must survive DST changes.
7. **Derived numbers must use the same domain rules everywhere.** Schedule, People, Home, Field Control and Intelligence cannot disagree.
8. **Manual bugs become regression tests where viable.**

---

## 1. Command Centre (`/home`)

**Manager decision:** What needs action now across today’s delivery, coverage, time, quality and materials?

**Sources:**
- `src/app/(protected)/home/page.tsx`
- `src/components/manager/ManagerOverview.tsx`
- `src/app/api/visits/route.ts`
- `src/app/api/field-control/route.ts`
- `src/app/api/quality/control/route.ts`

**Must fix**
- Do not expose a manager command centre to a field employee merely because legacy `User.role` says employee can open `/home`.
- Cancelled visits must not inflate “Visits today”, “Unassigned work” or dispatch lists.
- Command counts must use the same active-assignment definition as Schedule/People.

**UX/UI gate**
- Manager home should prioritize exceptions and next decisions rather than duplicate every analytics screen.
- Field employees need a role-appropriate landing experience, not empty/403-backed manager cards.
- Status colors must communicate operational meaning, not reuse generic “Pending/Completed” for unrelated states.

**Tests**
- E2E per role landing state.
- Integration: cancelled visit does not count as today’s operational work.
- Regression: declined assignment creates coverage gap.

---

## 2. Schedule (`/schedule`)

**Manager decision:** What work must happen, when, where, who can realistically do it, and where are conflicts/gaps?

**Sources:**
- `src/components/schedule/ScheduleBoard.tsx`
- `src/app/api/jobs/route.ts`
- `src/app/api/visits/route.ts`
- `src/app/api/visits/[id]/route.ts`
- `src/app/api/visits/[id]/acknowledgement/route.ts`
- `src/app/api/availability/route.ts`
- `src/modules/scheduling/recurrence.ts`
- `tests/integration/scheduling.test.ts`

**Must fix**
- Default operating plan hides cancelled/missed; explicit history filter can reveal them.
- Cancellation preserves record + assignment history, requires reason, releases conflicts/capacity and notifies affected cleaners.
- Declined/removed assignments do not count as coverage or block another assignment.
- School windows and personal leave must block assignment server-side; school holidays suppress only the school block.
- Only executable workforce roles can be assigned cleaning work.
- Recurrence must remain at the same local time through Europe/Dublin DST.
- Completed/cancelled/missed occurrences are immutable in the appropriate ways.

**UX/UI gate**
- Default filter should say **Operational**, not ambiguous **All**.
- “Cancelled” belongs to history, visually subdued rather than mixed with live work.
- Cancel action must explain consequence and require operational reason.
- Create/edit sheets: X/Close, Escape and outside-click when safe; focus remains predictable.
- At scale: employee and site selection should be searchable, conflicts visible before submit, coverage gaps visually dominant.

**Tests**
- Integration: cancel lifecycle, preserved assignment history, notification/audit, no execution after cancel.
- Integration: decline removes coverage/access/conflict.
- Integration: manual availability + school + personal leave + school holiday.
- Unit: DST recurrence.
- E2E: cancel disappears from Operational and reappears under Cancelled/History after refresh.

---

## 3. People & Coverage (`/people`)

**Manager decision:** Who has capacity, who is available at the relevant time, where would they start from, and what quality/workload context matters?

**Sources (local Workforce V9):**
- `src/app/api/workforce/route.ts`
- `src/components/workforce/WorkforceWorkspace.tsx`
- `src/components/workforce/CoverageMap.tsx`
- `src/lib/workforce-availability.ts`
- `src/lib/workforce-quality.ts`

**Must fix**
- Planned capacity excludes cancelled/missed visits and inactive assignments.
- 7/14/30/90-day presets must represent exactly that many calendar dates.
- Workforce list must contain executable workforce, not scheduler/quality roles by accident.
- School/leave rules shown here must be the same rules enforced by Schedule.

**UX/UI gate**
- Dense, searchable, filterable table beats a static leaderboard.
- Map card remains compact; Auto/Home/School is an override preview, never persistent mutation.
- Quality is contextual (average/count/trend/issues), not an opaque employee score.
- Custom From/To is always discoverable and validated.

**Tests**
- Unit date-range semantics.
- Integration cancelled/declined capacity.
- E2E custom range, map close behavior and typeahead.

---

## 4. Field Control (`/field-control`)

**Supervisor decision:** What is happening right now, which visit is blocked, which timer/GPS signal needs review, and which incident needs intervention?

**Sources:**
- `src/components/field-control/FieldControlBoard.tsx`
- `src/app/api/field-control/route.ts`
- execution APIs under `src/app/api/visits/[id]/*`

**Must fix**
- Cancelled/missed visits never appear as live execution.
- Declined/removed assignments never appear as current crew.
- Active timers remain authoritative even if navigation refreshes.

**UX/UI gate**
- Exception-first: critical blockers and live timers before low-value detail.
- Search/filter required when daily visits scale.
- Auto-refresh should not reset operator context or selected item.
- Distinguish “no GPS” from “outside geofence” from “normal”.

**Tests**
- Integration live-board terminal filtering.
- E2E live→review→incident navigation and refresh stability.

---

## 5. Timesheets (`/timesheets`)

**Manager decision:** Which time is payroll-ready, what needs human review, and why?

**Sources:**
- `src/components/timesheets/TimesheetsWorkspace.tsx`
- `src/app/api/time-entries/route.ts`
- `src/app/api/time-entries/[id]/review/route.ts`

**Must fix**
- Payroll preview period must match visible From/To.
- Payroll total must not silently include rejected/non-payable records.
- Review count and displayed period must tell the same story.
- Decisions remain auditable; original clock record is never destroyed.

**UX/UI gate**
- Explicit payroll period + approved/pending/rejected breakdown.
- Group by employee when scale grows; exceptions should explain GPS/duration/dispute reason inline.
- Approval/rejection needs clear irreversible/next-state feedback.

**Tests**
- Unit payable-duration derivation.
- Integration period/status filtering and review lifecycle.
- E2E custom date range affects payroll preview.

---

## 6. Materials / Supplies (`/supplies` + `/my-requests`)

**Manager decision:** Where will material shortage stop a clean, what request is overdue, who owns replenishment, and what is the next lifecycle step?

**Employee decision:** What do I need at this site, when, and what happened to my request?

**Sources:**
- `src/components/materials/MaterialsWorkspace.tsx`
- `src/app/(protected)/my-requests/page.tsx`
- `src/app/api/supplies/route.ts`
- `src/app/api/supplies/[id]/status/route.ts`
- `src/app/api/supplies/[id]/assign/route.ts`
- `src/app/api/supplies/[id]/notify/route.ts`
- `src/app/api/sites/[id]/stock-counts/route.ts`
- `src/lib/business-logic.ts`
- `tests/integration/supplies.test.ts`
- `tests/e2e/supplies.spec.ts`

**Must fix**
- `supplies.request` / `supplies.manage` capabilities, not legacy admin-only checks, decide behavior.
- Stock controller and field supervisor with `supplies.manage` can actually operate the queue.
- Repeat Request must prefill the new request form; localStorage handoff cannot be dead code.
- Terminal request states cannot be reassigned/notified as active work.
- Auto-generated shortage request remains idempotent per open item/site.

**UX/UI gate**
- One coherent flow: count → shortage → request → triage → approve → order → transit → deliver.
- Do not force managers to leave Materials and hunt through a legacy Dashboard for basic lifecycle actions.
- Replenishment queue should surface owner, SLA, overdue state and next legal action.
- Large catalog/site selectors need search/typeahead.

**Tests**
- Integration capability matrix (employee/supervisor/stock_controller/admin/viewer).
- E2E repeat request prefill, cancel own request, manager lifecycle.
- Regression: automatic count does not duplicate an existing open replenishment.

---

## 7. Communications (`/communications`)

**Manager decision:** Who must know about an operational change, and who has not acknowledged it?

**Sources:**
- `src/components/communications/OperationalInbox.tsx`
- `src/app/api/operational-notices/route.ts`
- notification queue APIs

**Must fix**
- Schedule cancellation creates a linked operational notice/push.
- Expired notices must not remain indistinguishable from active instructions.
- Recipient/ack counts must remain consistent with delivery state.

**UX/UI gate**
- Recipient picker needs search and practical targeting at scale (role/site/team).
- Critical/unacknowledged notices dominate inbox; old/expired content is secondary.
- A manager should see “who has not acknowledged” without expanding every card.

**Tests**
- Integration linked cancellation notice.
- E2E publish → receive → acknowledge → manager tracking.

---

## 8. Quality Control (`/quality`)

**Manager decision:** Which sites are below standard, what corrective action is open/overdue, and has the fix been verified?

**Sources:**
- `src/components/quality/QualityWorkspace.tsx`
- `src/app/api/quality/control/route.ts`
- quality inspection/action APIs

**Must fix**
- Corrective action lifecycle and evidence remain linked and auditable.
- Related visit selector should not treat cancelled work as a delivered service candidate.

**UX/UI gate**
- Replace `window.prompt` resolution/verification flows with product-grade dialog/drawer containing required context.
- Critical failed standards and overdue actions must be visually obvious.
- “Client-safe” report must make visibility consequences clear before publish/share.

**Tests**
- E2E inspection → corrective action → resolve → verify.
- Regression critical failure caps/pass behavior.

---

## 9. Legacy Service Feedback (`/feedback` + `/api/feedback`)

**Decision:** Client/manager feedback about delivered service and employee interaction.

**Sources:**
- `src/app/(protected)/feedback/page.tsx`
- `src/app/api/feedback/route.ts`
- `src/lib/constants.ts`

**Must fix**
- `/feedback` and `/quality` currently render the same `QualityWorkspace`; navigation promises two concepts but serves one UI.
- Legacy feedback API uses hard-coded `CLIENT_LOCATIONS` strings instead of canonical Site/Visit relationships.
- Decide canonical model: service feedback should reference real Site/Visit and optionally employee; do not silently delete historical records.

**UX/UI gate**
- Separate “client/service feedback” from “internal quality inspection” if both remain product concepts.
- Avoid duplicate nav destinations with identical content.

**Tests**
- Migration/backward-compatibility test before changing legacy feedback data.
- E2E only after IA/model decision is explicit.

---

## 10. Operations Intelligence (`/insights`)

**Manager decision:** What should I act on first, and why?

**Sources:**
- `src/components/intelligence/IntelligenceWorkspace.tsx`
- `src/app/api/intelligence/route.ts`
- `src/modules/intelligence/scoring.ts`

**Must fix**
- Cancelled visits cannot reduce completion rate or create false unassigned work.
- Coverage uses active assignments only.
- Corrective action links point to canonical Quality route.

**UX/UI gate**
- Global health score must be explainable: show components and weights, not a magic number.
- “Act now” remains more important than charts.
- Risk reason text should link to the actual record where possible.

**Tests**
- Unit score components/weights.
- Integration cancelled/declined semantics.
- E2E score explanation and action navigation.

---

## 11. Clients (`/clients`)

**Manager decision:** Which account/site do I need to open and what operational relationships exist?

**Sources:**
- `src/components/clients/ClientsWorkspace.tsx`
- `src/app/api/clients/route.ts`

**Must fix**
- Search placeholder promises site search; API currently searches only client display/legal name. Search behavior must match the UI promise.

**UX/UI gate**
- Client directory = fast lookup/drill-down. Service setup belongs in Operations.
- At scale support server-side search/pagination rather than loading every client forever.

**Tests**
- Integration search by client/site/contact.
- E2E directory search and detail close behavior.

---

## 12. Service Setup (`/operations`)

**Manager decision:** Is the commercial/service design complete enough to generate executable work?

**Sources:**
- `src/components/operations/OperationsHub.tsx`
- client/site/contract/service-plan APIs

**Must fix**
- Preferred cleaning team cannot include a scheduling-only role that cannot execute visits.
- Published plan remains immutable/versioned; scheduled visits point to the correct version.

**UX/UI gate**
- Native selects for hundreds of clients/sites/team members will not scale: introduce searchable selectors.
- Service-plan tasks need structured editing for required/critical/evidence rules; newline-only task entry is a quick-start, not final management UX.
- Clarify progression Client → Contract → Site/Areas → Service Plan → Publish → Schedule.

**Tests**
- Integration executable preferred team.
- E2E create client→site→plan→publish→schedule happy path plus invalid/incomplete states.

---

## 13. Work Orders (`/work-orders`)

**Manager decision:** Which recurring/active service definition is generating work, where are coverage gaps, and what happens next?

**Sources:**
- `src/components/work-orders/WorkOrdersWorkspace.tsx`
- `src/app/api/jobs/route.ts`

**Must fix**
- Current “Unassigned work” KPI means “job with zero visits”, not “visits missing required workers”. Rename or calculate real coverage.
- Paused/ended/archive semantics must stop future operational generation without destroying history.

**UX/UI gate**
- Show next occurrence, actual coverage gap, recurrence and service/site context.
- Detail should answer “is this generating the right work?” rather than only display metadata.

**Tests**
- Integration coverage metric.
- E2E filter/date/detail and link to affected Schedule.

---

## 14. People & Access (`/users`)

**Admin decision:** Who has access, what operational role do they have, and what can that role do?

**Sources:**
- `src/app/(protected)/users/page.tsx`
- `src/app/api/users/route.ts`
- `src/app/api/users/[id]/role/route.ts`
- `src/lib/permissions.ts`
- `src/lib/tenancy.ts`

**Must fix**
- UI/API expose only legacy Admin/Supervisor/Employee/Viewer while domain has scheduler, stock_controller, quality_inspector, finance.
- Tenant membership role/capability is authoritative; global User.role must not leak across organizations.
- Never remove the final organization admin.

**UX/UI gate**
- Role selector should explain purpose/capabilities in plain operational language.
- Changing role is a high-impact action and needs clear confirmation/feedback.

**Tests**
- Integration every membership role and tenant isolation.
- E2E invite/change role/deactivate with page-access consequences.

---

## 15. Audit Trail (`/audit`)

**Admin decision:** Who changed what, when, why, and what record was affected?

**Sources:**
- `src/app/(protected)/audit/page.tsx`
- `src/app/api/audit/route.ts`

**Must fix**
- Use `audit.read` capability rather than hard-coded legacy admin.
- Current API caps at 100 with no server-side pagination/filtering; unacceptable for a real operation.
- Metadata/reason exists but UI hides it.

**UX/UI gate**
- Server-side date/action/actor/entity filters.
- Expandable before/after/reason metadata and links to target records when possible.
- Dense table is appropriate; avoid giant cards.

**Tests**
- Integration capability + pagination/filtering.
- E2E filter + inspect metadata.

---

## 16. Legacy Dashboard (`/dashboard`)

**Current behavior:** “Enhanced Management” dashboard centered on supply requests + legacy feedback.

**Sources:**
- `src/app/(protected)/dashboard/page.tsx`
- `src/app/api/dashboard/route.ts`

**Product gap**
- Duplicates/overlaps Command Centre, Materials, Quality and Intelligence.
- Nav label “Service performance” does not match a supplies/legacy-feedback dashboard.

**UX/UI decision required**
- Prefer one clear manager command centre and purpose-specific drill-down modules.
- Retire, rename or redefine this route after supply/feedback consolidation; do not maintain two manager workflows for the same request lifecycle.

**Tests**
- Keep regression coverage until migration/deprecation is deliberate.

---

## 17. Mobile Schedule / Work / Offline Sync

**Cleaner decision:** What do I need to do next, can I execute it offline, and has dispatch changed anything?

**Sources:**
- `apps/mobile/app/(tabs)/schedule.tsx`
- `apps/mobile/app/(tabs)/work.tsx`
- `apps/mobile/lib/use-visits.ts`
- `apps/mobile/lib/offline.ts`
- `src/app/api/sync/route.ts`
- `src/modules/execution/access.ts`

**Must fix**
- Cancelled/missed and declined assignments cannot remain actionable/cached.
- Server snapshot replacement must purge stale cached visits; INSERT/REPLACE alone leaves deleted/cancelled assignments behind forever offline.
- Cancellation must arrive through operational notice/push and then reconcile cached schedule.
- Offline mutations remain idempotent/conflict-aware.

**UX/UI gate**
- “My work” is action-first; Schedule is chronological context.
- Offline/sync/conflict status must be explicit without scaring users with technical wording.
- A cancelled visit should disappear from action queue and clearly explain the dispatch change via Inbox.

**Tests**
- Mobile/offline unit tests are currently a gap; add testable pure cache/sync reducers where native SQLite makes direct unit testing expensive.
- Integration sync excludes inactive assignments/terminal work.

---

## 18. Cross-system IA / Design System

**Current duplication to resolve**
- Command Centre vs Dashboard vs Intelligence.
- Quality vs Feedback identical route UI.
- Materials management split between MaterialsWorkspace and legacy Dashboard overlays.
- Clients directory overlaps Operations setup but can be valid if purpose remains explicit.

**UX/UI invariants**
- Temporary surfaces: predictable X/Close + Escape + outside click when safe + focus handling.
- Searchable selectors for large people/site/client datasets.
- Semantic status colors shared across modules.
- Operational tables optimize density/scanability; details use dialogs/drawers instead of moving the list.
- Every empty/loading/error state tells the operator what happened and what they can do next.
- Date ranges use explicit From/To and never silently change what a KPI means.

---

# Delivery sequence

### Foundation A — System integrity (V10)
- canonical visit/assignment rules
- cancellation/decline behavior
- membership-capability page access
- workforce-aware scheduling guard
- DST-safe recurrence
- field/intelligence/workforce consistency
- supplies capability correction
- repeat-request handoff
- mobile stale-cache correction
- first regression tests

### Foundation B — Management correctness
- payroll period/payable totals
- work-order real coverage KPIs
- audit pagination/metadata
- users real operational roles
- client server search/pagination

### Foundation C — UX consolidation
- Materials lifecycle actions in one place
- Quality corrective-action dialog instead of `window.prompt`
- Communications scalable recipient targeting
- Intelligence score explanation/drill-down
- eliminate/rename duplicate Dashboard/Feedback IA

No foundation is “done” until the full repository gate passes and the user validates the operational UX.


---

## V11 — Product Readiness checkpoint

**Purpose:** move the V10 integrity foundation from technically correct to operationally coherent for real managers, supervisors and cleaners.

**Acceptance gates added in V11**
- Home, Schedule and Field Control derive operational day boundaries from the organization timezone.
- datetime-local schedule inputs represent organization wall-clock time rather than browser-local time.
- Europe/Dublin DST start/end preserve local service intent and produce correct 23/25-hour day boundaries.
- Declined/removed assignment history is retained in persistence but never rendered as current Field Control crew.
- Schedule has one create-work dialog and supports direct visit deep links from role Home.
- Role-specific Home remains the landing experience for non-manager capabilities.

**Audit outcome:** Materials, Timesheets, Quality, Communications, Clients, People & Access, Audit and Intelligence already carry the V10 lifecycle/capability/error-state work and do not require broad V11 rewrites. V11 intentionally changes only readiness gaps with an observable operational consequence.

**Final V11 Definition of Done:** targeted readiness tests green, then one complete typecheck/lint/unit/integration/build/mobile/E2E gate after reseeding demo data.

---

## V12 — Production Hardening checkpoint

**Purpose:** make deployment safety and runtime dependency health explicit before the pilot release.

**Production invariants added in V12**
- Production configuration fails closed instead of silently using development fallbacks.
- Readiness and liveness are separate operational signals.
- Evidence uploads require an explicit persistent storage root in production.
- Session and notification-worker secrets are independent, non-placeholder and at least 32 characters.
- Public production origin is HTTPS; SMTP, Routes API and authenticated Expo push configuration are part of launch readiness.
- Integration tests are always followed by demo reseeding before browser tests in CI/repository verification.
- Notification delivery has an explicit scheduler command and runbook cadence.
- PostgreSQL backup creation, off-site copy and restore drills are documented launch responsibilities.
- Production migrations are forward-only with expand/migrate/contract rollback discipline.

**V12 Definition of Done:** production-hardening unit tests, typecheck/lint and targeted health/config checks green; one full repository gate before the V12 checkpoint. Real production credentials and infrastructure are validated in V13 Pilot & Launch Readiness, not committed to source control.

---

## V13 — Pilot & Launch Readiness checkpoint

**Purpose:** close the construction phase and produce a Diamond Shine v1 release candidate with explicit go/no-go evidence.

**Launch invariants added in V13**
- Demo seed scripts fail closed under `NODE_ENV=production` and require an explicit non-production target/override for remote production-like database names.
- Repository verification and deployed production verification are separate: the production gate never runs destructive integration tests or demo seeding against the live database.
- CI reseeds the complete demo scenario matrix after integration tests before browser E2E, matching the repository gate.
- Production smoke checks liveness, readiness and required browser security headers over the public origin.
- Dedicated pilot admin and employee credentials exercise real web authentication/capability access; the employee pilot also exercises and revokes a native bearer session.
- Release source verification requires a clean `main` synchronized with its upstream and can require the intended release tag at HEAD.
- Stable v1 promotion requires manual role walkthrough, real backup/restore evidence, persistent evidence durability, notification delivery/worker proof and a known rollback path.

**V13 Definition of Done:** source changes pass typecheck/lint/unit/targeted integration/E2E and one final repository gate. The resulting checkpoint is a v1 release candidate. Stable `v1.0.0` is promoted only after the manual/pilot sign-off described in `docs/LAUNCH_RUNBOOK.md`; post-sign-off bugs become regression fixes rather than a new mandatory foundation version.

---

## Post-RC Mobile Pilot Hardening — Android / iOS

**Decision:** Can a field worker execute assigned cleaning safely on Android/iOS with weak connectivity, while management roles remain review-oriented until shared Operations intelligence lands?

**Invariants added:**
- Expo Go may disable remote push, but must never block the rest of the app at bootstrap.
- Offline HTTP 207 is partial success, not total failure; processed mutations are retained server-side and removed locally while conflicts remain actionable.
- Offline queue causality is start/tasks/time → binary evidence → completion.
- Durable evidence is copied into app document storage before queueing and removed only after confirmed upload.
- A second account cannot silently inherit or delete another worker's pending offline workspace.
- Only actively assigned executable field roles receive cleaning-execution controls in the mobile UI.
- Operational wall-clock rendering follows authoritative organization/visit timezone rather than device timezone.

**Regression coverage:**
- tests/integration/mobile-pilot-hardening.test.ts: mobile role/timezone bootstrap, sync task metadata, binary evidence resolution by version task.
- npm run mobile:source-check: runtime import/safe-area/offline-causality/account-isolation/source contract.

**Manual pilot gate:** Android Expo Go, Android development build, iPhone development build, permissions denied/permanently denied, airplane-mode execution, reconnect conflict, app kill/reopen, account switch, session revocation, native push foreground/background/terminated.

---

## Pre-v1 — Schedule Intelligence & Service Continuity

**Purpose:** make recurring customer service obligations continuously visible before stable `v1.0.0`, independent from staffing availability.

**Invariants added**
- Service obligation, Visit, staffing, worker availability and acknowledgement are separate states.
- Recurring Jobs extend idempotently through a maintained horizon; missing occurrences are observable instead of silently absent.
- Default recurring team is persisted, but unavailable cleaners are skipped per occurrence and the Visit still exists as a coverage gap.
- Published Service Plans with no active schedule are explicit `UNSCHEDULED SERVICE`.
- Bounded Service Pause is scoped to client/site/job, previewed before mutation, preserves cancellation/audit history and never silently cancels `in_progress` work.
- Desktop Schedule, Manager Home, Field Control and manager/supervisor mobile consume the same server schedule-health API; `summary.attention` is the shared actionable issue count.
- Same-time visits for different cleaners are valid; only same-cleaner overlap is a conflict.
- Travel risk is not emitted until authoritative server route-duration data exists.

**Definition of Done:** migration + shared engine + APIs + desktop/mobile consumers + regression coverage green, followed by the complete repository `npm run verify` gate before commit/promotion.
