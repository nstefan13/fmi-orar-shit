import * as React from 'react'
import type { Activity } from '@/types/timetable'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ActivityDetailsDialog } from '@/components/ActivityDetailsDialog'
import { AlertTriangleIcon, InfoIcon, ClockIcon } from 'lucide-react'

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

export interface UpdateProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  removedActivities: Activity[]
  onConfirm: () => void
}

export function UpdateProfileDialog({
  open,
  onOpenChange,
  removedActivities,
  onConfirm,
}: UpdateProfileDialogProps) {
  const [selectedActivityForModal, setSelectedActivityForModal] =
    React.useState<Activity | null>(null)

  const handleCloseAndPurge = () => {
    onConfirm()
    onOpenChange(false)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <AlertTriangleIcon className="size-4.5" />
              </div>
              <DialogTitle className="text-base font-semibold">
                Academic Agenda Updated
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-muted-foreground pt-1">
              The Academic Agenda has been changed. Due to this, the following
              activities have been removed from your schedule. Please reselect them if needed.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto py-2">
            <div className="flex flex-col gap-2">
              {removedActivities.map((act) => (
                <div
                  key={act.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-card p-2.5 text-xs shadow-xs"
                >
                  <div className="flex flex-col min-w-0 gap-0.5">
                    <span className="font-semibold text-foreground truncate">
                      {act.name}
                    </span>
                    <span className="text-[11px] text-muted-foreground truncate">
                      {act._timetableTitle || 'Timetable'}
                      {act.type && ` • ${act.type}`}
                      {act.subgroup && ` • SG-${act.subgroup}`}
                    </span>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/80 mt-0.5">
                      <ClockIcon className="size-3" />
                      <span>
                        {act.weekday} {pad(act.start_time.hour)}:{pad(act.start_time.minute)} – {pad(act.end_time.hour)}:{pad(act.end_time.minute)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setSelectedActivityForModal(act)}
                      title="View activity details"
                      aria-label="View activity details"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <InfoIcon className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="mt-2 border-t border-border/40 pt-3">
            <Button type="button" onClick={handleCloseAndPurge} className="w-full">
              Acknowledge & Update Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ActivityDetailsDialog
        activity={selectedActivityForModal}
        open={Boolean(selectedActivityForModal)}
        onOpenChange={(open) => {
          if (!open) setSelectedActivityForModal(null)
        }}
      />
    </>
  )
}
