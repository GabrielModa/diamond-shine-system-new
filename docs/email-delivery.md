# Email delivery diagnostics and retries

Employee actions persist a notification job and return without awaiting SMTP. Production Next.js `after()` attempts the first delivery after the response. The existing lease, atomic claim, exponential backoff and attempt limit remain authoritative. A thrown delivery error now follows the same persisted failure/retry path as `{ ok: false }`.

## Diagnostics

All shared notification mailers return sanitized failures. Known Nodemailer codes (authentication, connection, DNS, TLS, envelope/message rejection) and numeric SMTP failure status are retained. Raw messages, responses, stacks, auth payloads and connection URLs are deliberately excluded because providers may echo credentials. Unknown failures have a safe fallback; this is not a complete SMTP transcript.

Communications → Delivery settings shows queue counts, exhausted jobs and the latest failure. Historical error strings are sanitized again before returning them to the browser. Existing recipient settings and the operational test override retain their original meaning.

The admin-only **Test email delivery** action verifies the actual configured SMTP transport and sends one small email to the authenticated administrator's account email. Request bodies cannot choose another recipient. This explicit diagnostic bypasses the JSON transport used by automated tests. SMTP acceptance is not proof of inbox receipt: check the mailbox and spam folder. No account, recipient setting or queued production job is changed by the diagnostic.

## Production configuration

- Keep `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM` and paired `SMTP_USER` / `SMTP_PASS` configured for the existing provider. Do not use `EMAIL_TRANSPORT=json` in production.
- Add `CRON_SECRET`, an independent random secret of at least 32 characters, to the Vercel Production environment and redeploy. Do not reuse `SESSION_SECRET` or `NOTIFICATION_WORKER_SECRET`.
- Keep `NOTIFICATION_WORKER_SECRET` for the existing POST worker; its authentication is unchanged.
- Vercel calls `GET /api/internal/notifications/cron` with `Authorization: Bearer <CRON_SECRET>`. The route fails closed if configuration or authorization is missing/invalid and processes up to 20 due jobs per invocation. Unexpected processing failures return a safe HTTP 500.
- `vercel.json` defaults to `0 1 * * *` (daily at approximately 01:00 UTC) because the connected account did not expose the project's plan. This is compatible with Hobby and avoids deploying an unsupported frequent schedule. This daily fallback can delay retries by a day or more and is not a five-minute delivery guarantee.
- On a confirmed Pro/Enterprise project, change the schedule to `*/5 * * * *` before deployment for five-minute retries. On Hobby, frequent recovery requires a separately configured scheduler calling the existing authenticated POST endpoint every 1–5 minutes.
- Confirm the cron is enabled on the production deployment and inspect its execution history. Preview deployments do not schedule production cron runs.

The Vercel endpoint has a 60-second invocation budget. Work interrupted by a function timeout remains recoverable after the existing ten-minute processing lease. Delivery is at least once: a crash after SMTP acceptance but before persistence, or partial delivery to multiple recipients, can cause duplicates on retry, as before.

Vercel references: [limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [authentication and execution](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
