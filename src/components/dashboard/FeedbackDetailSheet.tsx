'use client'

import type { FeedbackEntry } from '../../types'

const CATEGORY_EMOJI: Record<string, string> = {
  Excellent: '🏆',
  'Very Good': '👍',
  Good: '✅',
  Fair: '⚠️',
  Poor: '❌',
}

type FeedbackDetailSheetProps = {
  open: boolean
  entry: FeedbackEntry | null
  onClose: () => void
}

export function FeedbackDetailSheet({ open, entry, onClose }: FeedbackDetailSheetProps) {
  if (!entry) return null

  const categoryEmoji = CATEGORY_EMOJI[entry.category] ?? ''

  return (
    <div
      id="detailOverlay"
      className={`overlay${open ? ' active' : ''}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="overlay-sheet detail-sheet fade-up">
        <div className="sheet-header">
          <h2>⭐ Evaluation</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="detail-grid">
          <div className="detail-item">
            <div className="detail-label">Evaluation ID</div>
            <div className="detail-value">{entry.id}</div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Employee</div>
            <div className="detail-value">{entry.employeeName}</div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Location</div>
            <div className="detail-value">{entry.clientLocation}</div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Overall Rating</div>
            <div className="detail-value">
              {entry.overall.toFixed(1)} · {entry.category} {categoryEmoji}
            </div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Cleanliness</div>
            <div className="detail-value">{entry.cleanliness.toFixed(1)}</div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Punctuality</div>
            <div className="detail-value">{entry.punctuality.toFixed(1)}</div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Equipment</div>
            <div className="detail-value">{entry.equipment.toFixed(1)}</div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Client Relations</div>
            <div className="detail-value">{entry.clientRelations.toFixed(1)}</div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Date</div>
            <div className="detail-value">{new Date(entry.createdAt).toLocaleString('en-IE')}</div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Submitted by</div>
            <div className="detail-value">{entry.submittedBy}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
