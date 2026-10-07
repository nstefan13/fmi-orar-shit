import * as React from 'react'
import type { Activity, OrarData, Profile } from '@/types/timetable'
import { v4 as uuidv4 } from 'uuid'
import { parseImportedProfileJson, type ParseImportResult } from '@/lib/profile'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { FieldGroup, Field, FieldLabel, FieldDescription } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { UploadIcon, CheckCircle2Icon, AlertCircleIcon, FileJsonIcon } from 'lucide-react'

export interface CreateProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentOrar: OrarData
  allActivities?: Activity[]
  onCreateProfile: (profile: Profile) => void
}

interface CreateProfileFormProps {
  currentOrar: OrarData
  onCreateProfile: (profile: Profile) => void
  onClose: () => void
}

function CreateProfileForm({
  currentOrar,
  onCreateProfile,
  onClose,
}: CreateProfileFormProps) {
  const [name, setName] = React.useState('')
  const [importResult, setImportResult] = React.useState<ParseImportResult | null>(null)
  const [importedFileName, setImportedFileName] = React.useState<string | null>(null)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  const handleTriggerImportClick = () => {
    setErrorMessage(null)
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const result = parseImportedProfileJson(text, currentOrar)

      setImportResult(result)
      setImportedFileName(file.name)
      setErrorMessage(null)

      // Rule: populate the input field with JSON name if it wasn't already populated
      if (name.trim().length === 0 && result.name) {
        setName(result.name)
      }
    } catch (err: unknown) {
      console.error('Failed to import profile JSON', err)
      setErrorMessage(
        err instanceof Error ? err.message : 'Invalid JSON file or unsupported structure.'
      )
    } finally {
      // Reset input so re-selecting the same file triggers onChange
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setErrorMessage('Please enter a profile name.')
      return
    }

    const newProfile: Profile = {
      id: uuidv4(),
      name: trimmed,
      orar_hash: importResult ? importResult.orar_hash : currentOrar.hash,
      selectedActivityKeys: importResult ? importResult.selectedActivityKeys : [],
      customActivities: importResult ? importResult.customActivities : [],
      didacticWeeks: importResult ? importResult.didacticWeeks : [],
    }

    onCreateProfile(newProfile)
    onClose()
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-4">
      {/* Hidden file input for importing profile JSON */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleFileChange}
      />

      <FieldGroup className="gap-3">
        {/* Profile Name Input */}
        <Field data-invalid={errorMessage ? true : undefined}>
          <FieldLabel htmlFor="create-profile-name">Profile Name</FieldLabel>
          <Input
            id="create-profile-name"
            type="text"
            placeholder="e.g., Mihai, Semester 2, Grupa 131..."
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (errorMessage) setErrorMessage(null)
            }}
            autoFocus
          />
          <FieldDescription>
            You can give this profile any friendly name.
          </FieldDescription>
        </Field>

        {/* Import Profile Action */}
        <div className="flex flex-col gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            onClick={handleTriggerImportClick}
            className="w-full gap-2 border-dashed hover:border-solid"
          >
            <UploadIcon data-icon="inline-start" />
            Import Profile from JSON
          </Button>
          <p className="text-[11px] text-muted-foreground text-center">
            Upload a friend's exported profile to load their activities and weeks.
          </p>
        </div>

        {/* Import feedback success banner */}
        {importResult && (
          <div className="flex items-start gap-2.5 rounded-lg border border-primary/25 bg-primary/5 p-3 text-xs">
            <CheckCircle2Icon className="size-4.5 text-primary shrink-0 mt-0.5" />
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="font-semibold text-foreground truncate">
                Imported data ready ({importedFileName || 'file'})
              </span>
              <span className="text-[11px] text-muted-foreground">
                {importResult.matchedSelectedCount} selected activities matched
                {importResult.totalSelectedImported > importResult.matchedSelectedCount &&
                  ` (${importResult.totalSelectedImported - importResult.matchedSelectedCount} dropped)`}
                {' • '}
                {importResult.customCount} custom activities
                {importResult.didacticWeeks.length > 0 &&
                  ` • ${importResult.didacticWeeks.length} weeks`}
              </span>
            </div>
          </div>
        )}

        {/* Import or validation error banner */}
        {errorMessage && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
            <AlertCircleIcon className="size-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
      </FieldGroup>

      <DialogFooter className="mt-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!name.trim()}>
          Save Profile
        </Button>
      </DialogFooter>
    </form>
  )
}

export function CreateProfileDialog({
  open,
  onOpenChange,
  currentOrar,
  onCreateProfile,
}: CreateProfileDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <FileJsonIcon className="size-4" />
            </div>
            <DialogTitle>Create Profile</DialogTitle>
          </div>
          <DialogDescription>
            Enter a profile name or import an existing profile JSON file.
          </DialogDescription>
        </DialogHeader>

        {open && (
          <CreateProfileForm
            currentOrar={currentOrar}
            onCreateProfile={onCreateProfile}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
