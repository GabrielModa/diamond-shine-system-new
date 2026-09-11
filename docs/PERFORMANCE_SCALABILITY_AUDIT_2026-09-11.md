# Performance & scalability audit — 2026-09-11

## Executive conclusion

Diamond Shine is not fundamentally slow because of poor code or an obviously undersized database design. The current architecture is healthy enough for pilot/small-production use, but perceived latency is amplified by the way dynamic workspaces load: several client-side `no-store` API calls are issued after the page renders, and every API call performs its own authorization lookup against PostgreSQL.

A larger server can improve CPU-heavy endpoints and p95 consistency, but **server size alone is not the first lever**. The highest-return order is:

1. keep application compute and PostgreSQL in the same region and use the provider transaction pooler;
2. reduce browser-to-server/API round trips on dashboard-style pages;
3. index and simplify hot database paths;
4. reduce repeated full-list work in live endpoints;
5. measure current p50/p95 before changing infrastructure;
6. then compare the same workload on a larger/dedicated server.

The first low-risk hot-path fixes from this audit are included with this document.

## Current layer ratings

These are engineering ratings from source inspection and CI evidence, not a production load-test result.

| Layer | Rating | Why |
| --- | --- | --- |
| Code quality / correctness | **Good (B+)** | Strong TypeScript, Prisma schema, tenant filters, migrations, unit/integration/E2E gates and explicit operational state machines. |
| Browser / perceived performance | **Needs optimization (B-)** | Important pages are client components that fetch multiple dynamic APIs after render; nearly all operational fetches use `cache: 'no-store'`. |
| API design | **Good but chatty (B-)** | Endpoints are well scoped, but dashboard workspaces compose many API calls instead of using read-optimized aggregate/BFF endpoints. |
| Database design | **Good (B+)** | PostgreSQL with many useful composite indexes and explicit serverless pooling guidance. A few hot paths were missing matching indexes. |
| Live-operation scalability | **Moderate (B-)** | Polling plus large live/workforce responses is acceptable at current scale, but repeated scans and recalculation become expensive as team size grows. |
| Infrastructure readiness | **Good contract, live sizing unknown (B)** | Health timing, slow-query logging and pooler requirements exist. Function region, memory/CPU and production database region are not declared in source. |
| Network efficiency | **Needs optimization (B-)** | Request multiplication magnifies client RTT and app↔database RTT. An external render-blocking font request was also present. |

## Evidence from the current code

### 1. Request multiplication is the biggest perceived-latency risk

Examples from the current workspaces:

- Command Centre initial refresh: **7 APIs**.
- Supplies initial refresh: **5 primary APIs**.
- Manage Business / Operations: **5 APIs**.
- Schedule initial refresh: **4 primary APIs**.
- Communications manager view combines notice, recipient, site and settings/notification reads.

These are parallel where possible, which is better than a waterfall, but the page cannot become fully useful until the slowest dependency returns. Each request also repeats session/capability validation.

There is currently no application-level `unstable_cache` / revalidation strategy for these operational reads. That is appropriate for truly live state, but reference data such as team, sites, service plans and catalog items does not need identical freshness to timers/incidents.

### 2. Authorization is correct but expensive when multiplied

`getAuthUser()` resolves the session and then loads the user, active organization membership and capability grants from PostgreSQL.

That is safe and auditable. The cost appears when a single browser screen fires 5–7 APIs: access resolution is repeated for every HTTP request.

Two same-request duplicate authorization cases found by this audit are fixed in this branch:

- manager `GET /api/time-entries`;
- manager `GET /api/operational-notices?scope=all`.

The larger future win is not weakening authorization or trusting browser claims. It is reducing HTTP request count by moving summary work into purpose-built server read models/BFF endpoints.

### 3. Time and GPS hot paths needed matching indexes

Presence tracking runs every **2 minutes** while an active visit timer is running.

The heartbeat route queries the latest row by:

- organization;
- time entry;
- event kind;
- captured time descending.

The schema only had a visit-oriented location-event index. This branch adds the matching heartbeat index.

Manager timesheet/live queries commonly filter time entries by organization, status and time range. This branch adds both time-oriented and status-oriented composite indexes so PostgreSQL has useful access paths for the main review and live shapes.

### 4. Live Workforce did repeated full-list scans

The live endpoint loads users, current availability, relevant visits and running entries in parallel. It then previously did the following inside the loop for every employee:

- `temporaryAvailability.find(...)`;
- `visits.filter(...)`;
- `runningEntries.filter(...)`.

That creates repeated work proportional to users × visits/running entries.

This branch builds lookup maps once, making the association phase approximately linear in the loaded rows.

