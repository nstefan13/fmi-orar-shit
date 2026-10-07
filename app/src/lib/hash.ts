import objectHash from 'object-hash'
import type { Activity, CustomActivity, Timetable } from '@/types/timetable'

export interface Schema01Activity {
  start_time: {
    weekday: string
    hour: number
    minute: number
  }
  end_time: {
    weekday: string
    hour: number
    minute: number
  }
  name: string
  type: string | null
  authors: string[]
  location: any
  periodicity: string | null
  subgroup: string | number | null
}

/**
 * Normalizes an activity or custom activity into the exact [SCHEMA-01] shape.
 * All 8 keys are explicitly guaranteed to exist.
 */
export function activityToSchema01(
  act: Partial<Activity>
): Schema01Activity {
  return {
    start_time: {
      weekday: act.start_time?.weekday ?? '',
      hour: act.start_time?.hour ?? 0,
      minute: act.start_time?.minute ?? 0,
    },
    end_time: {
      weekday: act.end_time?.weekday ?? '',
      hour: act.end_time?.hour ?? 0,
      minute: act.end_time?.minute ?? 0,
    },
    name: act.name ?? '',
    type: act.type !== undefined ? act.type : null,
    authors: Array.isArray(act.authors) ? act.authors : [],
    location: act.location !== undefined ? act.location : null,
    periodicity: act.periodicity !== undefined ? act.periodicity : null,
    subgroup: act.subgroup !== undefined ? act.subgroup : null,
  }
}

/**
 * Normalizes a custom activity into [SCHEMA-01] shape:
 * type is 'Custom' and subgroup is null.
 */
export function customActivityToSchema01(
  act: Partial<CustomActivity>
): Schema01Activity {
  return {
    start_time: {
      weekday: act.start_time?.weekday ?? '',
      hour: act.start_time?.hour ?? 0,
      minute: act.start_time?.minute ?? 0,
    },
    end_time: {
      weekday: act.end_time?.weekday ?? '',
      hour: act.end_time?.hour ?? 0,
      minute: act.end_time?.minute ?? 0,
    },
    name: act.name ?? '',
    type: 'Custom',
    authors: Array.isArray(act.authors) ? act.authors : [],
    location: act.location !== undefined ? act.location : null,
    periodicity: act.periodicity !== undefined ? act.periodicity : null,
    subgroup: null,
  }
}

/**
 * Computes the object-hash (SHA1) of a [SCHEMA-01] activity.
 */
export function computeActivityHash(schema01: Schema01Activity): string {
  return objectHash(schema01)
}

/**
 * Generates an activity ID in the format: tt:<num>-ac:<hash>
 */
export function computeActivityId(timetableIdOrNum: string, schema01: Schema01Activity): string {
  const num = timetableIdOrNum.replace(/^(IMG-|tt:)/, '')
  const hash = computeActivityHash(schema01)
  return `tt:${num}-ac:${hash}`
}

/**
 * Generates a custom activity ID in the format: custom-ac:<hash>
 */
export function computeCustomActivityId(act: Partial<CustomActivity>): string {
  const schema01 = customActivityToSchema01(act)
  const hash = computeActivityHash(schema01)
  return `custom-ac:${hash}`
}

/**
 * Extracts the content hash from an activity id:
 * For 'tt:001-ac:<hash>' -> returns '<hash>'
 * For 'custom-ac:<hash>' -> returns '<hash>'
 * For other string -> returns null or the string itself
 */
export function extractContentHashFromId(id: string): string | null {
  const acIdx = id.indexOf('-ac:')
  if (acIdx !== -1) {
    return id.slice(acIdx + 4)
  }
  return null
}

export interface SanitizedTimetable {
  id: string
  title: string
  activities: Schema01Activity[]
}

/**
 * Computes root ORAR hash from a list of timetables:
 * Each timetable object only has fields 'id', 'title', and 'activities',
 * and each activity is in [SCHEMA-01] format.
 */
export function computeOrarHash(timetables: Timetable[]): string {
  const sanitized: SanitizedTimetable[] = timetables.map((t) => {
    const ttId = t.id.startsWith('tt:') ? t.id : `tt:${t.id.replace(/^IMG-/, '')}`
    return {
      id: ttId,
      title: t.title,
      activities: t.activities.map((a) => activityToSchema01(a)),
    }
  })
  return objectHash(sanitized)
}
