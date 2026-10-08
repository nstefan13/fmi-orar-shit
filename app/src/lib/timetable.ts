import fuzzysort from 'fuzzysort'
import type { Activity, Timetable, DidacticWeekSpec, CustomActivity } from '@/types/timetable'
import {
  didacticWeeksSchema,
  selectedActivitiesSchema,
  customActivitiesSchema,
  selectedDaySchema,
} from '@/lib/schemas'

export const STORAGE_KEY_SELECTED_ACTIVITIES = 'orar_selected_activities'
export const STORAGE_KEY_DIDACTIC_WEEKS = 'orar_didactic_weeks'
export const STORAGE_KEY_CUSTOM_ACTIVITIES = 'orar_custom_activities'
export const STORAGE_KEY_SELECTED_DAY = 'orar_selected_day'

/**
 * Read didactic week specifications from localStorage.
 */
export function getDidacticWeeks(): DidacticWeekSpec[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DIDACTIC_WEEKS)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    const result = didacticWeeksSchema.safeParse(parsed)
    return result.success ? result.data : []
  } catch (e) {
    console.error('Failed to load didactic weeks from localStorage', e)
    return []
  }
}

/**
 * Save didactic week specifications to localStorage.
 */
export function saveDidacticWeeks(weeks: DidacticWeekSpec[]): void {
  if (typeof window === 'undefined') return
  try {
    const result = didacticWeeksSchema.safeParse(weeks)
    if (!result.success) {
      console.warn('Invalid didactic weeks provided to saveDidacticWeeks:', result.error)
      return
    }
    localStorage.setItem(STORAGE_KEY_DIDACTIC_WEEKS, JSON.stringify(result.data))
  } catch (e) {
    console.error('Failed to save didactic weeks to localStorage', e)
  }
}

/**
 * Format a Date object to YYYY-MM-DD string.
 */
export function formatDateString(d: Date): string {
  const y = d.getFullYear()
  const m = d.getMonth() + 1 < 10 ? `0${d.getMonth() + 1}` : `${d.getMonth() + 1}`
  const day = d.getDate() < 10 ? `0${d.getDate()}` : `${d.getDate()}`
  return `${y}-${m}-${day}`
}

/**
 * Get the Monday of the week for a given date.
 */
export function getMondayOfDate(d: Date): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
  const day = date.getDay() // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const diff = date.getDate() - day + (day === 0 ? -6 : 1)
  date.setDate(diff)
  date.setHours(0, 0, 0, 0)
  return date
}

/**
 * Get the first Monday of October for a given academic year.
 */
export function getFirstMondayOfOctober(year: number): Date {
  const d = new Date(year, 9, 1, 0, 0, 0, 0) // Month index 9 = October
  const day = d.getDay()
  const diff = day === 1 ? 0 : day === 0 ? 1 : 8 - day
  return new Date(year, 9, 1 + diff, 0, 0, 0, 0)
}

/**
 * Get the third Monday of February for Semester 2.
 */
export function getThirdMondayOfFebruary(year: number): Date {
  const d = new Date(year, 1, 1, 0, 0, 0, 0) // Month index 1 = February
  const day = d.getDay()
  const firstMondayDate = day === 1 ? 1 : day === 0 ? 2 : 1 + (8 - day)
  return new Date(year, 1, firstMondayDate + 14, 0, 0, 0, 0)
}

/**
 * Deduces a default didactic week number for university academic calendars.
 * Semester 1 begins on the first Monday of October.
 * Semester 2 begins mid-February.
 */
export function getDefaultAcademicWeek(date: Date): number {
  const year = date.getFullYear()
  const month = date.getMonth() // 0 = Jan, ..., 9 = Oct

  let semesterStartMonday: Date

  if (month >= 9) {
    // Oct, Nov, Dec -> Semester 1
    semesterStartMonday = getFirstMondayOfOctober(year)
  } else if (month === 0) {
    // Jan -> Semester 1 of academic year started previous year
    semesterStartMonday = getFirstMondayOfOctober(year - 1)
  } else if (month >= 1 && month <= 6) {
    // Feb - Jul -> Semester 2
    semesterStartMonday = getThirdMondayOfFebruary(year)
  } else {
    // Aug, Sep -> Late summer / upcoming semester 1
    semesterStartMonday = getFirstMondayOfOctober(year)
  }

  const targetMonday = getMondayOfDate(date)
  const msPerWeek = 7 * 24 * 60 * 60 * 1000
  const diffWeeks = Math.round((targetMonday.getTime() - semesterStartMonday.getTime()) / msPerWeek)

  const deducedWeek = 1 + diffWeeks
  return Math.max(1, Math.min(deducedWeek, 14))
}

/**
 * Find out the didactic week number for a given date.
 * If no days were specified in the settings: deduces default academic week (starts 1st Monday of Oct / mid-Feb).
 * 1. If date is within the days specified, returns that week number.
 * 2. Otherwise, retrieves the closest day before date and deduces the current week.
 * 3. If target date is before the earliest spec, deduces backwards.
 * 4. If no specs specified, returns default academic week.
 */
