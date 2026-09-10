# Notification role policy

Diamond Shine should notify the person who can act on the event, not every user who can see the underlying record. Email is an escalation channel; routine state remains in the product UI. The organization membership role is authoritative.

## Principles

- Employee-facing changes go to the affected employee only.
- Operational escalations go to roles that have the capability to act on that domain.
- Read-only viewers do not receive proactive operational email.
- Organization admins are governance/fallback recipients, not a substitute for domain ownership.
- Configured Delivery settings may redirect domain escalation inboxes without changing user accounts.
- `operational_email_override` is a testing override. When blank, workflow-selected recipients are used.
- Never expose recipient lists to other recipients; operational email is sent separately per address.

## Role audiences

| Role | Should receive proactively | Should not receive by default |
| --- | --- | --- |
| Organization admin | Critical organization/security changes, operational escalations, unresolved exceptions, fallback when no domain owner exists | Every routine success event merely because the role is admin |
| Field supervisor | Shift confirmations/declines, staffing/availability changes, field incidents, time corrections, quality/rework, urgent supply exceptions | Finance-only or organization-security noise unrelated to field operations |
| Scheduler | Assignment confirmations/declines, availability/study/home-routing changes, schedule/service changes that affect staffing | Time correction decisions, routine supply requests, quality-only updates, finance/payroll |
| Employee / cleaner | Own assignment/new work/change/cancellation, own time correction result, own account/employment changes, updates to incidents they reported, rework assigned to them | Manager escalation mail, other employees' information |
| Stock controller | Supply requests, replenishment/low-stock alerts and stock exceptions | Shift confirmations, employee availability, time/quality/account events |
| Quality inspector | Failed inspections, corrective actions, incidents and rework/service-quality exceptions | Shift confirmations, supply-only alerts, payroll/time administration |
| Finance | Time correction requests requiring team review, payroll/release and finance exceptions | Shift confirmations, staffing availability, supply and quality alerts |
| Viewer | No proactive operational email | All action-required workflow mail; viewer is read-only |

## Event routing

- Shift confirmation / decline -> organization admin, field supervisor, scheduler.
- Employee availability, school/study or routing-relevant profile changes -> organization admin, field supervisor, scheduler.
- Time correction request -> organization admin, field supervisor, finance.
- Time correction resolution -> affected employee.
- Incident reported -> organization admin, field supervisor, quality inspector; the affected reporter receives later resolution updates.
- Supply request / low-stock replenishment -> configured Supply alerts inboxes; role fallback should be organization admin, field supervisor, stock controller.
- Feedback / failed quality inspection / corrective action -> configured Quality alerts inboxes; role fallback should be organization admin, field supervisor, quality inspector.
- New assignment, visit changes/cancellation, service pause and rework -> affected assigned employees.
- User role/status/identity/employment setting changes -> affected user; organization governance remains in audit unless a separate action is required.
- Invitations/password reset -> target user only.

## Current implementation notes

Operational audit emails already select concrete workflow recipients and the operational mailer applies the optional test override at final delivery. Supply and quality escalation inboxes remain explicitly configurable in Communications -> Delivery settings.

Legacy `profile_change_alert` jobs historically embedded manager email addresses directly and used a separate mailer. That bypassed the operational test override and caused delivery bounces when seeded/demo manager addresses were not real mailboxes. These jobs are now delivered through the standard operational email path so the same override, privacy and SMTP diagnostics apply.

A later refinement can replace domain inbox configuration with role-based fallback when an organization has active stock-controller, quality-inspector or finance memberships. Until those roles are actually provisioned with real addresses, explicit configured inboxes are safer than silently mailing seeded/demo accounts.
