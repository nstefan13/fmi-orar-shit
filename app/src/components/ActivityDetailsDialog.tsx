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
  HashIcon,
} from 'lucide-react'

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

export interface ActivityDetailsDialogProps {
  activity: Activity | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ActivityDetailsDialog({
  activity,
  open,
  onOpenChange,
}: ActivityDetailsDialogProps) {
  if (!activity) return null

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
          {/* Activity ID */}
          {activity.id && (
            <div className="flex items-center gap-2.5 text-muted-foreground">
              <HashIcon className="size-4 shrink-0 text-foreground" />
              <span>
                ID: <span className="font-mono font-medium text-foreground">{activity.id}</span>
              </span>
            </div>
          )}

          {/* Time session */}
          <div className="flex items-center gap-2.5 text-muted-foreground">
            <ClockIcon className="size-4 shrink-0 text-foreground" />
            <span>
              {activity.weekday && (
                <span className="mr-1">
                  {activity.weekday}:
                </span>
              )}
              {pad(activity.start_time.hour)}:{pad(activity.start_time.minute)} –{' '}
              {pad(activity.end_time.hour)}:{pad(activity.end_time.minute)}
              {activity.periodicity && (
                <span className="ml-1.5 text-xs text-muted-foreground font-normal">
                  ({activity.periodicity})
                </span>
              )}
            </span>
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
