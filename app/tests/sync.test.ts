import { describe, it, expect, beforeEach } from 'bun:test'
import {
  getProfiles,
  saveProfiles,
  getActiveProfileId,
  saveActiveProfileId,
  getSyncMetadata,
  hasSyncMetadata,
  markStorageDirty,
  DEFAULT_PROFILE,
  NULL_UUID,
} from '../src/lib/profile'
import {
  resetSyncOnSignOut,
} from '../src/lib/sync'

// Mock localStorage for tests
const store = new Map<string, string>()
const mockLocalStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, String(value))
  },
  removeItem: (key: string) => {
    store.delete(key)
  },
  clear: () => {
    store.clear()
  },
}
;(globalThis as any).localStorage = mockLocalStorage
;(globalThis as any).window = globalThis

describe('Profile persistence & dirty flag management', () => {
  beforeEach(() => {
    store.clear()
  })

  it('does NOT mark storage dirty when initializing default profiles from empty storage', () => {
    expect(hasSyncMetadata()).toBe(false)
    const profiles = getProfiles('test-hash')
    expect(profiles.length).toBe(1)
    expect(profiles[0].id).toBe(DEFAULT_PROFILE.id)

    // Sync metadata should NOT have been created, and isDirty must remain false
    expect(hasSyncMetadata()).toBe(false)
    expect(getSyncMetadata().isDirty).toBe(false)
  })

  it('does NOT mark storage dirty when initializing fallback activeProfileId from empty storage', () => {
    expect(hasSyncMetadata()).toBe(false)
    const activeId = getActiveProfileId()
    expect(activeId).toBe(DEFAULT_PROFILE.id)

    expect(hasSyncMetadata()).toBe(false)
    expect(getSyncMetadata().isDirty).toBe(false)
  })

  it('marks storage dirty when user explicitly mutates profiles', () => {
    saveProfiles([
      {
        ...DEFAULT_PROFILE,
        name: 'Default',
        selectedActivityKeys: ['act-1'],
      },
    ])

    expect(hasSyncMetadata()).toBe(true)
    expect(getSyncMetadata().isDirty).toBe(true)
  })

  it('marks storage dirty when user changes activeProfileId', () => {
    saveActiveProfileId(NULL_UUID)

    expect(hasSyncMetadata()).toBe(true)
    expect(getSyncMetadata().isDirty).toBe(true)
  })

  it('correctly clears sync metadata on resetSyncOnSignOut', () => {
    markStorageDirty()
    expect(hasSyncMetadata()).toBe(true)

    resetSyncOnSignOut()
    expect(hasSyncMetadata()).toBe(false)
    expect(getSyncMetadata().isDirty).toBe(false)
  })
})
