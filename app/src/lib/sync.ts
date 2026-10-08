import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore'
import type { User } from 'firebase/auth'
import { db } from '@/lib/firebase'
import {
  getProfiles,
  getActiveProfileId,
  getSyncMetadata,
  saveSyncMetadata,
  hasSyncMetadata,
  clearSyncMetadata,
  setLocalStateClean,
  getOrarClone,
  saveOrarClone,
  DEFAULT_PROFILE,
  STORAGE_KEY_THEME,
} from '@/lib/profile'
import {
  profileSchema,
  profilesSchema,
  activeProfileIdSchema,
  themeSchema,
  type CloudUserData,
} from '@/lib/schemas'
import { NULL_UUID } from '@/types/timetable'
import type { Profile, OrarData } from '@/types/timetable'

export type { CloudUserData }

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'offline'

export type SyncAction =
  | 'pulled'
  | 'pushed'
  | 'pushed_initial'
  | 'in_sync'
  | 'offline'
  | 'switched_user_pulled'
  | 'switched_user_reset'

export interface SyncResult {
  action: SyncAction
  version: number
}

let syncStatusListeners: Array<(status: SyncStatus) => void> = []
let currentSyncStatus: SyncStatus = typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'idle'

// Register network connectivity listeners
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (currentSyncStatus === 'offline') {
      const meta = getSyncMetadata()
      setSyncStatus(meta.isDirty ? 'idle' : 'synced')
    }
  })
  window.addEventListener('offline', () => {
    setSyncStatus('offline')
  })
}

/**
 * Retrieve the current sync engine status.
 */
export function getSyncStatus(): SyncStatus {
  return currentSyncStatus
}

/**
 * Subscribe to sync engine status updates.
 * Returns an unsubscribe callback.
 */
export function subscribeSyncStatus(listener: (status: SyncStatus) => void): () => void {
  syncStatusListeners.push(listener)
  listener(currentSyncStatus)
  return () => {
    syncStatusListeners = syncStatusListeners.filter((l) => l !== listener)
  }
}

function setSyncStatus(status: SyncStatus): void {
  currentSyncStatus = status
  syncStatusListeners.forEach((l) => l(status))
}

// ============================================================================
// Firestore Path Helpers
// ============================================================================

/**
 * Settings document path: users/{userId}/settings/state
 */
export function getUserSettingsDocRef(userId: string) {
  if (!db) throw new Error('Firestore is not initialized')
  return doc(db, 'users', userId, 'settings', 'state')
}

/**
 * Global ORAR document path: orares/{hash}
 */
export function getGlobalOrarDocRef(hash: string) {
  if (!db) throw new Error('Firestore is not initialized')
  return doc(db, 'orares', hash)
}

/**
 * User Custom ORAR document path: users/{userId}/orares/{hash}
 */
export function getUserOrarDocRef(userId: string, hash: string) {
  if (!db) throw new Error('Firestore is not initialized')
  return doc(db, 'users', userId, 'orares', hash)
}

// ============================================================================
// Orar Resolution & Retrieval by Hash
// ============================================================================

/**
 * Uniquely identify and retrieve an ORAR clone by its "hash" key:
 * 1. Checks local storage cache first.
 * 2. Checks global collection: `orares/{hash}`.
 * 3. If not found in global collection and user is provided:
 *    checks user's subcollection: `users/{userId}/orares/{hash}`.
 * Saves retrieved orar to local storage for fast offline access.
 */
export async function fetchOrarByHash(
  hash: string,
  userId?: string | null
): Promise<OrarData | null> {
  if (!hash) return null

  // 1. Check local cache
  const local = getOrarClone(hash)
  if (local) return local

  if (!db || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    return null
  }

  try {
    // 2. Check global collection: orares/{hash}
    const globalSnap = await getDoc(getGlobalOrarDocRef(hash))
    if (globalSnap.exists()) {
      const data = globalSnap.data() as OrarData
      saveOrarClone(data)
      return data
    }

    // 3. If not in global collection and user logged in, check user's subcollection
    if (userId) {
      const userSnap = await getDoc(getUserOrarDocRef(userId, hash))
      if (userSnap.exists()) {
        const data = userSnap.data() as OrarData
        saveOrarClone(data)
        return data
      }
    }
  } catch (err) {
    console.warn(`Failed to fetch ORAR by hash ${hash}:`, err)
  }

  return null
}

