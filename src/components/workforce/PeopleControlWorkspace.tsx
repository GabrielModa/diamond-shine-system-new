'use client'

import { useState } from 'react'
import WorkforceLiveNow from './WorkforceLiveNow'
import WorkforceWorkspace from './WorkforceWorkspace'
import WorkforceLiveIcon from './WorkforceLiveIcon'
import styles from './WorkforceLiveNow.module.css'

type Mode = 'live' | 'plan'

export default function PeopleControlWorkspace() {
  const [mode, setMode] = useState<Mode>('live')

  return <>
    <div className={`${styles.workspaceHeader} page-shell`}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className="eyebrow">People control</span>
          <h1>{mode === 'live' ? 'Live operations' : 'Plan ahead'}</h1>
          <p>{mode === 'live'
            ? 'Track active work, upcoming starts and exceptions. Live GPS is kept visually separate from schedule-based expectations.'
            : 'Plan future coverage using capacity, schedule context, home or school origins and service-site routing.'}</p>
        </div>
        <div className={styles.modeSwitch} role="tablist" aria-label="People control mode">
          <button type="button" role="tab" aria-selected={mode === 'live'} className={mode === 'live' ? styles.active : ''} onClick={() => setMode('live')}>
            <WorkforceLiveIcon name="live" />
            <span>Live now</span>
          </button>
          <button type="button" role="tab" aria-selected={mode === 'plan'} className={mode === 'plan' ? styles.active : ''} onClick={() => setMode('plan')}>
            <WorkforceLiveIcon name="calendar" />
            <span>Plan ahead</span>
          </button>
        </div>
      </header>
    </div>

    {mode === 'live'
      ? <main className="page-shell"><WorkforceLiveNow /></main>
      : <div><WorkforceWorkspace /></div>}
  </>
}
