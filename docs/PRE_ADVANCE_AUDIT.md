# Pre-advance sanity audit — handoff evidence

Branch: `fix/schedule-health-actions`. Baseline: `ea20122`.
Audit date: 2026-09-02. This report distinguishes verified fixes from remaining validation; it is not a production certification.

## Context propagation map (before fixes)

| Concept | Source / URL / React state | API and server filtering | UI, counts, details, empty state, actions |
|---|---|---|---|
| Employee | Membership/user; `employee`; Board teamFilter | Board fetches all, Health reconstructs from Referer | Calendar and top count scoped locally; Health indirectly scoped; Finder independently defaults to all |
| Date/range | Organization timezone; `date`; anchorDate | visits/availability wide range; Health visible range | Local calendar window; URL applied once; navigation does not update URL |
| View | Local week/day/month/list; no URL synchronization | Same board fetch, different Health range | Calendar and list derive range; list title incorrectly describes a day |
| Health focus | Board healthFocus and Panel filter separately | Health returns all categories for range | Panel callback narrows board; board tabs do not reset Panel selection |
| Assignment status | VisitAssignment; no URL | Shared lifecycle constant in APIs | Board duplicates active statuses; selected employee confirmation/conflict checks already fixed |
| Visit status | Visit.status | APIs exclude completed/cancelled/missed for operational work | Board history is separate; repeated status arrays risk drift |
| Availability | Availability + workforce profile | Capacity and PATCH query constraints | Finder server-backed; Board precheck only overlaps/temporary availability, final PATCH remains authoritative |
| School | Study schedules + holidays, org timezone | workforceConstraintForWindow / resolveWorkforceContext | Live expected-school state; Plan Ahead uses shorter school wording |
| Leave | WorkforceLeave | Shared workforce context/window checks | Live unavailable; future capacity restricted; no URL |
| Recurring restrictions | RecurringUnavailability | Shared workforce context/window checks | Live and Plan Ahead derive contextual state |
| Live GPS | Latest LocationEvent on running TimeEntry | workforce/live selects latest descending event | signal freshness separate from mapPoint.kind; stale coordinates still typed live_gps; inspect rendering before changing contract |
| Expected location | Site/school coordinates + schedule | workforce/live fallback only without GPS coordinates | Distinct expected_visit_site / expected_school kinds; must not label as observed GPS |
| Timer | Running TimeEntry | Live filters visit timers; Field Control queries entries and events | Live action carries visit; duplicate running entries flagged; cross-screen freshness needs browser verification |
| Acknowledgement | Assignment status | Health scopes pending visit IDs; PATCH resets material-change acknowledgements | Employee filter now checks own assignment; reminder still acts on whole visit, so label must disclose team-wide action |

## Initial confirmed weaknesses (corrected)

- Health context depends on Referer instead of explicit React/API data flow.
- Board and Health requests have no stale-response protection.
- URL context applied once cannot follow Back/Forward.
- Capacity failures silently become an empty result; successful mutations do not invalidate same-key capacity.
- Integration cleanup accepts `CI=true` or an override as permission to erase a non-test database.

## Validation policy

Do not seed or reset the development/demo database. Run read-only demo checker and unit/type checks first. Integration and browser mutation tests require a verified isolated database. Preserve unrelated `next-env.d.ts`.

## 1. Executive summary

Schedule now propagates employee/date/view explicitly through URL, React state, Health and Capacity. Stale responses are cancelled or ignored, and successful mutations invalidate dependent data. Workforce coverage and scheduling eligibility share operational semantics. The closeout also fixes a completed-visit sync regression and a nullable visit reference that blocked the current build. No development data was reset.

The branch already contained the earlier audit commits and merged field-execution changes when this closeout began. Those changes were preserved, not recreated. Demo fixture drift remains separate from code correctness: the latest read-only checker reports Liffey staffed 2/2 instead of the fixture's expected 0/2.

## 2. Confirmed bugs

