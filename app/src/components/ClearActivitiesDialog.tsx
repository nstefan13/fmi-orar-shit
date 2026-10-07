import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { RotateCcwIcon, AlertTriangleIcon } from 'lucide-react'

export interface ClearActivitiesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  count: number
  onConfirmClear: () => void
}

export function ClearActivitiesDialog({
  open,
  onOpenChange,
  count,
  onConfirmClear,
}: ClearActivitiesDialogProps) {
  const handleClear = () => {
    onConfirmClear()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-destructive/10 text-destructive">
              <AlertTriangleIcon className="size-4" />
            </div>
            <DialogTitle>Clear Selected Activities</DialogTitle>
          </div>
          <DialogDescription>
            Are you sure you want to deselect all {count}{' '}
            {count === 1 ? 'activity' : 'activities'} from your current schedule?
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="mt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleClear}
            className="gap-1.5"
          >
            <RotateCcwIcon data-icon="inline-start" />
            Clear Activities
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