export function getDidacticWeekForDate(
  date: Date,
  specs?: DidacticWeekSpec[]
): number | null {
  const rawList = specs ?? getDidacticWeeks()
  const valid = rawList.filter((s) => {
    if (!s || !s.date || typeof s.weekNumber !== 'number' || isNaN(s.weekNumber)) {
      return false
    }
    const parts = s.date.split('-').map(Number)
    return parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])
  })

  if (valid.length === 0) {
    return getDefaultAcademicWeek(date)
  }

  const targetDateStr = formatDateString(date)

  // 1. Exact match with a user-specified day
  const exactMatch = valid.find((s) => s.date === targetDateStr)
  if (exactMatch) {
    return exactMatch.weekNumber
  }

  // Target midnight timestamp
  const targetMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

  // 2. Filter days that happened strictly before current day
  const pastSpecs = valid.filter((s) => {
    const [y, m, d] = s.date.split('-').map(Number)
    const specMidnight = new Date(y, m - 1, d).getTime()
    return specMidnight < targetMidnight
  })

  // 3. If no day before current day => deduce backwards from the earliest spec
  if (pastSpecs.length === 0) {
    const sortedAsc = [...valid].sort((a, b) => {
      const [ay, am, ad] = a.date.split('-').map(Number)
      const [by, bm, bd] = b.date.split('-').map(Number)
      return new Date(ay, am - 1, ad).getTime() - new Date(by, bm - 1, bd).getTime()
    })
    const earliest = sortedAsc[0]
    const [ey, em, ed] = earliest.date.split('-').map(Number)
    const earliestDate = new Date(ey, em - 1, ed)
    const mondayEarliest = getMondayOfDate(earliestDate)
    const mondayTarget = getMondayOfDate(date)
    const msPerWeek = 7 * 24 * 60 * 60 * 1000
    const diffWeeks = Math.round((mondayTarget.getTime() - mondayEarliest.getTime()) / msPerWeek)
    const deduced = earliest.weekNumber + diffWeeks
    return Math.max(1, deduced)
  }

  // Sort descending by date to find closest past day
  pastSpecs.sort((a, b) => {
    const [ay, am, ad] = a.date.split('-').map(Number)
    const [by, bm, bd] = b.date.split('-').map(Number)
    return new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime()
  })

  const closest = pastSpecs[0]
  const [cy, cm, cd] = closest.date.split('-').map(Number)
  const closestDate = new Date(cy, cm - 1, cd)

  const mondayClosest = getMondayOfDate(closestDate)
  const mondayTarget = getMondayOfDate(date)

  const msPerWeek = 7 * 24 * 60 * 60 * 1000
  const diffWeeks = Math.round((mondayTarget.getTime() - mondayClosest.getTime()) / msPerWeek)

  return Math.max(1, closest.weekNumber + diffWeeks)
}

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
    const result = selectedActivitiesSchema.safeParse(parsed)
    if (!result.success) return new Set()
    const valid = result.data.filter((k) => typeof k === 'string' && k.trim().length > 0)
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
    const result = selectedActivitiesSchema.safeParse(arr)
    if (!result.success) {
      console.warn('Invalid selected activity keys provided to saveSelectedActivityKeys:', result.error)
      return
    }
    localStorage.setItem(STORAGE_KEY_SELECTED_ACTIVITIES, JSON.stringify(result.data))
  } catch (e) {
    console.error('Failed to save selected activities to localStorage', e)
  }
}

/**
 * Read custom activities from localStorage.
 */
export function getCustomActivities(): CustomActivity[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CUSTOM_ACTIVITIES)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    const result = customActivitiesSchema.safeParse(parsed)
    return result.success ? (result.data as CustomActivity[]) : []
  } catch (e) {
    console.error('Failed to load custom activities from localStorage', e)
    return []
  }
}

/**
 * Save custom activities to localStorage.
 */
export function saveCustomActivities(activities: CustomActivity[]): void {
  if (typeof window === 'undefined') return
  try {
    const result = customActivitiesSchema.safeParse(activities)
    if (!result.success) {
      console.warn('Invalid custom activities provided to saveCustomActivities:', result.error)
      return
    }
    localStorage.setItem(STORAGE_KEY_CUSTOM_ACTIVITIES, JSON.stringify(result.data))
  } catch (e) {
    console.error('Failed to save custom activities to localStorage', e)
  }
}

/**
 * Returns the default weekday index (1-5).
 * Monday = 1, ..., Friday = 5.
 * Defaults to current day if Monday-Friday, otherwise Monday (1).
 */
export function getDefaultDay(): number {
  const todayDay = new Date().getDay()
  if (todayDay >= 1 && todayDay <= 5) return todayDay
  return 1
}

/**
 * Read the selected weekday index (1-5) from sessionStorage.
 * Defaults to current day.
 */