| Severity | Area | Bug / reproduction | Why it matters | Fix |
|---|---|---|---|---|
| P1 | Integration safety | CI/override could bypass safe-database checks | Destructive test cleanup could target normal data | Explicit dedicated database/schema validation; isolated audit runner |
| P1 | Workforce coverage | Assign one of two required workers; site appeared covered | People and Health disagreed about staffing | Compare active assignments with requiredWorkers |
| P1 | Eligibility | School window in organization timezone; visit in another timezone | Capacity and PATCH could disagree | Organization timezone for workforce constraints |
| P2 | Schedule context | Switch A to B or use Back; Health/Finder could retain different context | Wrong operational scope | Explicit URL/state/API context and stale-response protection |
| P2 | Health focus | Change board tab after selecting Health focus | Drawer and board represented different filters | Controlled Health focus |
| P2 | Capacity | API failure looked like no available slots | Failure mistaken for valid business result | Visible error/loading; refresh invalidation |
| P2 | Live wording | Unconfigured person appeared available; expected school/start GPS insufficiently qualified | Misleading staffing/location decision | Setup-required state; precise expected/start-location labels |
| P2 | Partial team | Edit note/time with an incompletely staffed visit | Client unnecessarily blocked valid PATCH | Allow partial coverage; server remains authoritative |
| P2 | Offline sync | Complete offline visit, then GET sync window | Completed result disappeared from reconciliation snapshot | Read-only bootstrap retains completed assigned visits; mutations remain gated |
| P2 | Build | Build merged heartbeat handler | TypeScript lost nullable-property narrowing in transaction callback | Capture validated visit before callback |

## 3. Two-truths findings

- Employee-scoped calendar versus indirect/global Health: replaced Referer reconstruction with explicit employee/unassigned query parameters.
- Current URL versus old React state after Back: derived Schedule context from current search parameters.
- People site marked covered versus Health short-staffed: both now account for required worker count.
- Capacity versus PATCH school timezone: workforce checks use organization timezone.
- Previous employee/range response versus current controls: request cancellation and scope/revision guards prevent stale replacement.
- Offline completion success versus missing completed snapshot: bootstrap includes completed records while preserving assignment access restrictions.
- Operational work and completed-history reads are intentionally different. Completed visits do not consume future operational capacity, but remain eligible for authorized offline reconciliation.

## 4. State/context propagation

The table above records the pre-fix map. Current Schedule flow is URL employee/team/date/view → useScheduleContext → board and controlled Health focus → explicit Health/Capacity requests. Creation and finder actions inherit employee/date. Save operations refresh board and Health through React state, not DOM events. Reminder copy explicitly states that it targets the pending visit team. Health lists no longer silently truncate at 120 items. List period labels/navigation use the same monthly range as their data.

## 5. Business-rule duplication

- Board assignment/visit classification now uses shared assignment-lifecycle helpers.
- Coverage uses activeAssignmentCount and requiredWorkers.
- Capacity and PATCH retain server-side workforce-window validation; browser prechecks are advisory, not an alternative authority.
- Workforce restrictions and recurrence allocation use organization timezone; recurrence itself can retain its configured timezone.
- GPS-at-start is not interchangeable with latest live GPS. Labels distinguish these facts rather than forcing them into one state.
- Route-aware travel/buffer feasibility is not established by the current site-less Capacity query. Do not advertise Capacity results as a guaranteed travel-feasible assignment.

## 6. Implemented changes and commits

| Commit | Files / area | Before → after |
|---|---|---|
| `9eb1314` | tests/integration/database-safety.ts, setup.ts, destructive fixture hooks, scripts/run-schedule-audit-integration.ts | Permissive cleanup → explicit safe target and fresh isolated schema |
| `3620821` | workforce API/live, visits PATCH, scheduling/default-team.ts, WorkforceWorkspace/LiveNow, FieldControlBoard | Partial coverage/timezone/stale response ambiguity → consistent coverage, constraints and wording |
| `402ca62` | schedule-context.ts, useScheduleContext.ts, ScheduleBoard, ScheduleHealthPanel, useScheduleCapacity, schedule-health API/scope, targeted tests/config | One-shot/indirect context → explicit synchronized URL/state/request lifecycle |
| `a17df96` | api/sync/route.ts, tests/integration/execution.test.ts, isolated runner | Completed snapshot filtered out → completed result retained, revoked assignment still excluded; clock-out fixtures aligned |
| `a17df96` | api/time-entries/[id]/heartbeat/route.ts | Nullable callback reference → validated local reference; no runtime rule weakened |