### 5. Some read endpoints are intentionally large

Current hard limits include:

- Workforce planning: up to **1,800 visits** and **3,000 time entries** in its calculation window.
- Live Workforce: up to **500 active visits** and **200 running entries**.
- Field Control: several independent lists capped around 100–300.
- Timesheets: **500 time entries**.
- Supplies manager workspace: requests up to **200**.

These caps prevent unbounded reads, but they are not cursor pagination. At larger customer/team sizes they create two risks:

1. responses and server work become heavy before the cap;
2. a hard cap can become a correctness problem if relevant rows exceed it.

### 6. Schedule Health is CPU-sensitive at larger scale

Schedule Health loads plans/jobs/visits/pauses and generates recurrence expectations in memory. Cleaner overlap detection is efficiently sorted with an early break, but worst-case overlap analysis still grows quickly when one worker has many overlapping windows.

This is fine for normal schedules. For very large organizations it should evolve toward incremental/materialized health state rather than full recomputation on every manager read.

### 7. Polling is reasonable today but multiplies with manager tabs

Current examples:

- Live Workforce: every **20 seconds**, plus focus refresh.
- Field Control: every **30 seconds**.
- Workforce planning: every **60 seconds**, plus focus/visibility refresh.

At small manager counts this is fine. At large manager counts, expensive endpoints are repeatedly recalculated even when little changed.

The future optimization should be one of:

- shared short-lived cache/read model;
- conditional refresh with version/ETag;
- push/event invalidation for genuinely live data.

### 8. Database connection placement matters more than raw CPU for many screens

The application explicitly supports `DATABASE_CONNECTION_MODE=pooled` and recommends a provider transaction pooler for Vercel/serverless production.

Production should verify:

- application function region;
- PostgreSQL primary/pooler region;
- pool saturation and wait time;
- health endpoint database latency p50/p95.

If app and database are in different regions, each DB-backed API pays that network RTT, and multi-API screens multiply the effect. Moving to a larger CPU without fixing region/pooling can leave the application feeling almost equally slow.

### 9. Frontend network cost

The web application previously imported Space Grotesk using a render-blocking Google Fonts stylesheet. This branch uses `next/font`, allowing Next to self-host the application font and removing that cross-origin stylesheet dependency.

The CI mobile web export currently reports a main Expo web entry bundle around **2.17 MB**. This does not describe the native app download/runtime directly, but it means the mobile web build should receive a separate bundle-splitting audit if that surface is intended for real browser use.

## Presence-check traffic model

The mobile app sends one presence request every 2 minutes during an active visit.

Approximate request rate:

| Simultaneously active visits | Presence requests / minute | Average requests / second |
| ---: | ---: | ---: |
| 50 | 25 | 0.42 |
| 100 | 50 | 0.83 |
| 500 | 250 | 4.17 |
| 1,000 | 500 | 8.33 |

The route also collapses stable classifications by updating the most recent heartbeat instead of inserting a new row every time, so database row growth is lower than request volume.

The request rate itself is manageable on ordinary modern infrastructure. The important parts are pooled DB connections, the new matching index, and avoiding unnecessary extra work in the heartbeat path.

## Would a better server make it faster?

### Raw CPU/RAM upgrade only

**Expected impact: low to medium.**

It helps endpoints that do non-trivial in-process calculation, especially Workforce, Schedule Health and Operational Insights. It does not remove:

- client↔server RTT;
- app↔database RTT;
- repeated authorization queries;
- 5–7 HTTP calls per screen;
- large JSON payloads.

### Same-region application + PostgreSQL + correct pooling

**Expected impact: high when currently misaligned.**

This can remove tens or hundreds of milliseconds from every DB-backed request. Because the UI often issues several requests per screen, the perceived improvement can be much larger than a CPU upgrade.

### Dedicated/long-lived Node server near the database

**Potential impact: medium to high for p95 consistency**, depending on current serverless behavior.

Benefits can include stable warm processes and more predictable connection reuse. It still needs bounded connection pools, horizontal scaling strategy and the same application/query optimizations.

A reasonable starting dedicated-server shape for the web/API tier after measuring is:

- **4 vCPU / 8 GB RAM**;
- Node.js 22;
- same EU region/metro as PostgreSQL;
- reverse proxy/CDN/TLS in front;
- transaction-pooled PostgreSQL runtime URL;
- at least two instances only when availability/traffic justifies it.

For a small pilot, 2 vCPU / 4 GB can be enough. Do not jump to 8–16 vCPU before p95 CPU/DB metrics prove compute is the constraint.

## Scale outlook

