export const users = {
  admin: { email: 'admin@ds.ie', role: 'admin' as const, name: 'Admin' },
  supervisor: { email: 'super@ds.ie', role: 'supervisor' as const, name: 'Supervisor' },
  employee: { email: 'employee@ds.ie', role: 'employee' as const, name: 'Employee' },
  viewer: { email: 'viewer@ds.ie', role: 'viewer' as const, name: 'Viewer' },
}

export const supplies = {
  pendingUrgent: {
    employeeName: 'Emma Employee',
    clientLocation: 'TechCorp Office - Dublin 2',
    priority: 'urgent' as const,
    products: ['All-purpose cleaner', 'Rubber gloves'],
    notes: 'Need before 9am',
  },
  emailSentNormal: {
    employeeName: 'Emma Employee',
    clientLocation: 'Green Bank - Temple Bar',
    priority: 'normal' as const,
    products: ['Toilet paper', 'Bin bags'],
  },
  completedLow: {
    employeeName: 'Emma Employee',
    clientLocation: 'Blue Industries - Ballsbridge',
    priority: 'low' as const,
    products: ['Microfiber cloths'],
  },
}

export const feedback = {
  excellent: {
    employeeName: 'Emma Employee',
    clientLocation: 'TechCorp Office - Dublin 2',
    cleanliness: 5.0,
    punctuality: 5.0,
    equipment: 4.5,
    clientRelations: 5.0,
    comments: 'Outstanding work',
  },
  fair: {
    employeeName: 'Emma Employee',
    clientLocation: 'Red Company - Dun Laoghaire',
    cleanliness: 2.0,
    punctuality: 2.5,
    equipment: 2.5,
    clientRelations: 3.0,
  },
}
