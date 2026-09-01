'use client'

import { useState } from 'react'
import WorkforceLiveNow from './WorkforceLiveNow'
import WorkforceWorkspace from './WorkforceWorkspace'
import styles from './WorkforceLiveNow.module.css'

type Mode = 'live' | 'plan'

export default function PeopleControlWorkspace() {
  const [mode, setMode] = useState<Mode>('live')

  return <>
    <div className="page-shell">
      <header className={styles.hero}>
        <div>
          <span className="eyebrow">People control</span>
          <h1>{mode === 'live' ? 'What is happening right now?' : 'Plan the next move'}</h1>
          <p>{mode === 'live'
            ? 'See active work, upcoming starts, schedule-based school context and operational exceptions without confusing expected locations with live work-session checks.'
            : 'Use workforce capacity, home or school origins, service coverage and routing to plan future work.'}</p>
        </div>
        <div className={styles.modeSwitch} role="tablist" aria-label="People control mode">
          <button type="button" role="tab" aria-selected={mode === 'live'} className={mode === 'live' ? styles.active : ''} onClick={() => setMode('live')}>● Live now</button>
          <button type="button" role="tab" aria-selected={mode === 'plan'} className={mode === 'plan' ? styles.active : ''} onClick={() => setMode('plan')}>◷ Plan ahead</button>
        </div>
      </header>
    </div>

    {mode === 'live'
      ? <main className="page-shell"><WorkforceLiveNow /></main>
      : <div className={styles.planMode}><WorkforceWorkspace /></div>}
  </>
}
