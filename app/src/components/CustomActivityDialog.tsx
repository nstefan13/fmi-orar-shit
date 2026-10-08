import * as React from 'react'
import type { Activity, CustomActivity } from '@/types/timetable'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  FieldGroup,
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '@/components/ui/field'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { AlertCircleIcon } from 'lucide-react'
import {
  customActivityToSchema01,
  computeActivityHash,
  extractContentHashFromId,
  computeCustomActivityId,
} from '@/lib/hash'

const WEEKDAY_OPTIONS = [
  { value: 'Luni', label: 'Luni' },
  { value: 'Marti', label: 'Marți' },
  { value: 'Miercuri', label: 'Miercuri' },
  { value: 'Joi', label: 'Joi' },
  { value: 'Vineri', label: 'Vineri' },
] as const

const PERIODICITY_OPTIONS: { value: 'odd' | 'even' | ''; label: string }[] = [
  { value: '', label: 'Every week' },
  { value: 'odd', label: 'Odd Week' },
  { value: 'even', label: 'Even Week' },
]

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

export interface CustomActivityDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialActivity?: CustomActivity | null
  existingCustomActivities?: CustomActivity[]
  selectedActivities?: Activity[]
  onSave: (activity: CustomActivity) => void
}

interface CustomActivityFormProps {
  initialActivity?: CustomActivity | null
  existingCustomActivities?: CustomActivity[]
  selectedActivities?: Activity[]
  onSave: (activity: CustomActivity) => void
  onClose: () => void
}

