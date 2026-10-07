import * as React from 'react'
import type { CustomActivity } from '@/types/timetable'
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
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

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
  onSave: (activity: CustomActivity) => void
}

interface CustomActivityFormProps {
  initialActivity?: CustomActivity | null
  onSave: (activity: CustomActivity) => void
  onClose: () => void
}

function CustomActivityForm({
  initialActivity,
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const newErrors: { name?: string; time?: string } = {}
    if (!name.trim()) {
      newErrors.name = 'Please provide a name for the activity'
    }

    const [startH, startM] = startTime.split(':').map(Number)
    const [endH, endM] = endTime.split(':').map(Number)

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

    const savedActivity: CustomActivity = {
      id:
        initialActivity?.id ||
        `custom-act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
            placeholder="e.g. Study Group, Project Meeting, Gym"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }))
            }}
            aria-invalid={Boolean(errors.name)}
            autoFocus
          />
          {errors.name && (
            <FieldDescription className="text-destructive font-medium">
              {errors.name}
            </FieldDescription>
          )}
        </Field>

        {/* Weekday */}
        <Field>
          <FieldLabel htmlFor="custom-activity-weekday">Weekday *</FieldLabel>
          <div className="grid grid-cols-5 gap-1.5 pt-0.5">
            {WEEKDAY_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                type="button"
                variant={weekday === opt.value ? 'default' : 'outline'}
                size="sm"
                className="h-8 text-xs font-medium px-1"
                onClick={() => setWeekday(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </Field>

        {/* Start and End Hours + Minutes */}
        <div className="grid grid-cols-2 gap-3">
          <Field data-invalid={Boolean(errors.time)}>
            <FieldLabel htmlFor="custom-activity-start">Start Time *</FieldLabel>
            <Input
              id="custom-activity-start"
              type="time"
              value={startTime}
              onChange={(e) => {
                setStartTime(e.target.value)
                if (errors.time) setErrors((prev) => ({ ...prev, time: undefined }))
              }}
              aria-invalid={Boolean(errors.time)}
              className="font-mono"
            />
          </Field>

          <Field data-invalid={Boolean(errors.time)}>
            <FieldLabel htmlFor="custom-activity-end">End Time *</FieldLabel>
            <Input
              id="custom-activity-end"
              type="time"
              value={endTime}
              onChange={(e) => {
                setEndTime(e.target.value)
                if (errors.time) setErrors((prev) => ({ ...prev, time: undefined }))
              }}
              aria-invalid={Boolean(errors.time)}
              className="font-mono"
            />
          </Field>
        </div>
        {errors.time && (
          <FieldDescription className="text-destructive font-medium -mt-1.5">
            {errors.time}
          </FieldDescription>
        )}

        {/* Optional: Professors / Authors */}
        <Field>
          <FieldLabel htmlFor="custom-activity-professors">
            Professors <span className="text-xs text-muted-foreground font-normal">(optional)</span>
          </FieldLabel>
          <Input
            id="custom-activity-professors"
            placeholder="e.g. Popescu I., Ionescu M."
            value={professors}
            onChange={(e) => setProfessors(e.target.value)}
          />
        </Field>

        {/* Optional: Location as STRING */}
        <Field>
          <FieldLabel htmlFor="custom-activity-location">
            Location <span className="text-xs text-muted-foreground font-normal">(optional string)</span>
          </FieldLabel>
          <Input
            id="custom-activity-location"
            placeholder="e.g. Sala Sport, Corp B, Online, Room 401"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </Field>

        {/* Optional: Periodicity */}
        <Field>
          <FieldLabel htmlFor="custom-activity-periodicity">
            Periodicity <span className="text-xs text-muted-foreground font-normal">(optional)</span>
          </FieldLabel>
          <div className="grid grid-cols-3 gap-1.5 pt-0.5">
            {PERIODICITY_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                type="button"
                variant={periodicity === opt.value ? 'default' : 'outline'}
                size="sm"
                className="h-8 text-xs font-medium px-1"
                onClick={() => setPeriodicity(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </Field>
      </FieldGroup>

      <DialogFooter className="mt-2 flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button type="submit">
          {isEditing ? 'Save Changes' : 'Add Activity'}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function CustomActivityDialog({
  open,
  onOpenChange,
  initialActivity,
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
            onSave={onSave}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
