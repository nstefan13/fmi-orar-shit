import type {
  Activity,
  CustomActivity,
  DidacticWeekSpec,
  ExportedActivity,
  ExportedProfileData,
  OrarData,
  Profile,
} from '@/types/timetable'
import { NULL_UUID } from '@/types/timetable'
export { NULL_UUID }

import { v4 as uuidv4 } from 'uuid'
export { uuidv4 }

import { computeCustomActivityId } from '@/lib/hash'
import {
  profilesSchema,
  activeProfileIdSchema,
  syncMetadataSchema,
  type SyncMetadata,
} from '@/lib/schemas'

export const STORAGE_KEY_PROFILES = 'orar_profiles'
export const STORAGE_KEY_ACTIVE_PROFILE_ID = 'orar_active_profile_id'
export const STORAGE_KEY_ORAR_VERSION = 'orar_version'
export const STORAGE_KEY_SYNC_METADATA = 'orar_sync_metadata'
export const STORAGE_KEY_THEME = 'theme'
export const CURRENT_ORAR_VERSION = 'alpha-1.0.0'
export const STORAGE_PREFIX_ORAR_DATA = 'orar_DATA_'

export const DEFAULT_SYNC_METADATA: SyncMetadata = {
  isDirty: false,
  lastSyncedVersion: 0,
  lastSyncedUserId: null,
}

export const DEFAULT_PROFILE: Profile = {
  id: NULL_UUID,
  name: 'Default',
  orar_hash: '',
  selectedActivityKeys: [],
  customActivities: [],
  didacticWeeks: [],
}

/**
 * Generate a standard UUID v4 string.
 */
export const generateUUID = uuidv4

/**
 * Verifies orar_version in localStorage.
 * If orar_version is missing: clear localStorage for a clean start and set version.
 */
export function ensureOrarVersion(): void {
  if (typeof window === 'undefined') return
  const version = localStorage.getItem(STORAGE_KEY_ORAR_VERSION)
  if (!version) {
    localStorage.clear()
    localStorage.setItem(STORAGE_KEY_ORAR_VERSION, CURRENT_ORAR_VERSION)
  }
}

/**
 * Save an ORAR clone to localStorage under orar_DATA_<hash> if not already present.
 */
export function saveOrarClone(orar: OrarData): void {
  if (typeof window === 'undefined' || !orar || !orar.hash) return
  const key = `${STORAGE_PREFIX_ORAR_DATA}${orar.hash}`
  if (!localStorage.getItem(key)) {
    localStorage.setItem(key, JSON.stringify(orar))
  }
}

/**
 * Retrieve an ORAR clone by hash from localStorage.
 */
