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
import { Trash2Icon, AlertTriangleIcon } from 'lucide-react'

export interface DeleteProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  profileName: string
  onConfirmDelete: () => void
}

export function DeleteProfileDialog({
  open,
  onOpenChange,
  profileName,
  onConfirmDelete,
}: DeleteProfileDialogProps) {
  const handleDelete = () => {
    onConfirmDelete()
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
            <AlertDialogTitle>Delete Profile</AlertDialogTitle>
          </div>
          <AlertDialogDescription>
            Are you sure you want to delete &ldquo;{profileName}&rdquo;? All custom activities,
            selected courses, and defined weeks configured in this profile will be permanently
            deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onOpenChange(false)}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleDelete}
            className="gap-1.5"
          >
            <Trash2Icon data-icon="inline-start" />
            Delete Profile
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
