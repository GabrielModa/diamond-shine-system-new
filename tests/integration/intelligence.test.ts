import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { cleanOperations, getAuthCookie, seedUsers } from './setup'

let app: ReturnType<typeof createServer>
let nextApp: ReturnType<typeof next>
let adminCookie: string

beforeAll(async () => {
  nextApp = next({ dev: true, dir: process.cwd() })
  await nextApp.prepare()
  app = createServer((req, res) => nextApp.getRequestHandler()(req, res, parse(req.url!, true)))
  await cleanOperations(); await seedUsers(); adminCookie = await getAuthCookie('admin@ds.ie')
})
afterAll(async () => { await cleanOperations(); await nextApp.close() })

describe('operations intelligence', () => {
  it('turns an uncovered future visit into an actionable site risk', async () => {
    const client = (await request(app).post('/api/clients').set('Cookie', adminCookie).send({ displayName: 'Intelligence Client' })).body.data
    const site = (await request(app).post('/api/sites').set('Cookie', adminCookie).send({ clientId: client.id, name: 'Risk Radar Site', addressLine1: '1 Radar Road', city: 'Dublin', postalCode: 'D01 RISK', areas: [{ name: 'Office', type: 'zone' }] })).body.data
    const plan = (await request(app).post('/api/service-plans').set('Cookie', adminCookie).send({ siteId: site.id, name: 'Intelligence Plan', expectedDurationMinutes: 60, requiredWorkers: 1, tasks: [{ areaId: site.areas[0].id, title: 'Clean office', responseType: 'done_na_problem', required: true }] })).body.data
    await request(app).post(`/api/service-plans/${plan.id}/publish`).set('Cookie', adminCookie)
    const startAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    await request(app).post('/api/jobs').set('Cookie', adminCookie).send({ servicePlanId: plan.id, name: 'Uncovered visit', startAt, recurrence: { frequency: 'once' }, assigneeIds: [] })

    const response = await request(app).get('/api/intelligence').set('Cookie', adminCookie)
    expect(response.status).toBe(200)
    expect(response.body.data.summary.unassignedUpcoming).toBe(1)
    expect(response.body.data.siteRisks[0]).toEqual(expect.objectContaining({ name: 'Risk Radar Site', level: 'watch' }))
    expect(response.body.data.siteRisks[0].reasons).toContain('upcoming visit without a team')
  })
})
