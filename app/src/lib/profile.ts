import type {
  Activity,
  CustomActivity,
  DidacticWeekSpec,
  ExportedActivity,
  ExportedProfileData,
  Profile,
} from '@/types/timetable'
import { NULL_UUID } from '@/types/timetable'
export { NULL_UUID }

import { v4 as uuidv4 } from 'uuid'
export { uuidv4 }

export const STORAGE_KEY_PROFILES = 'orar_profiles'
export const STORAGE_KEY_ACTIVE_PROFILE_ID = 'orar_active_profile_id'

export const DEFAULT_PROFILE: Profile = {
  id: NULL_UUID,
  name: 'Default',
  selectedActivityKeys: [],
  customActivities: [],
  didacticWeeks: [],
}

/**
 * Generate a standard UUID v4 string.
 */
export const generateUUID = uuidv4

import { profilesSchema, activeProfileIdSchema } from '@/lib/schemas'

/**
 * Load all profiles from localStorage.
 * Ensures the Default profile (NULL_UUID) always exists.
 */
export function getProfiles(): Profile[] {
  if (typeof window === 'undefined') return [DEFAULT_PROFILE]
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PROFILES)
    let json: unknown
    try {
      json = raw ? JSON.parse(raw) : undefined
    } catch {
      json = undefined
    }

    // Auto-prepend DEFAULT_PROFILE if missing in an array
    if (Array.isArray(json) && !json.some((p) => p && p.id === NULL_UUID)) {
      json = [DEFAULT_PROFILE, ...json]
    }

    const result = profilesSchema.safeParse(json)
    if (result.success) {
      return result.data as Profile[]
    }

    console.warn('Profiles validation failed, falling back to default profile:', result.error)
    saveProfiles([DEFAULT_PROFILE])
    return [DEFAULT_PROFILE]
  } catch (e) {
    console.error('Failed to load profiles from localStorage', e)
    return [DEFAULT_PROFILE]
  }
}

/**
 * Save all profiles to localStorage.
 */
export function saveProfiles(profiles: Profile[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(profiles))
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
    saveActiveProfileId(fallbackId)
    return fallbackId
  } catch {
    return NULL_UUID
  }
}

/**
 * Save the active profile ID to localStorage.
 */
export function saveActiveProfileId(id: string): void {
  if (typeof window === 'undefined') return
  try {
    const result = activeProfileIdSchema.safeParse(id)
    if (!result.success) {
      console.warn('Invalid active profile ID provided to saveActiveProfileId:', id)
      return
    }
    localStorage.setItem(STORAGE_KEY_ACTIVE_PROFILE_ID, result.data)
  } catch (e) {
    console.error('Failed to save active profile ID to localStorage', e)
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
 * Match an activity by value against all activities in DATA.json.
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
  selectedActivityKeys: string[]
  customActivities: CustomActivity[]
  didacticWeeks: DidacticWeekSpec[]
  matchedSelectedCount: number
  totalSelectedImported: number
  customCount: number
}

/**
 * Parse and validate an imported profile JSON file.
 * Categorizes custom activities into custom activities,
 * matches selected activities by value to DATA.json (dropping non-matches),
 * and parses defined weekdays if present.
 */
export function parseImportedProfileJson(
  jsonString: string,
  allActivities: Activity[]
): ParseImportResult {
  const parsed = JSON.parse(jsonString)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid JSON format: expected an object.')
  }

  const name = typeof parsed.name === 'string' ? parsed.name.trim() : ''

  // 1. Process custom activities
  const rawCustom = parsed['custom activities'] || parsed.custom_activities || parsed.customActivities || []
  const customActivitiesList: CustomActivity[] = []

  const processCustomItem = (item: any) => {
    if (!item || typeof item !== 'object') return
    const weekday = item.start_time?.weekday || item.weekday || 'Luni'
    const startHour = typeof item.start_time?.hour === 'number' ? item.start_time.hour : 8
    const startMin = typeof item.start_time?.minute === 'number' ? item.start_time.minute : 0
    const endHour = typeof item.end_time?.hour === 'number' ? item.end_time.hour : 9
    const endMin = typeof item.end_time?.minute === 'number' ? item.end_time.minute : 50

    let periodicityVal: 'Odd Week' | 'Even Week' | null = null
    const normPeriod = normalizePeriodicity(item.periodicity)
    if (normPeriod === 'odd') periodicityVal = 'Odd Week'
    else if (normPeriod === 'even') periodicityVal = 'Even Week'

    const locationStr =
      typeof item.location === 'string'
        ? item.location
        : item.location && typeof item.location === 'object'
          ? `${item.location.type || ''} ${item.location.id ?? ''}`.trim()
          : null

    customActivitiesList.push({
      id: `custom-${generateUUID()}`,
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
    })
  }

  if (Array.isArray(rawCustom)) {
    rawCustom.forEach(processCustomItem)
  }

  // 2. Process selected activities
  const rawSelected =
    parsed['selected activities'] || parsed.selected_activities || parsed.selectedActivities || []
  const matchedSelectedKeysSet = new Set<string>()
  let totalSelectedImported = 0

  if (Array.isArray(rawSelected)) {
    totalSelectedImported = rawSelected.length
    rawSelected.forEach((item: any) => {
      if (!item || typeof item !== 'object') return

      // If marked as custom, route to custom activities
      if (item.is_custom === true || normalizeString(item.type) === 'custom') {
        processCustomItem(item)
        return
      }

      // Match by value against DATA.json
      const matched = matchActivityByValue(item, allActivities)
      if (matched) {
        matchedSelectedKeysSet.add(matched.id)
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
          id: typeof item.id === 'string' ? item.id : `week-${generateUUID()}`,
          date: item.date,
          weekNumber: item.weekNumber,
        })
      }
    })
  }

  return {
    name,
    selectedActivityKeys: Array.from(matchedSelectedKeysSet),
    customActivities: customActivitiesList,
    didacticWeeks: didacticWeeksList,
    matchedSelectedCount: matchedSelectedKeysSet.size,
    totalSelectedImported,
    customCount: customActivitiesList.length,
  }
}

/**
 * Generate the JSON payload for a profile to export.
 */
export function buildProfileExportData(
  profile: Profile,
  activityMap: Map<string, Activity>
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
  activityMap: Map<string, Activity>
): void {
  if (typeof window === 'undefined') return
  const data = buildProfileExportData(profile, activityMap)
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
