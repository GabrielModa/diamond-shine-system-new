'use client'

import WorkforceLiveNow from './WorkforceLiveNow'
import WorkforceWorkspace from './WorkforceWorkspace'
import styles from './WorkforceLiveNow.module.css'

type Mode = 'live' | 'plan'

export default function PeopleControlWorkspace({ mode }: { mode: Mode }) {
  return <>
    <div className={`${styles.workspaceHeader} page-shell`}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className="eyebrow">{mode === 'live' ? 'Live workforce' : 'Workforce planning'}</span>
          <h1>{mode === 'live' ? 'Live operations' : 'Plan coverage'}</h1>
          <p>{mode === 'live'
            ? 'Track active work, upcoming starts and exceptions. Live GPS stays separate from schedule-based expectations.'
            : 'Plan future coverage directly using capacity, schedule context, home or school origins and service-site routing.'}</p>
        </div>
      </header>
    </div>

    {mode === 'live'
      ? <main className="page-shell"><WorkforceLiveNow /></main>
      : <WorkforceWorkspace initialTab="coverage" showViewTabs={false} showHeader={false} />}
  </>
}
