import fuzzysort from 'fuzzysort'
import type { Activity, Timetable } from '@/types/timetable'

export const STORAGE_KEY_SELECTED_ACTIVITIES = 'orar_selected_activities'

/**
 * Format activity name per requirement:
 * "{name} ({type}) SG-{subgroup}"
 * If type is null: "{name} SG-{subgroup}"
 * If subgroup is null/empty: "{name} ({type})"
 * If both are missing: "{name}"
 */
export function formatActivityName(activity: {
  name: string
  type?: string | null
  subgroup?: string | number | null
}): string {
  const parts: string[] = [activity.name]
  if (activity.type) {
    parts.push(`(${activity.type})`)
  }
  if (
    activity.subgroup !== null &&
    activity.subgroup !== undefined &&
    activity.subgroup !== ''
  ) {
    parts.push(`SG-${activity.subgroup}`)
  }
  return parts.join(' ')
}

/**
 * Read selected activity IDs from localStorage.
 */
export function getSelectedActivityKeys(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SELECTED_ACTIVITIES)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    // Discard any obsolete non-ID keys (e.g. keys containing ":::")
    const valid = parsed.filter(
      (k) => typeof k === 'string' && k.startsWith('IMG-') && k.includes('_AC-')
    )
    return new Set(valid)
  } catch (e) {
    console.error('Failed to load selected activities from localStorage', e)
    return new Set()
  }
}

/**
 * Save selected activity IDs to localStorage.
 */
export function saveSelectedActivityKeys(keys: Set<string> | string[]): void {
  if (typeof window === 'undefined') return
  try {
    const arr = Array.isArray(keys) ? keys : Array.from(keys)
    localStorage.setItem(STORAGE_KEY_SELECTED_ACTIVITIES, JSON.stringify(arr))
  } catch (e) {
    console.error('Failed to save selected activities to localStorage', e)
  }
}

/**
 * Map JavaScript Date day of week (0-6) to Romanian weekday name.
 * 1 -> Luni, 2 -> Marti, 3 -> Miercuri, 4 -> Joi, 5 -> Vineri.
 */
export const WEEKDAY_MAP: Record<number, string> = {
  1: 'Luni',
  2: 'Marti',
  3: 'Miercuri',
  4: 'Joi',
  5: 'Vineri',
}

/**
 * Find out which activities belong to a day.
 * @param data The content of the entire DATA.json
 * @param today A Date object representing the day
 * @param optionalSelectedKeys Optional override for testing or reactive state; defaults to reading localStorage
 * @returns A list of activities as they are found in the DATA
 */
export function activitiesForToday(
  data: Timetable[],
  today: Date,
  optionalSelectedKeys?: Set<string>
): Activity[] {
  const dayIndex = today.getDay()
  const weekdayName = WEEKDAY_MAP[dayIndex]
  if (!weekdayName) {
    // Weekend or unknown weekday
    return []
  }

  const selectedKeys = optionalSelectedKeys ?? getSelectedActivityKeys()
  if (selectedKeys.size === 0) {
    return []
  }

  const activities: Activity[] = []

  for (const timetable of data) {
    for (const activity of timetable.activities) {
      if (activity.weekday === weekdayName) {
        if (selectedKeys.has(activity.id)) {
          activities.push({
            ...activity,
            _timetableId: timetable.id,
            _timetableTitle: timetable.title,
          })
        }
      }
    }
  }

  return activities
}

export interface PreparedSearchItem {
  id: string
  timetableId: string
  timetableTitle: string
  formattedName: string
  name: string
  type: string
  authors: string
  locationStr: string
  subgroupStr: string
  weekday: string
  activityJson: string
  timetableJson: string
  activity: Activity
}

export interface PreparedTimetableItem {
  id: string
  title: string
  timetableJson: string
}

export interface SearchIndex {
  activities: PreparedSearchItem[]
  timetables: PreparedTimetableItem[]
}

/**
 * Build search index for fast fuzzy searching over underlying JSON.
 */
export function buildSearchIndex(data: Timetable[]): SearchIndex {
  const activities: PreparedSearchItem[] = []
  const timetables: PreparedTimetableItem[] = []

  data.forEach((t) => {
    timetables.push({
      id: t.id,
      title: t.title,
      timetableJson: JSON.stringify(t),
    })

    t.activities.forEach((a) => {
      activities.push({
        id: a.id,
        timetableId: t.id,
        timetableTitle: t.title,
        formattedName: formatActivityName(a),
        name: a.name,
        type: a.type || '',
        authors: (a.authors || []).join(' '),
        locationStr: a.location
          ? typeof a.location === 'string'
            ? a.location
            : `${a.location.type} ${a.location.id}`
          : '',
        subgroupStr: a.subgroup ? `SG-${a.subgroup}` : '',
        weekday: a.weekday,
        activityJson: JSON.stringify(a),
        timetableJson: JSON.stringify({ timetableId: t.id, timetable: t.title, ...a }),
        activity: a,
      })
    })
  })

  return { activities, timetables }
}

export interface TimetableDisplayGroup {
  timetableId: string
  timetableTitle: string
  activities: Activity[]
}

/**
 * Fuzzy search timetables and activities on the underlying JSON with fuzzysort.
 */
export function searchTimetables(
  data: Timetable[],
  query: string,
  index: SearchIndex
): TimetableDisplayGroup[] {
  const q = query.trim()

  // When query is empty, return all timetables with all their activities
  if (!q) {
    return data.map((t) => ({
      timetableId: t.id,
      timetableTitle: t.title,
      activities: t.activities,
    }))
  }

  // 1. Search timetables by title or full timetable JSON
  const matchedTimetableIds = new Set<string>()
  const timetableMatches = fuzzysort.go(q, index.timetables, {
    keys: ['title', 'timetableJson'],
  })
  timetableMatches.forEach((r) => {
    matchedTimetableIds.add(r.obj.id)
  })

  // 2. Search activities by individual fields AND raw JSON
  const matchedActivitiesByTimetable = new Map<string, Activity[]>()
  const activityMatches = fuzzysort.go(q, index.activities, {
    keys: [
      'name',
      'formattedName',
      'timetableTitle',
      'authors',
      'locationStr',
      'subgroupStr',
      'type',
      'weekday',
      'activityJson',
      'timetableJson',
    ],
  })

  activityMatches.forEach((r) => {
    const tId = r.obj.timetableId
    if (!matchedActivitiesByTimetable.has(tId)) {
      matchedActivitiesByTimetable.set(tId, [])
    }
    matchedActivitiesByTimetable.get(tId)!.push(r.obj.activity)
  })

  // 3. Assemble results preserving data ordering
  const results: TimetableDisplayGroup[] = []
  data.forEach((t) => {
    const isTimetableMatched = matchedTimetableIds.has(t.id)
    const matchedActs = matchedActivitiesByTimetable.get(t.id)

    if (isTimetableMatched) {
      results.push({
        timetableId: t.id,
        timetableTitle: t.title,
        activities: t.activities,
      })
    } else if (matchedActs && matchedActs.length > 0) {
      results.push({
        timetableId: t.id,
        timetableTitle: t.title,
        activities: matchedActs,
      })
    }
  })

  return results
}