export function getOrarClone(hash: string): OrarData | null {
  if (typeof window === 'undefined' || !hash) return null
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX_ORAR_DATA}${hash}`)
    if (!raw) return null
    return JSON.parse(raw) as OrarData
  } catch {
    return null
  }
}

/**
 * Load all profiles from localStorage.
 * Ensures the Default profile (NULL_UUID) always exists and has a valid orar_hash.
 */
export function getProfiles(fallbackOrarHash: string = ''): Profile[] {
  if (typeof window === 'undefined') {
    return [{ ...DEFAULT_PROFILE, orar_hash: fallbackOrarHash }]
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PROFILES)
    let json: unknown
    try {
      json = raw ? JSON.parse(raw) : undefined
    } catch {
      json = undefined
    }

    const defaultProfileWithHash: Profile = {
      ...DEFAULT_PROFILE,
      orar_hash: fallbackOrarHash,
    }

    if (!json) {
      saveProfiles([defaultProfileWithHash], false)
      return [defaultProfileWithHash]
    }

    // Auto-prepend DEFAULT_PROFILE if missing in an array
    if (Array.isArray(json)) {
      const arr = json as Record<string, any>[]
      const defIdx = arr.findIndex((p) => p && p.id === NULL_UUID)
      if (defIdx === -1) {
        json = [defaultProfileWithHash, ...arr]
      } else if (!arr[defIdx].orar_hash && fallbackOrarHash) {
        arr[defIdx].orar_hash = fallbackOrarHash
      }
      // Backfill missing orar_hash for any profile
      arr.forEach((p) => {
        if (p && typeof p === 'object' && !p.orar_hash && fallbackOrarHash) {
          p.orar_hash = fallbackOrarHash
        }
      })
    }

    const result = profilesSchema.safeParse(json)
    if (result.success) {
      return result.data as Profile[]
    }

    console.warn('Profiles validation failed, falling back to default profile:', result.error)
    saveProfiles([defaultProfileWithHash], false)
    return [defaultProfileWithHash]
  } catch (e) {
    console.error('Failed to load profiles from localStorage', e)
    return [{ ...DEFAULT_PROFILE, orar_hash: fallbackOrarHash }]
  }
}

/**
 * Save all profiles to localStorage.
 * Optionally marks storage dirty (defaults to true).
 */
export function saveProfiles(profiles: Profile[], markDirty: boolean = true): void {
  if (typeof window === 'undefined') return
  try {
    const result = profilesSchema.safeParse(profiles)
    if (!result.success) {
      console.warn('Invalid profiles provided to saveProfiles:', result.error)
      return
    }
    localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(result.data))
    if (markDirty) {
      markStorageDirty()
    }
  } catch (e) {
    console.error('Failed to save profiles to localStorage', e)
  }
}

/**
 * Get the currently active profile ID from localStorage.
 * Ensures the returned ID references an existing profile in getProfiles() (foreign key constraint).
 * Defaults to NULL_UUID.
 */
export function getActiveProfileId(): string {
  if (typeof window === 'undefined') return NULL_UUID
  const profiles = getProfiles()
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ACTIVE_PROFILE_ID)
    const result = activeProfileIdSchema.safeParse(raw)
    const id = result.success ? result.data : NULL_UUID

    if (profiles.some((p) => p.id === id)) {
      return id
    }

    const fallbackId = profiles.some((p) => p.id === NULL_UUID) ? NULL_UUID : profiles[0].id
    saveActiveProfileId(fallbackId, false)
    return fallbackId
  } catch {
    return NULL_UUID
  }
}

/**
 * Save the active profile ID to localStorage.
 * Optionally marks storage dirty (defaults to true).
 */
export function saveActiveProfileId(id: string, markDirty: boolean = true): void {
  if (typeof window === 'undefined') return
  try {
    const result = activeProfileIdSchema.safeParse(id)
    if (!result.success) {
      console.warn('Invalid active profile ID provided to saveActiveProfileId:', id)
      return
    }
    localStorage.setItem(STORAGE_KEY_ACTIVE_PROFILE_ID, result.data)
    if (markDirty) {
      markStorageDirty()
    }
  } catch (e) {
    console.error('Failed to save active profile ID to localStorage', e)
  }
}

/**
 * Check if sync metadata explicitly exists in localStorage.
 */
export function hasSyncMetadata(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(STORAGE_KEY_SYNC_METADATA) !== null
}

/**
 * Clear sync metadata from localStorage.
 */
export function clearSyncMetadata(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEY_SYNC_METADATA)
  } catch (e) {
    console.error('Failed to clear sync metadata from localStorage', e)
  }
}

/**
 * Clears entire local storage on user sign-out and re-initializes clean orar version.
 */
export function clearLocalStorageOnSignOut(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.clear()
    localStorage.setItem(STORAGE_KEY_ORAR_VERSION, CURRENT_ORAR_VERSION)
  } catch (e) {
    console.error('Failed to clear local storage on sign out:', e)
  }
}

/**
 * Get sync metadata from localStorage.
 */
export function getSyncMetadata(): SyncMetadata {
  if (typeof window === 'undefined') return { ...DEFAULT_SYNC_METADATA }
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SYNC_METADATA)
    if (!raw) return { ...DEFAULT_SYNC_METADATA }
    const result = syncMetadataSchema.safeParse(JSON.parse(raw))
    return result.success ? result.data : { ...DEFAULT_SYNC_METADATA }
  } catch {
    return { ...DEFAULT_SYNC_METADATA }
  }
}

/**
 * Save sync metadata to localStorage.
 */
export function saveSyncMetadata(metadata: SyncMetadata): void {
  if (typeof window === 'undefined') return
  try {
    const result = syncMetadataSchema.safeParse(metadata)
    if (!result.success) {
      console.warn('Invalid sync metadata provided to saveSyncMetadata:', result.error)
      return
    }
    localStorage.setItem(STORAGE_KEY_SYNC_METADATA, JSON.stringify(result.data))
  } catch (e) {
    console.error('Failed to save sync metadata to localStorage', e)
  }
}

/**
 * Mark local storage as dirty without altering lastSyncedVersion.
 */
export function markStorageDirty(): void {
  const meta = getSyncMetadata()
  if (!meta.isDirty) {
    saveSyncMetadata({ ...meta, isDirty: true })
  }
}

/**
 * Safely writes raw profile data, active profile ID, and optional theme to localStorage
 * without marking the storage as dirty.
 * Used exclusively by the sync engine when applying incoming cloud sync data.
 */
export function setLocalStateClean(
  profiles: Profile[],
  activeProfileId: string,
  theme?: string,
  lastSyncedVersion: number = 0,
  lastSyncedUserId: string | null = null
): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(profiles))
    localStorage.setItem(STORAGE_KEY_ACTIVE_PROFILE_ID, activeProfileId)
    if (theme) {
      localStorage.setItem(STORAGE_KEY_THEME, theme)
    }
    saveSyncMetadata({
      isDirty: false,
      lastSyncedVersion,
      lastSyncedUserId,
    })
  } catch (e) {
    console.error('Failed to set clean local state in localStorage:', e)
  }
}

function normalizeString(s?: string | null): string {
  return (s || '').trim().toLowerCase()
}

function normalizeLocation(loc: unknown): string {
  if (!loc) return ''
  if (typeof loc === 'string') return loc.trim().toLowerCase()
  if (typeof loc === 'object' && loc !== null) {
    const obj = loc as { type?: string; id?: unknown }
    return `${obj.type || ''} ${obj.id ?? ''}`.trim().toLowerCase()
  }
  return ''
}

function normalizePeriodicity(p?: string | null): string {
  const norm = normalizeString(p)
  if (norm.includes('odd')) return 'odd'
  if (norm.includes('even')) return 'even'
  return norm
}

/**
 * Match an activity by value against all activities in ORAR.
 * Matches on name, weekday, start_time (hour, minute), end_time (hour, minute),
 * type, periodicity, subgroup, and location.
 */
export function matchActivityByValue(
  target: Partial<ExportedActivity> & { weekday?: string },
  allActivities: Activity[]
): Activity | undefined {
  const targetName = normalizeString(target.name)
  const targetWeekday = normalizeString(target.start_time?.weekday || target.weekday)
  const targetStartHour = Number(target.start_time?.hour)
  const targetStartMin = Number(target.start_time?.minute)
  const targetEndHour = Number(target.end_time?.hour)
  const targetEndMin = Number(target.end_time?.minute)
  const targetType = normalizeString(target.type)
  const targetPeriodicity = normalizePeriodicity(target.periodicity)
  const targetSubgroup =
    target.subgroup !== null && target.subgroup !== undefined ? String(target.subgroup).trim() : ''
  const targetLoc = normalizeLocation(target.location)

  return allActivities.find((act) => {
    // 1. Name match
    if (normalizeString(act.name) !== targetName) return false

    // 2. Weekday match
    const actWeekday = normalizeString(act.start_time?.weekday || act.weekday)
    if (actWeekday !== targetWeekday) return false

    // 3. Time match
    if (act.start_time.hour !== targetStartHour) return false
    if (act.start_time.minute !== targetStartMin) return false
    if (act.end_time.hour !== targetEndHour) return false
    if (act.end_time.minute !== targetEndMin) return false

    // 4. Type match
    if (normalizeString(act.type) !== targetType) return false

    // 5. Periodicity match
    if (normalizePeriodicity(act.periodicity) !== targetPeriodicity) return false

    // 6. Subgroup match
    const actSubgroup =
      act.subgroup !== null && act.subgroup !== undefined ? String(act.subgroup).trim() : ''
    if (actSubgroup !== targetSubgroup) return false

    // 7. Location match (if provided)
    const actLoc = normalizeLocation(act.location)
    if (targetLoc && actLoc) {
      if (actLoc !== targetLoc && !actLoc.includes(targetLoc) && !targetLoc.includes(actLoc)) {
        return false
      }
    }

    return true
  })
}

export interface ParseImportResult {
  name: string
  orar_hash: string
  selectedActivityKeys: string[]
  customActivities: CustomActivity[]
  didacticWeeks: DidacticWeekSpec[]
  matchedSelectedCount: number
  totalSelectedImported: number
  customCount: number
}

/**
 * Parse and validate an imported profile JSON file.
 * Handles the embedded 'orar' clone if present, caches it,
 * deduplicates collided IDs (keeping first), and categorizes activities.
 */
export function parseImportedProfileJson(
  jsonString: string,
  fallbackOrar: OrarData
): ParseImportResult {
  const parsed = JSON.parse(jsonString)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid JSON format: expected an object.')
  }

  const name = typeof parsed.name === 'string' ? parsed.name.trim() : ''

  // Process embedded ORAR clone
  let targetOrar: OrarData = fallbackOrar
  let resolvedOrarHash = fallbackOrar.hash

  if (parsed.orar && typeof parsed.orar === 'object' && parsed.orar.hash) {
    const importedOrar = parsed.orar as OrarData
    resolvedOrarHash = importedOrar.hash
    const existingClone = getOrarClone(importedOrar.hash)
    if (existingClone) {
      targetOrar = existingClone
    } else {
      saveOrarClone(importedOrar)
      targetOrar = importedOrar
    }
  }

  // Flatten all activities in targetOrar
  const allActivitiesInTarget: Activity[] = []
  targetOrar.timetables.forEach((t) => {
    t.activities.forEach((a) => {
      allActivitiesInTarget.push({
        ...a,
        _timetableId: t.id,
        _timetableTitle: t.title,
      })
    })
  })
  const activityMap = new Map<string, Activity>()
  allActivitiesInTarget.forEach((a) => activityMap.set(a.id, a))

  // 1. Process custom activities with ID deduplication
  const rawCustom = parsed['custom activities'] || parsed.custom_activities || parsed.customActivities || []
  const customActivitiesList: CustomActivity[] = []
  const seenCustomIds = new Set<string>()

  const processCustomItem = (item: any) => {
    if (!item || typeof item !== 'object') return
    const weekday = item.start_time?.weekday || item.weekday || 'Luni'
    const startHour = typeof item.start_time?.hour === 'number' ? item.start_time.hour : 8
    const startMin = typeof item.start_time?.minute === 'number' ? item.start_time.minute : 0
    const endHour = typeof item.end_time?.hour === 'number' ? item.end_time.hour : 9
    const endMin = typeof item.end_time?.minute === 'number' ? item.end_time.minute : 50

    let periodicityVal: 'odd' | 'even' | null = null
    const normPeriod = normalizePeriodicity(item.periodicity)
    if (normPeriod === 'odd') periodicityVal = 'odd'
    else if (normPeriod === 'even') periodicityVal = 'even'

    const locationStr =
      typeof item.location === 'string'
        ? item.location
        : item.location && typeof item.location === 'object'
          ? `${item.location.type || ''} ${item.location.id ?? ''}`.trim()
          : null

    const draftActivity: Partial<CustomActivity> = {
      name: typeof item.name === 'string' ? item.name : 'Custom Activity',
      start_time: {
        weekday,
        hour: startHour,
        minute: startMin,
      },
      end_time: {
        weekday,
        hour: endHour,
        minute: endMin,
      },
      authors: Array.isArray(item.authors) ? item.authors : [],
      location: locationStr || null,
      periodicity: periodicityVal,
      enabled: item.enabled !== false,
    }

    const computedId = computeCustomActivityId(draftActivity)

    // Deduplicate: if duplicate ID, keep the first one
    if (seenCustomIds.has(computedId)) {
      return
    }
    seenCustomIds.add(computedId)

    customActivitiesList.push({
      id: computedId,
      name: draftActivity.name!,
      start_time: draftActivity.start_time!,
      end_time: draftActivity.end_time!,
      authors: draftActivity.authors!,
      location: draftActivity.location!,
      periodicity: draftActivity.periodicity!,
      enabled: draftActivity.enabled!,
    })
  }

  if (Array.isArray(rawCustom)) {
    rawCustom.forEach(processCustomItem)
  }

  // 2. Process selected activities
  // Can be in selectedActivityKeys (IDs) or 'selected activities' (ExportedActivity[])
  const selectedKeysSet = new Set<string>()
  let totalSelectedImported = 0

  if (Array.isArray(parsed.selectedActivityKeys)) {
    totalSelectedImported = parsed.selectedActivityKeys.length
    parsed.selectedActivityKeys.forEach((key: any) => {
      if (typeof key === 'string' && key.trim()) {
        if (activityMap.has(key)) {
          selectedKeysSet.add(key)
        }
      }
    })
  }

  const rawSelected =
    parsed['selected activities'] || parsed.selected_activities || parsed.selectedActivities || []

  if (Array.isArray(rawSelected)) {
    totalSelectedImported += rawSelected.length
    rawSelected.forEach((item: any) => {
      if (!item || typeof item !== 'object') return

      // If marked as custom, route to custom activities
      if (item.is_custom === true || normalizeString(item.type) === 'custom') {
        processCustomItem(item)
        return
      }

      // If item already contains an ID that exists in targetOrar
      if (typeof item.id === 'string' && activityMap.has(item.id)) {
        selectedKeysSet.add(item.id)
        return
      }

      // Match by value against targetOrar activities
      const matched = matchActivityByValue(item, allActivitiesInTarget)
      if (matched) {
        selectedKeysSet.add(matched.id)
      }
    })
  }

  // 3. Process defined weekdays (didactic weeks)
  const rawWeeks =
    parsed['defined weekdays'] ||
    parsed['didactic_weeks'] ||
    parsed.definedWeekdays ||
    parsed.didacticWeeks ||
    []
  const didacticWeeksList: DidacticWeekSpec[] = []

  if (Array.isArray(rawWeeks)) {
    rawWeeks.forEach((item: any) => {
      if (
        item &&
        typeof item.date === 'string' &&
        typeof item.weekNumber === 'number' &&
        !isNaN(item.weekNumber)
      ) {
        didacticWeeksList.push({
          date: item.date,
          weekNumber: item.weekNumber,
        })
      }
    })
  }

  return {
    name,
    orar_hash: resolvedOrarHash,
    selectedActivityKeys: Array.from(selectedKeysSet),
    customActivities: customActivitiesList,
    didacticWeeks: didacticWeeksList,
    matchedSelectedCount: selectedKeysSet.size,
    totalSelectedImported,
    customCount: customActivitiesList.length,
  }
}

/**
 * Generate the JSON payload for a profile to export, including the ORAR clone.
 */
export function buildProfileExportData(
  profile: Profile,
  activityMap: Map<string, Activity>,
  orarData?: OrarData
): ExportedProfileData {
  const exportedSelected: ExportedActivity[] = []
  for (const id of profile.selectedActivityKeys || []) {
    const act = activityMap.get(id)
    if (act) {
      exportedSelected.push({
        name: act.name,
        type: act.type ?? null,
        start_time: {
          weekday: act.start_time.weekday,
          hour: act.start_time.hour,
          minute: act.start_time.minute,
        },
        end_time: {
          weekday: act.end_time.weekday,
          hour: act.end_time.hour,
          minute: act.end_time.minute,
        },
        authors: act.authors || [],
        location: act.location ?? null,
        periodicity: act.periodicity ?? null,
        subgroup: act.subgroup ?? null,
      })
    }
  }

  const exportedCustom: ExportedActivity[] = (profile.customActivities || []).map((c) => ({
    name: c.name,
    type: 'Custom',
    start_time: {
      weekday: c.start_time.weekday,
      hour: c.start_time.hour,
      minute: c.start_time.minute,
    },
    end_time: {
      weekday: c.end_time.weekday,
      hour: c.end_time.hour,
      minute: c.end_time.minute,
    },
    authors: c.authors || [],
    location: c.location ?? null,
    periodicity: c.periodicity ?? null,
    subgroup: null,
  }))

  return {
    name: profile.name,
    orar: orarData,
    'custom activities': exportedCustom,
    'selected activities': exportedSelected,
    'defined weekdays': profile.didacticWeeks || [],
  }
}

/**
 * Trigger download of the profile as a JSON file in the browser.
 */
export function downloadProfileJson(
  profile: Profile,
  activityMap: Map<string, Activity>,
  orarData?: OrarData
): void {
  if (typeof window === 'undefined') return
  const data = buildProfileExportData(profile, activityMap, orarData)
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const sanitizedName = (profile.name || 'profile')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, '_')
  const fileName = `${sanitizedName || 'profile'}.json`

  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