function CustomActivityForm({
  initialActivity,
  existingCustomActivities = [],
  selectedActivities = [],
  onSave,
  onClose,
}: CustomActivityFormProps) {
  const [name, setName] = React.useState(initialActivity?.name || '')
  const [weekday, setWeekday] = React.useState(initialActivity?.start_time?.weekday || 'Luni')
  const [startTime, setStartTime] = React.useState(
    initialActivity
      ? `${pad(initialActivity.start_time.hour)}:${pad(initialActivity.start_time.minute)}`
      : '08:00'
  )
  const [endTime, setEndTime] = React.useState(
    initialActivity
      ? `${pad(initialActivity.end_time.hour)}:${pad(initialActivity.end_time.minute)}`
      : '09:50'
  )
  const [professors, setProfessors] = React.useState(
    initialActivity?.authors ? initialActivity.authors.join(', ') : ''
  )
  const [location, setLocation] = React.useState(initialActivity?.location || '')
  const [periodicity, setPeriodicity] = React.useState<'odd' | 'even' | ''>(
    initialActivity?.periodicity || ''
  )
  const [errors, setErrors] = React.useState<{ name?: string; time?: string }>({})

  const [startH, startM] = startTime.split(':').map(Number)
  const [endH, endM] = endTime.split(':').map(Number)

  // Calculate current draft hash in real-time
  const currentDraftHash = React.useMemo(() => {
    if (!name.trim()) return null
    if (isNaN(startH) || isNaN(startM) || isNaN(endH) || isNaN(endM)) return null

    const authorsList = professors
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)

    const draft: Partial<CustomActivity> = {
      name: name.trim(),
      start_time: {
        weekday,
        hour: startH,
        minute: startM,
      },
      end_time: {
        weekday,
        hour: endH,
        minute: endM,
      },
      authors: authorsList,
      location: location.trim() || null,
      periodicity: periodicity ? periodicity : null,
    }

    const schema01 = customActivityToSchema01(draft)
    return computeActivityHash(schema01)
  }, [name, weekday, startH, startM, endH, endM, professors, location, periodicity])

  // Check collision against other custom activities and selected timetable activities
  const isDuplicate = React.useMemo(() => {
    if (!currentDraftHash) return false

    // Check other custom activities
    const customCollision = existingCustomActivities.some((c) => {
      if (initialActivity && c.id === initialActivity.id) return false
      const cHash = extractContentHashFromId(c.id)
      return cHash === currentDraftHash
    })
    if (customCollision) return true

    // Check selected activities
    const selectedCollision = selectedActivities.some((a) => {
      const aHash = extractContentHashFromId(a.id)
      return aHash === currentDraftHash
    })
    return selectedCollision
  }, [currentDraftHash, existingCustomActivities, selectedActivities, initialActivity])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (isDuplicate) {
      return
    }

    const newErrors: { name?: string; time?: string } = {}
    if (!name.trim()) {
      newErrors.name = 'Please provide a name for the activity'
    }

    if (
      isNaN(startH) ||
      isNaN(startM) ||
      isNaN(endH) ||
      isNaN(endM) ||
      endH * 60 + endM <= startH * 60 + startM
    ) {
      newErrors.time = 'End time must be strictly after start time'
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    const authorsList = professors
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)

    const draft: Partial<CustomActivity> = {
      name: name.trim(),
      start_time: {
        weekday,
        hour: startH,
        minute: startM,
      },
      end_time: {
        weekday,
        hour: endH,
        minute: endM,
      },
      authors: authorsList,
      location: location.trim() || null,
      periodicity: periodicity ? periodicity : null,
    }

    const newId = computeCustomActivityId(draft)

    const savedActivity: CustomActivity = {
      id: newId,
      name: name.trim(),
      start_time: {
        weekday,
        hour: startH,
        minute: startM,
      },
      end_time: {
        weekday,
        hour: endH,
        minute: endM,
      },
      authors: authorsList,
      location: location.trim() || null,
      periodicity: periodicity ? periodicity : null,
      enabled: initialActivity ? initialActivity.enabled : true,
    }

    onSave(savedActivity)
    onClose()
  }

  const isEditing = Boolean(initialActivity)

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-1">
      <FieldGroup className="gap-3.5">
        {/* Name */}
        <Field data-invalid={Boolean(errors.name)}>
          <FieldLabel htmlFor="custom-activity-name">Name *</FieldLabel>
          <Input
            id="custom-activity-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }))
            }}
            placeholder="e.g., Study Session, Gym, Math Club..."
            aria-invalid={Boolean(errors.name)}
            autoFocus
          />
          {errors.name && <FieldError>{errors.name}</FieldError>}
        </Field>

        {/* Weekday Selection */}
        <Field>
          <FieldLabel>Weekday *</FieldLabel>
          <ToggleGroup
            value={[weekday]}
            onValueChange={(val) => {
              if (val && val.length > 0 && val[0]) setWeekday(val[0])
            }}
            variant="outline"
            spacing={1}
            className="grid grid-cols-5 gap-1 pt-0.5 w-full"
          >
            {WEEKDAY_OPTIONS.map((opt) => (
              <ToggleGroupItem
                key={opt.value}
                value={opt.value}
                className="h-8 text-xs px-1"
              >
                {opt.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>

        {/* Time Inputs */}
        <div className="grid grid-cols-2 gap-3">
          <Field data-invalid={Boolean(errors.time)}>
            <FieldLabel htmlFor="custom-activity-start">Start Time *</FieldLabel>
            <Input
              id="custom-activity-start"
              type="time"
              value={startTime}
              aria-invalid={Boolean(errors.time)}
              onChange={(e) => {
                setStartTime(e.target.value)
                if (errors.time) setErrors((prev) => ({ ...prev, time: undefined }))
              }}
            />
          </Field>

          <Field data-invalid={Boolean(errors.time)}>
            <FieldLabel htmlFor="custom-activity-end">End Time *</FieldLabel>
            <Input
              id="custom-activity-end"
              type="time"
              value={endTime}
              aria-invalid={Boolean(errors.time)}
              onChange={(e) => {
                setEndTime(e.target.value)
                if (errors.time) setErrors((prev) => ({ ...prev, time: undefined }))
              }}
            />
          </Field>
        </div>
        {errors.time && <FieldError className="-mt-1.5">{errors.time}</FieldError>}

        {/* Professors / Authors */}
        <Field>
          <FieldLabel htmlFor="custom-activity-professors">
            Professors / Organizers
          </FieldLabel>
          <Input
            id="custom-activity-professors"
            value={professors}
            onChange={(e) => setProfessors(e.target.value)}
            placeholder="e.g., Popescu I., Ionescu M. (comma separated)"
          />
          <FieldDescription>Optional comma-separated names.</FieldDescription>
        </Field>

        {/* Location */}
        <Field>
          <FieldLabel htmlFor="custom-activity-location">
            Location / Room
          </FieldLabel>
          <Input
            id="custom-activity-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g., Sala 101, Biblioteca, Online..."
          />
        </Field>

        {/* Periodicity */}
        <Field>
          <FieldLabel>Week Recurrence</FieldLabel>
          <ToggleGroup
            value={[periodicity]}
            onValueChange={(val) => {
              if (val && val.length > 0) {
                setPeriodicity(val[0] as 'odd' | 'even' | '')
              }
            }}
            variant="outline"
            spacing={1}
            className="grid grid-cols-3 gap-1 pt-0.5 w-full"
          >
            {PERIODICITY_OPTIONS.map((opt) => (
              <ToggleGroupItem
                key={opt.value}
                value={opt.value}
                className="h-8 text-xs px-1"
              >
                {opt.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>

        {/* Duplicate collision error banner */}
        {isDuplicate && (
          <Alert variant="destructive" className="py-2.5 text-xs">
            <AlertCircleIcon className="size-4" />
            <AlertTitle className="text-xs font-semibold">Activity Collision</AlertTitle>
            <AlertDescription className="text-xs">
              An activity with the exact same properties already exists.
            </AlertDescription>
          </Alert>
        )}
      </FieldGroup>

      <DialogFooter className="mt-3">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={isDuplicate || !name.trim()}>
          {isEditing ? 'Save Changes' : 'Create Activity'}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function CustomActivityDialog({
  open,
  onOpenChange,
  initialActivity,
  existingCustomActivities = [],
  selectedActivities = [],
  onSave,
}: CustomActivityDialogProps) {
  const isEditing = Boolean(initialActivity)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Custom Activity' : 'Add Custom Activity'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update the details for your custom scheduled activity.'
              : 'Add your own activity to appear in your personal schedule.'}
          </DialogDescription>
        </DialogHeader>

        {open && (
          <CustomActivityForm
            key={initialActivity ? initialActivity.id : 'create-new'}
            initialActivity={initialActivity}
            existingCustomActivities={existingCustomActivities}
            selectedActivities={selectedActivities}
            onSave={onSave}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