## 7. Regression coverage and execution

Earlier runs passed 221 unit tests, 24 integration tests and 20 Schedule browser tests. Those results belonged to the earlier version, not automatically to the merged branch. Earlier failures included a cold-server 5-second integration timeout and managed browser-server shutdown hangs; they are not counted as passing runs. The isolated runner now uses a 30-second test timeout. Browser closeout uses an independently started server.

The sync regression test checks the exact completed visit, task result and two location events, then revokes the assignment and verifies the snapshot excludes it. Three execution tests were updated to stop the work timer explicitly before testing evidence/incident/rework completion. A new assertion confirms submission while the timer is running still returns VISIT_TIMERS_STILL_RUNNING. This matches the merged product rule without weakening validation.

Current closeout commands/results:

| Command | Result |
|---|---|
| `npm run test:unit` | PASS, 226 tests / 36 files |
| `npm run build` | Initial TS18047 in heartbeat callback; fixed and rerun PASS |
| `npm run typecheck` | PASS |
| `npx tsx scripts/run-schedule-audit-integration.ts` | Isolated schema `integration_audit_c6a04c7667c34750b621441e3fa1b288`: scheduling 5, workforce 11, hardening 4, capacity 4, continuity 8 passed. Execution 11/14; three fixtures omitted newly required clock-out. No development reset. |
| `npm run db:check:demo` | FAIL fixture expectation: Liffey expected 0/2, found 2/2. Data preserved. |
| `npx tsx scripts/run-schedule-audit-integration.ts execution` | PASS 14/14 after fixture corrections, schema `integration_audit_91e7ea1432bb4f7e896b7b5125ae9c59`. Total across six targeted suites: 46 passing tests. |
| `$env:PLAYWRIGHT_REUSE_SERVER='1'; npx playwright test --config=playwright.audit.config.ts --reporter=list` | PASS 20/20, desktop Chrome and Pixel 7, 1.4 minutes, exit 0, current production build |
| `git diff --check` | PASS (line-ending notices only) |

Screenshots from the deterministic employee-scope browser fixture: [mobile](audit-evidence/schedule-scope-mobile.png), [desktop](audit-evidence/schedule-scope-desktop.png). The mobile screenshot was visually reviewed: header, close control, filters and action fit the viewport; the removed legacy pseudo-heading no longer overlaps the header. These screenshots use mocked Audit Beta data, not proof of persisted assignment changes.

Browser server command (PowerShell): `$env:PORT='3100'; $env:EMAIL_TRANSPORT='json'; $env:SESSION_SECRET='playwright-only-session-secret-with-32-characters'; node node_modules/next/dist/bin/next start`. The session secret is a test-only value, not a production credential.

Browser coverage includes employee A → B → All → Back, Health/Capacity scope, rejected PATCH 409 retaining draft values without success, successful mocked mutation refresh, Escape and narrow viewport geometry. Mocked mutation tests establish client refresh behavior, not database persistence; real mutation persistence is covered separately by integration tests.

## 8. Remaining risks and next-stage boundaries

- Latest demo checker fails its deterministic fixture expectation (Liffey 2/2 instead of 0/2). Preserve current demo work; re-seed only a separate disposable environment for deterministic scenario QA.
- Full production-scale pagination and endpoint record limits have not been load-tested.
- Browser QA does not establish all live-device GPS freshness, mobile offline transport and travel/buffer scenarios. These need linked device/server validation.
- Backend pause/resume coverage does not by itself prove discoverability and every navigation path in the UI.
- Audit schemas are deliberately retained for diagnosis. Cleanup is a separate explicitly scoped operation, not a reset of the development schema.
- This closes the verified changeset, not an assertion that every possible cross-module scenario has been exhaustively certified. See NEXT_STAGE_VERIFICATION.md before expanding functionality.
