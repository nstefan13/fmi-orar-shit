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
  location: ActivityLocation | null
  periodicity: string | null
  subgroup: string | number | null
  _timetableId?: string
  _timetableTitle?: string
  should_blur?: boolean
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
  id: string
  date: string // 'YYYY-MM-DD'
  weekNumber: number
}