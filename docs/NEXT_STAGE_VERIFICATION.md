# Next stage — linked operational verification

Continue on `fix/schedule-health-actions` (or an explicitly requested successor). Read `docs/PRE_ADVANCE_AUDIT.md` and current git log first. Preserve existing changes, especially generated next-env.d.ts. Do not redesign or reintroduce DOM-driven state synchronization.

The closeout fixes employee/date/view propagation, scoped Health/Capacity, stale responses, staffing coverage, workforce timezone checks, safe integration schemas, completed offline sync snapshots and heartbeat build typing. Do not undo the distinction between operational mutations and authorized completed-history reads.

1. Use a disposable seeded environment, not the normal development schema. The current demo checker reports Liffey 2/2 where the deterministic scenario expects 0/2. Do not erase the user's current assignments to make the checker pass.
2. At 100% zoom, desktop and narrow viewport, verify persisted create, assign, edit, cancel, remind, conflict resolution, missing occurrence generation, pause and end-pause. Check cards, counters, active drawer and preserved search/date filters without F5.
3. Force API failure and stale-version 409: keep editor/drafts, no success toast, actionable error. Check Escape closes only the top surface, no reopen, backdrop does not apply drafts, background inert.
4. Verify linked mobile execution: start → task/evidence → explicit clock-out → submission → sync bootstrap. Completed records must remain readable to assigned users but not become editable or accessible after assignment removal. Check live GPS versus start GPS versus expected site/school and stale-device behavior.
5. Test Europe/Dublin midnight and DST; school, leave, recurring/temporary restrictions; clarify site-specific travel/buffer feasibility before treating Capacity results as a route guarantee.
6. Check large result sets, pagination, and UI navigation/discoverability of pause/resume. Add targeted regressions for any confirmed defect.
7. Run `npm run test:unit`, `npx tsx scripts/run-schedule-audit-integration.ts`, `npm run build`, `npm run typecheck`, and targeted Schedule Playwright against the new build. Isolated integration runner retains its unique schema; never use CI/override to bypass database safety.
8. Report exact commands/results, screenshots of defects, actual persistence versus mocked browser coverage, commits and meaningful residual risks. Do not call a partially verified product fully certified.
