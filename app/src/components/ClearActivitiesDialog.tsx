import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
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
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-destructive/10 text-destructive">
              <AlertTriangleIcon className="size-4" />
            </div>
            <AlertDialogTitle>Clear Selected Activities</AlertDialogTitle>
          </div>
          <AlertDialogDescription>
            Are you sure you want to deselect all {count}{' '}
            {count === 1 ? 'activity' : 'activities'} from your current schedule?
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onOpenChange(false)}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleClear}
            className="gap-1.5"
          >
            <RotateCcwIcon data-icon="inline-start" />
            Clear Activities
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
