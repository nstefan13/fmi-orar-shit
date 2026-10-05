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
 * Unique identifier for an activity under a timetable.
 */
export function getActivityKey(
  timetableTitle: string,
  activityOrFormattedName:
    | string
    | { name: string; type?: string | null; subgroup?: string | number | null }
): string {
  const formatted =
    typeof activityOrFormattedName === 'string'
      ? activityOrFormattedName
      : formatActivityName(activityOrFormattedName)
  return `${timetableTitle}:::${formatted}`
}

/**
 * Read selected activity keys from localStorage.
 */
export function getSelectedActivityKeys(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SELECTED_ACTIVITIES)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed : [])
  } catch (e) {
    console.error('Failed to load selected activities from localStorage', e)
    return new Set()
  }
}

/**
 * Save selected activity keys to localStorage.
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
        const key = getActivityKey(timetable.title, activity)
        if (selectedKeys.has(key)) {
          // Return the activity as found in DATA, with optional timetable title reference
          activities.push({
            ...activity,
            _timetableTitle: timetable.title,
          })
        }
      }
    }
  }

  return activities
}

export interface PreparedSearchItem {
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
}

export interface PreparedTimetableItem {
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
      title: t.title,
      timetableJson: JSON.stringify(t),
    })

    const seenInTimetable = new Set<string>()
    t.activities.forEach((a) => {
      const formatted = formatActivityName(a)
      if (!seenInTimetable.has(formatted)) {
        seenInTimetable.add(formatted)
        activities.push({
          timetableTitle: t.title,
          formattedName: formatted,
          name: a.name,
          type: a.type || '',
          authors: (a.authors || []).join(' '),
          locationStr: a.location ? `${a.location.type} ${a.location.id}` : '',
          subgroupStr: a.subgroup ? `SG-${a.subgroup}` : '',
          weekday: a.weekday,
          activityJson: JSON.stringify(a),
          timetableJson: JSON.stringify({ timetable: t.title, ...a }),
        })
      }
    })
  })

  return { activities, timetables }
}

export interface TimetableDisplayGroup {
  timetableTitle: string
  activities: string[] // List of distinct formatted activity names
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

  // When query is empty, return all timetables with all their unique activity formatted names
  if (!q) {
    return data.map((t) => {
      const uniqueNames = Array.from(
        new Set(t.activities.map((a) => formatActivityName(a)))
      )
      return {
        timetableTitle: t.title,
        activities: uniqueNames,
      }
    })
  }

  // 1. Search timetables by title or full timetable JSON
  const matchedTimetableTitles = new Set<string>()
  const timetableMatches = fuzzysort.go(q, index.timetables, {
    keys: ['title', 'timetableJson'],
  })
  timetableMatches.forEach((r) => {
    matchedTimetableTitles.add(r.obj.title)
  })

  // 2. Search activities by individual fields AND raw JSON
  const matchedActivitiesByTimetable = new Map<string, Set<string>>()
  const activityMatches = fuzzysort.go(q, index.activities, {
    keys: [
      'name',
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
    const tt = r.obj.timetableTitle
    if (!matchedActivitiesByTimetable.has(tt)) {
      matchedActivitiesByTimetable.set(tt, new Set())
    }
    matchedActivitiesByTimetable.get(tt)!.add(r.obj.formattedName)
  })

  // 3. Assemble results preserving data ordering
  const results: TimetableDisplayGroup[] = []
  data.forEach((t) => {
    const isTimetableMatched = matchedTimetableTitles.has(t.title)
    const matchedActs = matchedActivitiesByTimetable.get(t.title)

    if (isTimetableMatched) {
      // If the timetable itself matched, show all its activities
      const allActivities = Array.from(
        new Set(t.activities.map((a) => formatActivityName(a)))
      )
      results.push({
        timetableTitle: t.title,
        activities: allActivities,
      })
    } else if (matchedActs && matchedActs.size > 0) {
      // Show only matching activities under this timetable
      results.push({
        timetableTitle: t.title,
        activities: Array.from(matchedActs),
      })
    }
  })

  return results
}