This is an engineering estimate, not a benchmark guarantee.

### Current small/medium operation

Tens of managers and roughly 50–150 simultaneously active field workers should be a comfortable target **if** database pooling and region placement are correct.

### Several hundred active workers

The current design can still work, but the first pressure points will be:

1. Live Workforce polling/recalculation;
2. Field Control polling;
3. Workforce planning payload size;
4. multi-request manager dashboards;
5. time/location history volume.

### 1,000+ active field workers / many simultaneous managers

Before targeting this level, implement:

- read-optimized aggregate endpoints;
- cursor pagination for history/list endpoints;
- short-lived caching/materialized operational summaries;
- event/version-based live refresh instead of unconditional polling;
- production load testing and DB pool monitoring;
- separate workers for background/notification/recalculation workloads as volume justifies it.

## Reproducible server comparison

The repository now provides:

```bash
npm run observability:performance-baseline
```

Minimum health-only run:

```bash
PERFORMANCE_BASE_URL="https://your-host" \
PERFORMANCE_SAMPLES=20 \
npm run observability:performance-baseline
```

Authenticated read-only operational sampling:

```bash
PERFORMANCE_BASE_URL="https://your-host" \
PERFORMANCE_EMAIL="performance-test-admin@example.com" \
PERFORMANCE_PASSWORD="..." \
PERFORMANCE_SAMPLES=20 \
npm run observability:performance-baseline
```

Optional light concurrency:

```bash
PERFORMANCE_CONCURRENCY=5
```

Keep production concurrency low. Use staging/isolated production-like data for higher load.

The output reports per endpoint:

- successes/failures;
- p50 latency;
- p95 latency;
- maximum latency;
- median response bytes;
- HTTP statuses.

Run the exact same command against the current Vercel deployment and any candidate server. That comparison is much more useful than comparing advertised CPU/RAM.

## Prioritized next performance work

### P0 — measure before infrastructure change

- Run the performance baseline from an Ireland/production-like network.
- Record `/api/health` database p50/p95.
- Verify Vercel/function region and PostgreSQL pooler region are co-located.
- Confirm `DATABASE_CONNECTION_MODE=pooled` in serverless production.
- Review `slow_db_operation` logs.

### P1 — reduce round trips

Create read-optimized endpoints for:

- Command Centre;
- Supplies overview;
- Schedule bootstrap/reference data.

One browser request should resolve authorization once and execute necessary DB work in parallel on the server.

### P1 — paginate/history boundaries

Add cursor or date-bounded pagination to:

- time entries;
- visits/history;
- operational notices;
- sites/service plans where organization size warrants it.

### P1 — cache reference data safely

Short-lived/invalidation-aware caching candidates:

- team members;
- sites;
- service plans;
- material catalog.

Do not cache running timers, incidents or mutable execution state with the same policy.

### P2 — live read models

If live manager usage grows, maintain compact operational snapshots/version tokens so 20–30 second polling does not fully rebuild state for every browser.

### P2 — load test before a major customer rollout

Test authenticated, read-heavy mixes at increasing concurrency and record:

- HTTP p50/p95/p99;
- error rate;
- DB query p95;
- pool saturation/wait time;
- CPU and memory;
- response size;
- function/server concurrency.

Do this against both the current host and any proposed replacement using the same database region and dataset.


## Implemented second-pass read-model optimizations

The follow-up optimization pass moved the most request-heavy workspaces onto purpose-built read models while preserving server-side capability checks:

- **Command Centre:** 7 browser API requests → 1 aggregate request.
- **Schedule bootstrap:** 4 browser API requests → 1 bounded request; visit-conflict lookup is precomputed instead of rescanning all visits per card.
- **Supplies bootstrap:** up to 5 browser API requests → 1 compact request; selectors no longer hydrate full Site records.
- **Role Home:** 3 list reads → 1 compact summary request.
- **Operations / Service Setup:** 5 browser API requests → 1 capability-aware bootstrap.
- **Quality Control:** 2 initial reads → 1 by reusing the site data already returned by the control model.
- **Communications:** core inbox/broadcast bootstrap goes from 4 reads → 1. Administrator-only delivery configuration remains separately loaded because settings, queue diagnostics and editable templates have distinct authorization and initialization semantics.
- **Protected server pages:** membership/capability resolution is memoized for the request and shared by the protected layout and pages that request the same access context.

Operational Insights was also changed to group site signals once instead of repeatedly filtering every source collection for every site, and additional PostgreSQL indexes were added only where they match current operational filter/order paths.

These changes intentionally avoid long-lived caching of timers, GPS, incidents, acknowledgement state or other live operational facts.
