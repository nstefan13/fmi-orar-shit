import * as React from 'react'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/react/timegrid'
import type { Activity, Timetable, DidacticWeekSpec, CustomActivity } from '@/types/timetable'
import {
  activitiesForToday,
  formatActivityName,
  getDidacticWeekForDate,
  getDefaultDay,
} from '@/lib/timetable'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@/components/ui/empty'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ActivityDetailsDialog } from '@/components/ActivityDetailsDialog'
import { CalendarIcon, MapPinIcon, UserIcon } from 'lucide-react'

// FullCalendar stylesheets
import '@fullcalendar/react/skeleton.css'
import '@fullcalendar/react/themes/monarch/theme.css'
import '@fullcalendar/react/themes/monarch/palettes/purple.css'

interface ScheduleViewProps {
  data: Timetable[]
  selectedActivityKeys: Set<string>
  onNavigateToSettings: () => void
  didacticWeeks?: DidacticWeekSpec[]
  customActivities?: CustomActivity[]
}

const WEEKDAYS = [
  { key: 1, label: 'Lu', full: 'Luni' },
  { key: 2, label: 'Ma', full: 'Marți' },
  { key: 3, label: 'Mi', full: 'Miercuri' },
  { key: 4, label: 'Jo', full: 'Joi' },
  { key: 5, label: 'Vi', full: 'Vineri' },
]

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function getMondayOfCurrentWeek(referenceDate: Date): Date {
  const d = new Date(referenceDate)
  const day = d.getDay()
  // day: 0 = Sun, 1 = Mon, ..., 6 = Sat
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function getDateForWeekdayIndex(monday: Date, weekdayIndex: number): Date {
  const d = new Date(monday)
  d.setDate(monday.getDate() + (weekdayIndex - 1))
  return d
}

function formatDateString(d: Date): string {
  const y = d.getFullYear()
  const m = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  return `${y}-${m}-${day}`
}

export function ScheduleView({
  data,
  selectedActivityKeys,
  onNavigateToSettings,
  didacticWeeks,
  customActivities,
}: ScheduleViewProps) {
  const calendarRef = React.useRef<any>(null)

  // Calculate default day: if Monday-Friday, use today; if weekend, default to Monday
  const [selectedWeekdayIndex, setSelectedWeekdayIndex] = React.useState<number>(getDefaultDay)

  const [selectedActivityForModal, setSelectedActivityForModal] =
    React.useState<Activity | null>(null)

  const [currentMonday] = React.useState(() => getMondayOfCurrentWeek(new Date()))

  const activeDate = React.useMemo(() => {
    return getDateForWeekdayIndex(currentMonday, selectedWeekdayIndex)
  }, [currentMonday, selectedWeekdayIndex])

  const activeDateStr = React.useMemo(() => formatDateString(activeDate), [activeDate])

  // Call activitiesForToday(data, activeDate) as required
  const todaysActivities = React.useMemo(() => {
    return activitiesForToday(data, activeDate, selectedActivityKeys, didacticWeeks, customActivities)
  }, [data, activeDate, selectedActivityKeys, didacticWeeks, customActivities])

  const currentWeekNumber = React.useMemo(() => {
    return getDidacticWeekForDate(activeDate, didacticWeeks)
  }, [activeDate, didacticWeeks])

  // Sync calendar date when activeDate changes
  React.useEffect(() => {
    if (calendarRef.current) {
      const calendarApi = calendarRef.current.getApi()
      calendarApi.gotoDate(activeDate)
    }
  }, [activeDate])

  // Convert activities to FullCalendar events
  const calendarEvents = React.useMemo(() => {
    return todaysActivities.map((act) => {
      const startTimeStr = `${activeDateStr}T${pad(act.start_time.hour)}:${pad(act.start_time.minute)}:00`

      // For display only, round end time up to the next full hour (e.g. 10:50 -> 11:00)
      const endHour =
        act.end_time.minute > 0 ? act.end_time.hour + 1 : act.end_time.hour
      const endMinute = 0
      const displayEndTimeStr = `${activeDateStr}T${pad(endHour)}:${pad(endMinute)}:00`

      return {
        id: act.id,
        title: formatActivityName(act),
        start: startTimeStr,
        end: displayEndTimeStr,
        className: act.should_blur ? 'opacity-40 transition-opacity' : '',
        extendedProps: {
          activity: act,
        },
      }
    })
  }, [todaysActivities, activeDateStr])

  const hasAnyActivities =
    selectedActivityKeys.size > 0 ||
    Boolean(customActivities && customActivities.some((c) => c.enabled !== false))

  return (
    <div className="flex flex-1 min-h-0 h-full flex-col overflow-hidden bg-background">
      {/* Daily Calendar Area */}
      <div className="relative flex-1 min-h-0 overflow-hidden p-2 sm:p-4">
        {!hasAnyActivities ? (
          <div className="flex h-full items-center justify-center p-6">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarIcon />
                </EmptyMedia>
                <EmptyTitle>No activities selected</EmptyTitle>
                <EmptyDescription>
                  Head to Settings to choose the timetables and activities you want to see in your schedule.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={onNavigateToSettings}>
                  Go to Settings
                </Button>
              </EmptyContent>
            </Empty>
          </div>
        ) : todaysActivities.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarIcon />
                </EmptyMedia>
                <EmptyTitle>
                  Free day on {WEEKDAYS.find((w) => w.key === selectedWeekdayIndex)?.full}!
                </EmptyTitle>
                <EmptyDescription>
                  You have no scheduled activities for this day from your selected courses.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : (
          <FullCalendar
            ref={calendarRef}
            plugins={[timeGridPlugin]}
            initialView="timeGridDay"
            initialDate={activeDate}
            events={calendarEvents}
            slotEventOverlap={false}
            editable={false}
            eventStartEditable={false}
            eventDurationEditable={false}
            droppable={false}
            allDaySlot={false}
            slotMinTime="08:00:00"
            slotMaxTime="21:00:00"
            slotDuration="01:00:00"
            slotHeaderFormat={{
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }}
            eventTimeFormat={{
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }}
            nowIndicator={true}
            headerToolbar={false}
            dayHeaderContent={(info) => {
              const d = info.date
              const weekday = d.toLocaleDateString('en-US', { weekday: 'long' })
              const day = d.getDate()
              const month = d.toLocaleDateString('en-US', { month: 'long' })
              return (
                <div
                  data-slot="calendar-day-header"
                  className="inline-flex items-center justify-center gap-2.5 px-3 py-1"
                >
                  <span className="leading-none">
                    {weekday}, {day} {month}
                  </span>
                  {currentWeekNumber !== null && (
                    <span
                      data-slot="calendar-week-badge"
                      className="inline-flex items-center text-[11px] font-mono font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 leading-none"
                    >
                      Week {currentWeekNumber}
                    </span>
                  )}
                </div>
              )
            }}
            height="100%"
            expandRows={true}
            eventClick={(info) => {
              const act = info.event.extendedProps.activity as Activity
              if (act) {
                setSelectedActivityForModal(act)
              }
            }}
            eventContent={(eventInfo) => {
              const act = eventInfo.event.extendedProps.activity as Activity
              const isBlurred = Boolean(act.should_blur)
              return (
                <div
                  className={`flex h-[calc(100%-3px)] mb-[3px] w-full cursor-pointer flex-col justify-between overflow-hidden rounded-md border-l-4 border-l-primary bg-primary/10 p-1.5 text-xs text-foreground shadow-md shadow-black/10 dark:shadow-black/60 transition-all hover:bg-primary/20 hover:shadow-lg ${isBlurred ? 'opacity-40' : ''
                    }`}
                >
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold leading-tight line-clamp-1">
                        {act.name}
                      </span>
                      {act.type && (
                        <Badge
                          variant="secondary"
                          className="px-1 py-0 text-[10px] uppercase font-bold"
                        >
                          {act.type}
                        </Badge>
                      )}
                    </div>
                    {act.subgroup && (
                      <span className="text-[10px] text-muted-foreground font-medium">
                        SG-{act.subgroup}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground mt-1">
                    {act.location && (
                      <span className="inline-flex items-center gap-0.5 font-mono">
                        <MapPinIcon className="size-2.5" />
                        {typeof act.location === 'string'
                          ? act.location
                          : `${act.location.type} ${act.location.id}`}
                      </span>
                    )}
                    {act.authors && act.authors.length > 0 && (
                      <span className="inline-flex items-center gap-0.5 truncate max-w-[120px]">
                        <UserIcon className="size-2.5" />
                        {act.authors.join(', ')}
                      </span>
                    )}
                  </div>
                </div>
              )
            }}
          />
        )}
      </div>

      {/* 5 centered weekday buttons at the bottom of the screen */}
      <nav
        aria-label="Weekday selection"
        className="sticky bottom-0 z-30 border-t border-border/80 bg-background/95 px-4 py-3 backdrop-blur supports-backdrop-filter:bg-background/80"
      >
        <ToggleGroup
          value={[String(selectedWeekdayIndex)]}
          onValueChange={(val) => {
            if (val && val.length > 0 && val[0]) {
              setSelectedWeekdayIndex(Number(val[0]))
            }
          }}
          variant="outline"
          spacing={2}
          className="mx-auto flex max-w-sm w-full"
        >
          {WEEKDAYS.map((wd) => (
            <ToggleGroupItem
              key={wd.key}
              value={String(wd.key)}
              className="flex-1 font-medium text-xs sm:text-sm"
              title={wd.full}
            >
              {wd.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </nav>

      {/* Activity Details Dialog */}
      <ActivityDetailsDialog
        activity={selectedActivityForModal}
        open={Boolean(selectedActivityForModal)}
        onOpenChange={(open) => {
          if (!open) setSelectedActivityForModal(null)
        }}
      />
    </div>
  )
}
