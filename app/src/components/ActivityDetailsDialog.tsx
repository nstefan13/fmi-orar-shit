import type { Activity } from '@/types/timetable'
import { formatActivityName } from '@/lib/timetable'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  ClockIcon,
  MapPinIcon,
  UserIcon,
  BookOpenIcon,
  InfoIcon,
} from 'lucide-react'

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

export interface ActivityDetailsDialogProps {
  activity: Activity | null
  allSessions?: Activity[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ActivityDetailsDialog({
  activity,
  allSessions,
  open,
  onOpenChange,
}: ActivityDetailsDialogProps) {
  if (!activity) return null

  const sessions = allSessions && allSessions.length > 0 ? allSessions : [activity]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle className="text-base font-semibold">
              {activity.name}
            </DialogTitle>
            {activity.type && (
              <Badge variant="secondary" className="text-xs">
                {activity.type}
              </Badge>
            )}
          </div>
          <DialogDescription>
            {formatActivityName(activity)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2 text-sm">
          {/* Time sessions */}
          <div className="flex flex-col gap-1 text-muted-foreground">
            {sessions.map((sess, idx) => (
              <div key={idx} className="flex items-center gap-2.5">
                <ClockIcon className="size-4 shrink-0 text-foreground" />
                <span>
                  {sess.weekday && <strong className="font-semibold text-foreground mr-1">{sess.weekday}:</strong>}
                  {pad(sess.start_time.hour)}:{pad(sess.start_time.minute)} –{' '}
                  {pad(sess.end_time.hour)}:{pad(sess.end_time.minute)}
                  {sess.periodicity && (
                    <span className="ml-1.5 text-xs text-muted-foreground font-normal">
                      ({sess.periodicity})
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>

          {/* Location */}
          {activity.location && (
            <div className="flex items-center gap-2.5 text-muted-foreground">
              <MapPinIcon className="size-4 shrink-0 text-foreground" />
              <span>
                Location: {activity.location.type} {activity.location.id}
              </span>
            </div>
          )}

          {/* Professors / Authors */}
          {activity.authors && activity.authors.length > 0 && (
            <div className="flex items-center gap-2.5 text-muted-foreground">
              <UserIcon className="size-4 shrink-0 text-foreground" />
              <span>Professors: {activity.authors.join(', ')}</span>
            </div>
          )}

          {/* Subgroup */}
          {activity.subgroup && (
            <div className="flex items-center gap-2.5 text-muted-foreground">
              <BookOpenIcon className="size-4 shrink-0 text-foreground" />
              <span>Subgroup: SG-{activity.subgroup}</span>
            </div>
          )}

          {/* Periodicity */}
          {activity.periodicity && (
            <div className="flex items-center gap-2.5 text-muted-foreground">
              <InfoIcon className="size-4 shrink-0 text-foreground" />
              <span>Periodicity: {activity.periodicity}</span>
            </div>
          )}

          {/* Timetable origin */}
          {activity._timetableTitle && (
            <div className="mt-2 rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Timetable: </span>
              {activity._timetableTitle}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