export function getSelectedDay(): number {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') {
    return getDefaultDay()
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_SELECTED_DAY)
    if (raw !== null) {
      const parsed = Number(raw)
      const result = selectedDaySchema.safeParse(parsed)
      if (result.success) {
        return result.data
      }
    }
  } catch (e) {
    console.error('Failed to load selected day from sessionStorage', e)
  }
  return getDefaultDay()
}

/**
 * Save the selected weekday index (1-5) to sessionStorage.
 */
export function saveSelectedDay(day: number): void {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') {
    return
  }
  try {
    const result = selectedDaySchema.safeParse(day)
    if (result.success) {
      sessionStorage.setItem(STORAGE_KEY_SELECTED_DAY, String(result.data))
    }
  } catch (e) {
    console.error('Failed to save selected day to sessionStorage', e)
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
 * @param didacticWeeks Optional list of didactic week specifications; defaults to reading localStorage
 * @param customActivities Optional list of custom activities; defaults to reading localStorage
 * @returns A list of activities as they are found in the DATA + enabled custom activities
 */
export function activitiesForToday(
  data: Timetable[],
  today: Date,
  optionalSelectedKeys?: Set<string>,
  didacticWeeks?: DidacticWeekSpec[],
  customActivities?: CustomActivity[]
): Activity[] {
  const dayIndex = today.getDay()
  const weekdayName = WEEKDAY_MAP[dayIndex]
  if (!weekdayName) {
    // Weekend or unknown weekday
    return []
  }

  const selectedKeys = optionalSelectedKeys ?? getSelectedActivityKeys()
  const customList = customActivities ?? getCustomActivities()
  const activeCustomList = customList.filter(
    (c) => c.enabled && c.start_time.weekday === weekdayName
  )

  if (selectedKeys.size === 0 && activeCustomList.length === 0) {
    return []
  }

  const currentWeekNumber = getDidacticWeekForDate(today, didacticWeeks)

  const activities: Activity[] = []

  for (const timetable of data) {
    for (const activity of timetable.activities) {
      const actWeekday = activity.start_time?.weekday || activity.weekday
      if (actWeekday === weekdayName) {
        if (selectedKeys.has(activity.id)) {
          const act: Activity = {
            ...activity,
            _timetableId: timetable.id,
            _timetableTitle: timetable.title,
          }

          // Set should_blur only if activity has periodicity of 'odd' or 'even'
          if (currentWeekNumber !== null && currentWeekNumber !== undefined) {
            const period = activity.periodicity?.toLowerCase().trim()
            if (period === 'odd') {
              act.should_blur = currentWeekNumber % 2 === 0
            } else if (period === 'even') {
              act.should_blur = currentWeekNumber % 2 !== 0
            }
          }

          activities.push(act)
        }
      }
    }
  }

  // Include active custom activities for today
  for (const customAct of activeCustomList) {
    let should_blur = false
    if (currentWeekNumber !== null && currentWeekNumber !== undefined && customAct.periodicity) {
      if (customAct.periodicity === 'odd') {
        should_blur = currentWeekNumber % 2 === 0
      } else if (customAct.periodicity === 'even') {
        should_blur = currentWeekNumber % 2 !== 0
      }
    }

    activities.push({
      id: customAct.id,
      name: customAct.name,
      weekday: customAct.start_time.weekday,
      start_time: customAct.start_time,
      end_time: customAct.end_time,
      type: 'Custom',
      authors: customAct.authors || [],
      location: customAct.location || null,
      periodicity: customAct.periodicity || null,
      subgroup: null,
      _timetableId: 'custom',
      _timetableTitle: 'Custom Activities',
      should_blur,
      is_custom: true,
    })
  }

  // Sort activities by start hour and minute
  activities.sort((a, b) => {
    if (a.start_time.hour !== b.start_time.hour) {
      return a.start_time.hour - b.start_time.hour
    }
    return a.start_time.minute - b.start_time.minute
  })

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
        weekday: a.start_time?.weekday || a.weekday || '',
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

/**
 * Sorts timetable display groups so that:
 * 1. Fully selected timetables (all displayed activities selected) are at the top (priority 0)
 * 2. Half selected timetables (some displayed activities selected) are next (priority 1)
 * 3. Unselected timetables (no displayed activities selected) are at the bottom (priority 2)
 *
 * Preserves the original relative order within each priority group.
 */
export function sortTimetableDisplayGroups(
  groups: TimetableDisplayGroup[],
  selectedActivityKeys: Set<string>
): TimetableDisplayGroup[] {
  if (groups.length <= 1) return groups

  const priorityMap = new Map<string, number>()
  for (const group of groups) {
    const total = group.activities.length
    if (total === 0) {
      priorityMap.set(group.timetableId, 2)
      continue
    }
    let selected = 0
    for (const act of group.activities) {
      if (selectedActivityKeys.has(act.id)) {
        selected++
      }
    }
    const priority = selected === total ? 0 : selected > 0 ? 1 : 2
    priorityMap.set(group.timetableId, priority)
  }

  return [...groups].sort((a, b) => {
    return (priorityMap.get(a.timetableId) ?? 2) - (priorityMap.get(b.timetableId) ?? 2)
  })
}

