export interface TimeSpec {
  weekday: string
  hour: number
  minute: number
}

export interface ActivityLocation {
  id: number | string
  type: string
}

export interface Activity {
  weekday: string // 'Luni' | 'Marti' | 'Miercuri' | 'Joi' | 'Vineri'
  start_time: TimeSpec
  end_time: TimeSpec
  name: string
  type: string | null
  authors: string[]
  location: ActivityLocation | null
  periodicity: string | null
  subgroup: string | number | null
  _timetableTitle?: string
}

export interface Timetable {
  title: string
  activities: Activity[]
}