/**
 * Ensure all custom orar clones in profiles are stored in Firestore:
 * - If in global collection: no action needed.
 * - If not in global collection: upload to users/{userId}/orares/{hash}.
 */
async function syncCustomOraresForUser(userId: string, profiles: Profile[]): Promise<void> {
  if (!db) return

  for (const profile of profiles) {
    if (!profile.orar_hash) continue
    const hash = profile.orar_hash

    try {
      // 1. Does it exist in global collection?
      const globalSnap = await getDoc(getGlobalOrarDocRef(hash))
      if (globalSnap.exists()) {
        continue
      }

      // 2. Does it already exist in user's subcollection?
      const userSnap = await getDoc(getUserOrarDocRef(userId, hash))
      if (userSnap.exists()) {
        continue
      }

      // 3. Not in cloud: upload local clone to users/{userId}/orares/{hash}
      const localClone = getOrarClone(hash)
      if (localClone) {
        // Strip weekday attribute from all activities
        const cleanTimetables = localClone.timetables.map((t) => ({
          ...t,
          activities: t.activities.map((a: any) => {
            const { weekday: _w, ...clean } = a
            return clean
          }),
        }))

        await setDoc(getUserOrarDocRef(userId, hash), {
          created_at: localClone.created_at || new Date().toISOString(),
          hash: localClone.hash,
          timetables: cleanTimetables,
        })
      }
    } catch (e) {
      console.warn(`Failed to sync custom orar clone for hash ${hash}:`, e)
    }
  }
}

// ============================================================================
// Local Payload Validation & Cloud Application
// ============================================================================

/**
 * Validate and serialize current local state for cloud upload.
 */
function getValidatedLocalPayload() {
  const profiles = getProfiles()
  const profilesResult = profilesSchema.safeParse(profiles)
  if (!profilesResult.success) {
    throw new Error('Local profiles failed validation. Sync aborted to protect cloud.')
  }

  const activeProfileId = getActiveProfileId()
  const activeIdResult = activeProfileIdSchema.safeParse(activeProfileId)
  if (!activeIdResult.success) {
    throw new Error('Local active profile ID is invalid.')
  }

  const rawTheme = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY_THEME) : 'system'
  const themeResult = themeSchema.safeParse(rawTheme)
  const theme = themeResult.success ? themeResult.data : 'system'

  return {
    profiles: profilesResult.data,
    activeProfileId: activeIdResult.data,
    theme,
  }
}

/**
 * Sanitize raw cloud profiles gracefully so individual invalid items
 * do not cause the entire dataset to be discarded.
 */
function sanitizeCloudProfiles(raw: unknown): Profile[] {
  if (!Array.isArray(raw)) {
    return [DEFAULT_PROFILE]
  }

  const validProfiles: Profile[] = []
  for (const item of raw) {
    const parseResult = profileSchema.safeParse(item)
    if (parseResult.success) {
      validProfiles.push(parseResult.data as Profile)
    }
  }

  // Ensure default profile with NULL_UUID always exists
  const hasDefault = validProfiles.some((p) => p.id === NULL_UUID)
  if (!hasDefault) {
    validProfiles.unshift(DEFAULT_PROFILE)
  }

  return validProfiles
}

/**
 * Overwrite local state with cloud data cleanly without re-triggering the dirty flag.
 * Also asynchronously pre-fetches any missing ORAR datasets referenced by profile hashes.
 */
