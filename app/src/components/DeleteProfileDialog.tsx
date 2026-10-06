import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-destructive/10 text-destructive">
              <AlertTriangleIcon className="size-4" />
            </div>
            <DialogTitle>Delete Profile</DialogTitle>
          </div>
          <DialogDescription>
            Are you sure you want to delete &ldquo;{profileName}&rdquo;? All custom activities,
            selected courses, and defined weeks configured in this profile will be permanently
            deleted.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="mt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            className="gap-1.5"
          >
            <Trash2Icon data-icon="inline-start" />
            Delete Profile
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
