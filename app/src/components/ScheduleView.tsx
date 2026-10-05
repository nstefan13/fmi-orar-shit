import * as React from 'react'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/react/timegrid'
import type { Activity, Timetable } from '@/types/timetable'
import { activitiesForToday, formatActivityName } from '@/lib/timetable'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { CalendarIcon, ClockIcon, MapPinIcon, UserIcon, BookOpenIcon, InfoIcon } from 'lucide-react'

// FullCalendar stylesheets
import '@fullcalendar/react/skeleton.css'
import '@fullcalendar/react/themes/monarch/theme.css'
import '@fullcalendar/react/themes/monarch/palettes/purple.css'

interface ScheduleViewProps {
  data: Timetable[]
  selectedActivityKeys: Set<string>
  onNavigateToSettings: () => void
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
}: ScheduleViewProps) {
  const calendarRef = React.useRef<any>(null)

  // Calculate default day: if Monday-Friday, use today; if weekend, default to Monday
  const [selectedWeekdayIndex, setSelectedWeekdayIndex] = React.useState<number>(() => {
    const todayDay = new Date().getDay()
    if (todayDay >= 1 && todayDay <= 5) return todayDay
    return 1
  })

  const [selectedActivityForModal, setSelectedActivityForModal] =
    React.useState<Activity | null>(null)

  const currentMonday = React.useMemo(() => getMondayOfCurrentWeek(new Date()), [])

  const activeDate = React.useMemo(() => {
    return getDateForWeekdayIndex(currentMonday, selectedWeekdayIndex)
  }, [currentMonday, selectedWeekdayIndex])

  const activeDateStr = React.useMemo(() => formatDateString(activeDate), [activeDate])

  // Call activitiesForToday(data, activeDate) as required
  const todaysActivities = React.useMemo(() => {
    return activitiesForToday(data, activeDate, selectedActivityKeys)
  }, [data, activeDate, selectedActivityKeys])

  // Sync calendar date when activeDate changes
  React.useEffect(() => {
    if (calendarRef.current) {
      const calendarApi = calendarRef.current.getApi()
      calendarApi.gotoDate(activeDate)
    }
  }, [activeDate])

  // Convert activities to FullCalendar events
  const calendarEvents = React.useMemo(() => {
    return todaysActivities.map((act, idx) => {
      const startTimeStr = `${activeDateStr}T${pad(act.start_time.hour)}:${pad(act.start_time.minute)}:00`

      // For display only, round end time up to the next full hour (e.g. 10:50 -> 11:00)
      const endHour =
        act.end_time.minute > 0 ? act.end_time.hour + 1 : act.end_time.hour
      const endMinute = 0
      const displayEndTimeStr = `${activeDateStr}T${pad(endHour)}:${pad(endMinute)}:00`

      return {
        id: `act-${idx}-${act.name}-${act.start_time.hour}-${act.start_time.minute}`,
        title: formatActivityName(act),
        start: startTimeStr,
        end: displayEndTimeStr,
        extendedProps: {
          activity: act,
        },
      }
    })
  }, [todaysActivities, activeDateStr])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Daily Calendar Area */}
      <div className="relative flex-1 overflow-hidden p-2 sm:p-4">
        {selectedActivityKeys.size === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <CalendarIcon className="size-7" />
            </div>
            <div className="flex flex-col gap-1">
              <h2 className="font-heading text-lg font-semibold">No activities selected</h2>
              <p className="max-w-xs text-sm text-muted-foreground">
                Head to Settings to choose the timetables and activities you want to see in your schedule.
              </p>
            </div>
            <Button onClick={onNavigateToSettings} className="mt-2">
              Go to Settings
            </Button>
          </div>
        ) : todaysActivities.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <CalendarIcon className="size-7" />
            </div>
            <div className="flex flex-col gap-1">
              <h2 className="font-heading text-lg font-semibold">
                Free day on {WEEKDAYS.find((w) => w.key === selectedWeekdayIndex)?.full}!
              </h2>
              <p className="max-w-xs text-sm text-muted-foreground">
                You have no scheduled activities for this day from your selected courses.
              </p>
            </div>
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
              return (
                <div className="flex h-full w-full cursor-pointer flex-col justify-between overflow-hidden rounded-md border-l-4 border-l-primary bg-primary/10 p-1.5 text-xs text-foreground transition-all hover:bg-primary/20">
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
                        {act.location.type} {act.location.id}
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
        <div className="mx-auto flex max-w-sm items-center justify-center gap-2">
          {WEEKDAYS.map((wd) => {
            const isSelected = wd.key === selectedWeekdayIndex
            return (
              <Button
                key={wd.key}
                variant={isSelected ? 'default' : 'outline'}
                size="sm"
                className={`flex-1 font-medium transition-all ${
                  isSelected ? 'shadow-sm font-semibold' : 'text-muted-foreground'
                }`}
                onClick={() => setSelectedWeekdayIndex(wd.key)}
              >
                {wd.label}
              </Button>
            )
          })}
        </div>
      </nav>

      {/* Activity Details Dialog */}
      <Dialog
        open={Boolean(selectedActivityForModal)}
        onOpenChange={(open) => {
          if (!open) setSelectedActivityForModal(null)
        }}
      >
        {selectedActivityForModal && (
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <div className="flex items-center gap-2">
                <DialogTitle className="text-base font-semibold">
                  {selectedActivityForModal.name}
                </DialogTitle>
                {selectedActivityForModal.type && (
                  <Badge variant="secondary" className="text-xs">
                    {selectedActivityForModal.type}
                  </Badge>
                )}
              </div>
              <DialogDescription>
                {formatActivityName(selectedActivityForModal)}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 py-2 text-sm">
              <div className="flex items-center gap-2.5 text-muted-foreground">
                <ClockIcon className="size-4 shrink-0 text-foreground" />
                <span>
                  {pad(selectedActivityForModal.start_time.hour)}:
                  {pad(selectedActivityForModal.start_time.minute)} –{' '}
                  {pad(selectedActivityForModal.end_time.hour)}:
                  {pad(selectedActivityForModal.end_time.minute)}
                </span>
              </div>

              {selectedActivityForModal.location && (
                <div className="flex items-center gap-2.5 text-muted-foreground">
                  <MapPinIcon className="size-4 shrink-0 text-foreground" />
                  <span>
                    Location: {selectedActivityForModal.location.type}{' '}
                    {selectedActivityForModal.location.id}
                  </span>
                </div>
              )}

              {selectedActivityForModal.authors &&
                selectedActivityForModal.authors.length > 0 && (
                  <div className="flex items-center gap-2.5 text-muted-foreground">
                    <UserIcon className="size-4 shrink-0 text-foreground" />
                    <span>Professors: {selectedActivityForModal.authors.join(', ')}</span>
                  </div>
                )}

              {selectedActivityForModal.subgroup && (
                <div className="flex items-center gap-2.5 text-muted-foreground">
                  <BookOpenIcon className="size-4 shrink-0 text-foreground" />
                  <span>Subgroup: SG-{selectedActivityForModal.subgroup}</span>
                </div>
              )}

              {selectedActivityForModal.periodicity && (
                <div className="flex items-center gap-2.5 text-muted-foreground">
                  <InfoIcon className="size-4 shrink-0 text-foreground" />
                  <span>Periodicity: {selectedActivityForModal.periodicity}</span>
                </div>
              )}

              {selectedActivityForModal._timetableTitle && (
                <div className="mt-2 rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Timetable: </span>
                  {selectedActivityForModal._timetableTitle}
                </div>
              )}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}