async function applyCloudToLocal(
  cloudData: CloudUserData,
  cloudVersion: number,
  userId: string
): Promise<void> {
  const validProfiles = sanitizeCloudProfiles(cloudData.profiles)

  // Ensure active profile ID references an existing profile
  const activeIdResult = activeProfileIdSchema.safeParse(cloudData.activeProfileId)
  const candidateId = activeIdResult.success ? activeIdResult.data : NULL_UUID
  const validActiveId = validProfiles.some((p) => p.id === candidateId)
    ? candidateId
    : validProfiles[0].id

  const themeResult = themeSchema.safeParse(cloudData.theme)
  const validTheme = themeResult.success ? themeResult.data : undefined

  setLocalStateClean(
    validProfiles,
    validActiveId,
    validTheme,
    cloudVersion,
    userId
  )

  // Pre-fetch any orar datasets referenced in the profiles that are not yet local
  for (const p of validProfiles) {
    if (p.orar_hash && !getOrarClone(p.orar_hash)) {
      fetchOrarByHash(p.orar_hash, userId).catch(() => {})
    }
  }
}

// In-flight mutex & queued request state to prevent parallel Firestore collisions
let activeSyncPromise: Promise<SyncResult> | null = null
let queuedSyncUser: User | null = null
let queuedSyncCallback: (() => void) | undefined = undefined

/**
 * Perform sync between local storage and Firestore:
 * - User Settings stored in subcollection: `users/{userId}/settings/state`.
 * - Global ORAR clones stored in collection: `orares/{hash}`.
 * - User custom ORAR clones stored in subcollection: `users/{userId}/orares/{hash}`.
 * - Unique identification of orares is strictly by the `"hash"` key.
 */
export async function syncWithCloud(
  user: User,
  onCloudUpdate?: () => void
): Promise<SyncResult> {
  if (activeSyncPromise) {
    queuedSyncUser = user
    queuedSyncCallback = onCloudUpdate
    await activeSyncPromise
    if (queuedSyncUser) {
      const nextUser = queuedSyncUser
      const nextCb = queuedSyncCallback
      queuedSyncUser = null
      queuedSyncCallback = undefined
      return syncWithCloud(nextUser, nextCb)
    }
    return { action: 'in_sync', version: getSyncMetadata().lastSyncedVersion }
  }

  activeSyncPromise = executeSync(user, onCloudUpdate)
  try {
    return await activeSyncPromise
  } finally {
    activeSyncPromise = null
  }
}

