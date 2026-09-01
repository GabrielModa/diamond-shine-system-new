# Schedule — next-stage verification prompt

Continue on branch `fix/schedule-health-actions`. Preserve unrelated changes, especially generated `next-env.d.ts` changes.

The Schedule/Dispatch/Workforce audit removed DOM-driven synchronization (`MutationObserver`, synthetic button clicks, and the global date-input guard). Schedule mutations now explicitly refresh both board data and health data through React state. General errors render as errors rather than success toasts. Capacity Finder tolerates an empty native date input without throwing. Health filters and drawers are no longer reset through a keyed remount.

Next stage:

1. Run the app with seeded demo/scenario data and perform browser QA at 100% zoom on desktop and narrow viewport.
2. Verify create visit, assign team, edit time/team, cancel visit, send acknowledgement reminder, resolve conflict, generate missing occurrence, pause service, and end pause.
3. After every successful mutation, confirm cards, counters, active health drawer, search/date filters, and all schedule views update without F5.
4. Force API failures and stale-version `409` responses. Confirm the editor stays open, values remain intact, no success toast appears, and the error is actionable.
5. Verify Escape closes exactly one topmost surface and never reopens it; clicking the backdrop closes without applying draft filters; background content stays inert/locked.
6. Check Europe/Dublin boundaries around midnight and DST, plus workforce school, leave, recurring-unavailability, travel/buffer, and overlap constraints.
7. Add/extend Playwright coverage for the successful mutation-to-health-refresh path and the failed mutation path.
8. Re-run `npm run typecheck`, schedule/workforce unit tests, scheduling/workforce integration tests, and the targeted Schedule Playwright spec.

Do not reintroduce DOM querying, `MutationObserver`, synthetic clicks, or hidden browser events as a state synchronization mechanism. Report exact commands, results, residual risks, and screenshots for any visual defect.
