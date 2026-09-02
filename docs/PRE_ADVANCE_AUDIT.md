# Pre-advance sanity audit — working evidence

Branch: `fix/schedule-health-actions`. Baseline: `ea20122`.
This is a working audit, not a certification of complete browser QA.

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

## Confirmed weaknesses queued for correction

- Health context depends on Referer instead of explicit React/API data flow.
- Board and Health requests have no stale-response protection.
- URL context applied once cannot follow Back/Forward.
- Capacity failures silently become an empty result; successful mutations do not invalidate same-key capacity.
- Integration cleanup accepts `CI=true` or an override as permission to erase a non-test database.

## Validation policy

Do not seed or reset the development/demo database. Run read-only demo checker and unit/type checks first. Integration and browser mutation tests require a verified isolated database. Preserve unrelated `next-env.d.ts`.
