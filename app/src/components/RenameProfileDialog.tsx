import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { FieldGroup, Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { PencilIcon } from 'lucide-react'

export interface RenameProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentName: string
  onRename: (newName: string) => void
}

interface RenameProfileFormProps {
  currentName: string
  onRename: (newName: string) => void
  onClose: () => void
}

function RenameProfileForm({
  currentName,
  onRename,
  onClose,
}: RenameProfileFormProps) {
  const [name, setName] = React.useState(currentName)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onRename(trimmed)
    onClose()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="rename-profile-input">New Profile Name</FieldLabel>
          <Input
            id="rename-profile-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter new name..."
            autoFocus
          />
        </Field>
      </FieldGroup>

      <DialogFooter className="mt-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!name.trim() || name.trim() === currentName}>
          Save Name
        </Button>
      </DialogFooter>
    </form>
  )
}

export function RenameProfileDialog({
  open,
  onOpenChange,
  currentName,
  onRename,
}: RenameProfileDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <PencilIcon className="size-4" />
            </div>
            <DialogTitle>Change Profile Name</DialogTitle>
          </div>
          <DialogDescription>
            Enter a new name for profile &ldquo;{currentName}&rdquo;.
          </DialogDescription>
        </DialogHeader>

        {open && (
          <RenameProfileForm
            currentName={currentName}
            onRename={onRename}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
