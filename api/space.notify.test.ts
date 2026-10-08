import { beforeAll, describe, expect, it, vi } from 'vitest'

// Envoi des notifications simulé : on vérifie à qui et quoi le serveur enverrait.
const sendPush = vi.fn(async () => 'sent' as const)
vi.mock('./_lib/push.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./_lib/push.js')>()),
  pushConfigured: () => true,
  vapidPublicKey: () => 'cle-publique',
  sendPush,
}))

const { POST } = await import('./space.js')

const space = 'a'.repeat(64)
const subscription = (name: string) => ({ endpoint: `https://push.example/${name}`, keys: { p256dh: 'p', auth: 'a' } })

async function call(body: Record<string, unknown>) {
  const res = await POST(new Request('http://localhost/api/space', { method: 'POST', body: JSON.stringify({ space, ...body }), headers: { 'x-real-ip': '10.1.0.1' } }))
  return (await res.json()) as Record<string, unknown>
}

const sync = (member: string, extra: Record<string, unknown> = {}) => call({ action: 'sync', member: { id: member, blob: 'membre' }, since: 0, ...extra })

describe('notifications de l’espace partagé', () => {
  beforeAll(async () => {
    await call({ action: 'create', meta: 'meta', member: { id: 'alice-0001', blob: 'membre' } })
    await call({ action: 'join', member: { id: 'bobby-0001', blob: 'membre' } })
  })

  it('donne la clé publique aux membres et enregistre leur abonnement', async () => {
    expect((await sync('bobby-0001', { push: subscription('bob') })).vapidPublicKey).toBe('cle-publique')
    await sync('alice-0001', { push: subscription('alice') })
  })

  it('transmet le résumé chiffré aux autres membres, pas à l’auteur', async () => {
    sendPush.mockClear()
    await sync('alice-0001', { changes: [{ id: 'note-0001', baseRev: 0, blob: 'contenu' }], notify: { blob: 'resume', ids: ['note-0001'] } })
    expect(sendPush).toHaveBeenCalledTimes(1)
    expect(sendPush).toHaveBeenCalledWith(subscription('bob'), { kind: 'space', space, notice: 'resume', tag: 'space:note-0001' })
  })

  it('se tait pour une simple modification, ou si la note n’a pas été enregistrée', async () => {
    sendPush.mockClear()
    await sync('alice-0001', { changes: [{ id: 'note-0001', baseRev: 1, blob: 'modifié' }] })
    // Version périmée : refusée, donc rien à annoncer.
    await sync('alice-0001', { changes: [{ id: 'note-0001', baseRev: 0, blob: 'autre' }], notify: { blob: 'resume', ids: ['note-0001'] } })
    expect(sendPush).not.toHaveBeenCalled()
  })

  it('ne prévient plus un membre désabonné', async () => {
    sendPush.mockClear()
    await sync('bobby-0001', { push: null })
    await sync('alice-0001', { changes: [{ id: 'note-0002', baseRev: 0, blob: 'contenu' }], notify: { blob: 'resume', ids: ['note-0002'] } })
    expect(sendPush).not.toHaveBeenCalled()
  })
})
