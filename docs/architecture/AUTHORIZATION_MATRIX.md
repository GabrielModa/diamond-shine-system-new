# Operations Core authorization matrix

Capabilities are additive and scoped. Role names are defaults, not authorization checks.

| Capability | Employee | Field supervisor | Scheduler | Stock controller | Quality inspector | Finance | Organization admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| View own assignments/sites | self/assigned | assigned/team | scoped region/sites | affected sites | inspection scope | no default | organization |
| Acknowledge assignment | self | self/team when delegated | read | no | no | no | organization override |
| Execute visit/tasks | self assigned | assigned/team | no | no | inspection only | no | override with reason |
| Capture evidence/incidents | assigned visit | scoped visits | read | supply evidence | quality evidence | no | organization |
| Start/edit own time | self | self | no | self activities | self activities | no | override with reason |
| Edit another worker's time | no | propose correction | no | no | no | approved scope | organization |
| Approve visit | no | scoped visits | no | no | quality gate if granted | no | organization |
| Approve time | no | scoped team | no | no | no | payroll scope | organization |
| Release payroll | no | no | no | no | no | payroll scope | organization |
| Manage schedule | availability only | scoped team changes | scoped region/sites | no | inspection schedule | no | organization |
| Manage clients/contracts/sites | no | site operational fields if granted | read | stock locations | read/quality | billing read | organization |
| Manage service plans | no | propose site changes | read | consumables section | quality/evidence section | pricing read | organization |
| View prices/invoices | no | no default | no default | purchase cost only | no | scoped finance | organization |
| Manage supply signals/needs | create/view own source | scoped view | impact read | full scoped workflow | read | cost/payment read | organization |
| View employee-sensitive GPS | own events | exception-only scoped | readiness only | no | no | approved time evidence | audited organization scope |
| Manage permissions/privacy | no | no | no | no | no | no | organization |

## Enforcement rules

- Route visibility is convenience only; every API/service mutation performs capability and scope checks.
- Organization scope is mandatory even for administrators.
- Site/contract scopes are resolved server-side from IDs; clients cannot submit trusted scope fields.
- Sensitive evidence access writes an audit event.
- Supervisor access never implies finance, global GPS, discipline, or permission-management access.
- Emergency override is a distinct capability and always requires reason, audit, and notification.

