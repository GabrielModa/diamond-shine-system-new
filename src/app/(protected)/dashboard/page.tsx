import Link from 'next/link'
import OpsIcon from '../../../components/ui/OpsIcon'

export default function DashboardMovedPage() {
  return <main className="page-shell dashboard-moved">
    <header className="page-header">
      <div><span className="eyebrow">Operations desk consolidated</span><h1>Work now lives in the workspace that owns it</h1><p className="muted">Nothing was removed. Supply processing, employee feedback and recent activity were moved into their permanent operational homes.</p></div>
    </header>
    <section className="dashboard-moved-grid">
      <Link className="card" href="/supplies"><span><OpsIcon name="box" /></span><div><h2>Supplies</h2><p>Requests, priority, triage, assignment, procurement, client notification and stock control.</p></div><b>Open supplies →</b></Link>
      <Link className="card" href="/feedback"><span><OpsIcon name="star" /></span><div><h2>Service feedback</h2><p>Employee ratings, rating categories, performance dimensions and full evaluation history.</p></div><b>Open feedback →</b></Link>
      <Link className="card" href="/home"><span><OpsIcon name="activity" /></span><div><h2>Command centre</h2><p>Today’s exceptions plus recent field, supply and feedback activity.</p></div><b>Open command centre →</b></Link>
    </section>
  </main>
}
