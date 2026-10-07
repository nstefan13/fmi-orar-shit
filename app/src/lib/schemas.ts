import { z } from 'zod'
import { NULL_UUID } from '@/types/timetable'
import { allElementsUnique } from '@/lib/utils'

export const activityIdSchema = z.string()

export const timeSchema = z.object({
  weekday: z.enum(['Luni', 'Marti', 'Miercuri', 'Joi', 'Vineri']),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
})

export const customActivitySchema = z.object({
  id: z.string(),
  name: z.string(),
  weekday: z.string().optional(),
  start_time: timeSchema,
  end_time: timeSchema,
  authors: z.array(z.string()),
  location: z.string().nullable(),
  periodicity: z.string().nullable(),
  enabled: z.boolean(),
})

export const didacticWeekSchema = z.object({
  id: z.string().optional(),
  date: z.iso.date(),
  weekNumber: z.number().int().min(1),
})

export const profileSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  selectedActivityKeys: z.array(activityIdSchema),
  customActivities: z.array(customActivitySchema),
  didacticWeeks: z.array(didacticWeekSchema),
})

export const DEFAULT_PROFILE = {
  id: NULL_UUID,
  name: 'Default',
  selectedActivityKeys: [] as string[],
  customActivities: [] as z.infer<typeof customActivitySchema>[],
  didacticWeeks: [] as z.infer<typeof didacticWeekSchema>[],
}

export const profilesSchema = z
  .array(profileSchema)
  .refine((val) => {
    const defaultExists = val.some(
      (obj) => obj.name === 'Default' && obj.id === NULL_UUID
    )
    const uniqueIds = allElementsUnique(val.map((obj) => obj.id))
    return defaultExists && uniqueIds
  })
  .default([DEFAULT_PROFILE])
