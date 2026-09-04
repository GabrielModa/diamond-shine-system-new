type VisitMutationSnapshot = {
  scheduledStart: Date
  scheduledEnd: Date
  dispatchNotes: string | null
  assigneeIds: string[]
}

function sameIdSet(left: string[], right: string[]) {
  const a = [...new Set(left)].sort()
  const b = [...new Set(right)].sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function normalizedNote(value: string | null | undefined) {
  const trimmed = value?.trim() ?? ''
  return trimmed || null
}

export function visitMutationRequiresNewAcknowledgement(
  current: VisitMutationSnapshot,
  next: VisitMutationSnapshot,
) {
  return current.scheduledStart.getTime() !== next.scheduledStart.getTime()
    || current.scheduledEnd.getTime() !== next.scheduledEnd.getTime()
    || normalizedNote(current.dispatchNotes) !== normalizedNote(next.dispatchNotes)
    || !sameIdSet(current.assigneeIds, next.assigneeIds)
}
