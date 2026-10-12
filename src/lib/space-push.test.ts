import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setSpacePushWanted, spacePushWanted } from './space-push'

describe('spacePushWanted', () => {
  const storage = new Map<string, string>()

  beforeAll(() => {
    Object.assign(globalThis, {
      localStorage: {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => void storage.set(k, v),
        removeItem: (k: string) => void storage.delete(k),
        clear: () => storage.clear(),
      },
    })
  })

  beforeEach(() => {
    storage.clear()
    Object.defineProperty(globalThis, 'Notification', {
      value: { permission: 'granted' },
      configurable: true,
      writable: true,
    })
  })

  it('est désactivé par défaut si aucune notification n’est activée', () => {
    expect(spacePushWanted()).toBe(false)
  })

  it('est activé si les notifications push sont activées pour l’app', () => {
    localStorage.setItem('sillage:push-enabled', '1')
    expect(spacePushWanted()).toBe(true)
  })

  it('est activé si les notifications d’espace sont explicitement activées', () => {
    setSpacePushWanted(true)
    expect(spacePushWanted()).toBe(true)
  })

  it('peut être désactivé explicitement même si l’app a les notifications activées', () => {
    localStorage.setItem('sillage:push-enabled', '1')
    setSpacePushWanted(false)
    expect(spacePushWanted()).toBe(false)
  })

  it('est désactivé si la permission de notification est refusée', () => {
    localStorage.setItem('sillage:push-enabled', '1')
    setSpacePushWanted(true)
    Object.defineProperty(globalThis, 'Notification', {
      value: { permission: 'denied' },
      configurable: true,
      writable: true,
    })
    expect(spacePushWanted()).toBe(false)
  })
})
