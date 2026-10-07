export interface Timetable {
  id: string
  title: string
  activities: Activity[]
}

export interface Activity {
  id: string
  weekday: string // 'Luni' | 'Marti' | 'Miercuri' | 'Joi' | 'Vineri'
  start_time: TimeSpec
  end_time: TimeSpec
  name: string
  type: string | null
  authors: string[]
  location: ActivityLocation | string | null
  periodicity: string | null
  subgroup: string | number | null
  _timetableId?: string
  _timetableTitle?: string
  should_blur?: boolean
  is_custom?: boolean
}

export interface TimeSpec {
  weekday: string
  hour: number
  minute: number
}

export interface ActivityLocation {
  id: number | string
  type: string
}

export interface DidacticWeekSpec {
  date: string // 'YYYY-MM-DD'
  weekNumber: number
}

export interface CustomActivity {
  id: string
  name: string
  start_time: TimeSpec
  end_time: TimeSpec
  authors: string[]
  location: string | null
  periodicity: 'odd' | 'even' | null
  enabled: boolean
}

export interface OrarData {
  created_at: string
  hash: string
  timetables: Timetable[]
}

export const NULL_UUID = '00000000-0000-0000-0000-000000000000'

export interface Profile {
  id: string // UUID (Default profile has NULL_UUID)
  name: string
  orar_hash: string
  selectedActivityKeys: string[] // IDs matching Activity.id in ORAR.json
  customActivities: CustomActivity[]
  didacticWeeks: DidacticWeekSpec[]
}

export interface ExportedActivity {
  name: string
  type?: string | null
  start_time: TimeSpec
  end_time: TimeSpec
  authors: string[]
  location: ActivityLocation | string | null
  periodicity: string | null
  subgroup: string | number | null
}

export interface ExportedProfileData {
  name: string
  orar?: OrarData
  'custom activities': ExportedActivity[]
  'selected activities': ExportedActivity[]
  'defined weekdays'?: DidacticWeekSpec[]
}