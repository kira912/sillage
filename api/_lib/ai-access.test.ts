import { beforeAll, describe, expect, it } from 'vitest'
import { aiAccess, type AiLimits } from './ai-access.js'

const LIMITS: AiLimits = { label: 'analyses', perIpHour: 30, perDay: 500, freePerDevice: 2, freePerDay: 5 }

let ipCounter = 0
const request = (headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/parse', { method: 'POST', headers: { 'x-real-ip': `10.9.0.${ipCounter}`, ...headers } })

describe('accès à l’IA', () => {
  beforeAll(() => {
    process.env.SILLAGE_ACCESS_CODE = 'code-famille'
  })

  it('donne un petit quota gratuit par appareil, avec le nombre restant', async () => {
    ipCounter++
    const device = { 'x-sillage-device': 'appareil-0001' }
    expect(await aiAccess(request(device), 'quota-a', LIMITS)).toMatchObject({ quota: { remaining: 1, limit: 2 } })
    expect(await aiAccess(request(device), 'quota-a', LIMITS)).toMatchObject({ quota: { remaining: 0, limit: 2 } })
    const refused = await aiAccess(request(device), 'quota-a', LIMITS)
    expect(refused).toBeInstanceOf(Response)
    expect((refused as Response).status).toBe(429)
  })

  it('limite aussi par adresse IP, contre les identifiants d’appareil changés à chaque appel', async () => {
    ipCounter++
    const results = []
    for (let i = 0; i < 8; i++) results.push(await aiAccess(request({ 'x-sillage-device': `appareil-x${i}0000` }), 'quota-b', { ...LIMITS, freePerDay: 100 }))
    // 2 par appareil × 3 appareils par adresse IP.
    expect(results.filter((r) => !(r instanceof Response))).toHaveLength(6)
  })

  it('plafonne l’offre gratuite pour tout le monde', async () => {
    const results = []
    for (let i = 0; i < 8; i++) {
      ipCounter++
      results.push(await aiAccess(request({ 'x-sillage-device': `appareil-g${i}0000` }), 'quota-c', LIMITS))
    }
    expect(results.filter((r) => !(r instanceof Response))).toHaveLength(LIMITS.freePerDay)
  })

  it('n’applique pas de quota avec le code d’accès, et refuse un mauvais code', async () => {
    ipCounter++
    for (let i = 0; i < 4; i++) expect(await aiAccess(request({ 'x-sillage-code': 'code-famille' }), 'quota-d', LIMITS)).not.toHaveProperty('quota')
    expect(((await aiAccess(request({ 'x-sillage-code': 'faux' }), 'quota-d', LIMITS)) as Response).status).toBe(401)
  })
})