async function executeSync(
  user: User,
  onCloudUpdate?: () => void
): Promise<SyncResult> {
  if (!db) {
    throw new Error('Firestore is not configured.')
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    setSyncStatus('offline')
    return { action: 'offline', version: getSyncMetadata().lastSyncedVersion }
  }

  setSyncStatus('syncing')

  try {
    const settingsDocRef = getUserSettingsDocRef(user.uid)
    let snapshot = await getDoc(settingsDocRef)

    // Legacy fallback: check users/{uid} root doc if settings/state doesn't exist
    if (!snapshot.exists()) {
      const legacyDocRef = doc(db, 'users', user.uid)
      const legacySnap = await getDoc(legacyDocRef)
      if (legacySnap.exists()) {
        snapshot = legacySnap
      }
    }

    const hasMetadata = hasSyncMetadata()
    const metadata = getSyncMetadata()

    // Check if the current client is already linked and synced with this user
    const isLinkedToThisUser = hasMetadata && metadata.lastSyncedUserId === user.uid

    // CASE 1: Client is NOT linked to this user (e.g. localStorage was cleared,
    // fresh client session, or client was previously synced with a different user)
    if (!isLinkedToThisUser) {
      if (snapshot.exists()) {
        // User has data in cloud: PULL cloud data to populate client
        const cloudData = snapshot.data() as CloudUserData
        const cloudVersion = typeof cloudData.version === 'number' ? cloudData.version : 1
        await applyCloudToLocal(cloudData, cloudVersion, user.uid)
        setSyncStatus('synced')
        if (onCloudUpdate) {
          onCloudUpdate()
        }
        return { action: 'pulled', version: cloudVersion }
      } else {
        // Cloud document does not exist yet
        const isDifferentUser = Boolean(
          metadata.lastSyncedUserId && metadata.lastSyncedUserId !== user.uid
        )
        if (isDifferentUser) {
          // Different user on same client without cloud data -> reset to clean default
          const defaultProfiles = [DEFAULT_PROFILE]
          await setDoc(settingsDocRef, {
            profiles: defaultProfiles,
            activeProfileId: NULL_UUID,
            theme: 'system',
            version: 1,
            updatedAt: serverTimestamp(),
          })
          setLocalStateClean(defaultProfiles, NULL_UUID, 'system', 1, user.uid)
          setSyncStatus('synced')
          if (onCloudUpdate) {
            onCloudUpdate()
          }
          return { action: 'switched_user_reset', version: 1 }
        } else {
          // Initial login for a new account with local data -> push initial state
          const payload = getValidatedLocalPayload()
          await syncCustomOraresForUser(user.uid, payload.profiles)
          await setDoc(settingsDocRef, {
            ...payload,
            version: 1,
            updatedAt: serverTimestamp(),
          })
          saveSyncMetadata({
            isDirty: false,
            lastSyncedVersion: 1,
            lastSyncedUserId: user.uid,
          })
          setSyncStatus('synced')
          return { action: 'pushed_initial', version: 1 }
        }
      }
    }

    // CASE 2: Client is linked to this user
    if (!snapshot.exists()) {
      // Cloud document does not exist (e.g. deleted externally) -> push initial
      const payload = getValidatedLocalPayload()
      await syncCustomOraresForUser(user.uid, payload.profiles)
      await setDoc(settingsDocRef, {
        ...payload,
        version: 1,
        updatedAt: serverTimestamp(),
      })
      saveSyncMetadata({
        isDirty: false,
        lastSyncedVersion: 1,
        lastSyncedUserId: user.uid,
      })
      setSyncStatus('synced')
      return { action: 'pushed_initial', version: 1 }
    }

    const cloudData = snapshot.data() as CloudUserData
    const cloudVersion = typeof cloudData.version === 'number' ? cloudData.version : 1
    const { isDirty, lastSyncedVersion } = metadata

    // 2A: Local changes exist (isDirty) -> PUSH
    if (isDirty) {
      const payload = getValidatedLocalPayload()
      const newVersion = Math.max(cloudVersion, lastSyncedVersion) + 1

      // Upload any custom orar clones that do not exist in cloud
      await syncCustomOraresForUser(user.uid, payload.profiles)

      await setDoc(settingsDocRef, {
        ...payload,
        version: newVersion,
        updatedAt: serverTimestamp(),
      })

      saveSyncMetadata({
        isDirty: false,
        lastSyncedVersion: newVersion,
        lastSyncedUserId: user.uid,
      })

      setSyncStatus('synced')
      return { action: 'pushed', version: newVersion }
    }

    // 2B: Local is clean, but cloud has newer version -> PULL
    if (cloudVersion > lastSyncedVersion) {
      await applyCloudToLocal(cloudData, cloudVersion, user.uid)
      setSyncStatus('synced')
      if (onCloudUpdate) {
        onCloudUpdate()
      }
      return { action: 'pulled', version: cloudVersion }
    }

    // 2C: Both are clean and in sync
    setSyncStatus('synced')
    return { action: 'in_sync', version: cloudVersion }
  } catch (error) {
    console.error('Cloud sync error:', error)
    setSyncStatus('error')
    throw error
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Cancel any pending debounced sync operations.
 */
export function cancelDebouncedSync(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}

/**
 * Trigger a debounced sync (~1.5s) if user is logged in and state is dirty.
 * Automatically skips if local storage is clean, avoiding redundant network calls.
 */
export function scheduleDebouncedSync(
  user: User | null,
  onCloudUpdate?: () => void,
  delayMs: number = 1500
): void {
  if (!user) return
  if (!getSyncMetadata().isDirty) return

  cancelDebouncedSync()

  debounceTimer = setTimeout(() => {
    debounceTimer = null
    if (!getSyncMetadata().isDirty) return
    syncWithCloud(user, onCloudUpdate).catch((err) => {
      console.warn('Debounced sync failed:', err)
    })
  }, delayMs)
}

/**
 * Reset sync status to idle and cancel any pending timers on sign out.
 */
export function resetSyncOnSignOut(): void {
  cancelDebouncedSync()
  setSyncStatus('idle')
  clearSyncMetadata()
}
