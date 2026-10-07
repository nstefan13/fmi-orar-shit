import { z } from 'zod'
import { NULL_UUID } from '@/types/timetable'
import { allElementsUnique } from '@/lib/utils'

export const themeSchema = z.enum(['light', 'dark', 'system'])
export type Theme = z.infer<typeof themeSchema>

export const activityIdSchema = z.string()

export const activeProfileIdSchema = z.uuid()

export const timeSchema = z.object({
  weekday: z.enum(['Luni', 'Marti', 'Miercuri', 'Joi', 'Vineri']),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
})

export const customActivitySchema = z.object({
  id: z.string(),
  name: z.string(),
  start_time: timeSchema,
  end_time: timeSchema,
  authors: z.array(z.string()),
  location: z.string().nullable(),
  periodicity: z.enum(['odd', 'even']).nullable(),
  enabled: z.boolean(),
})

export const customActivitiesSchema = z.array(customActivitySchema)

export const didacticWeekSchema = z.object({
  date: z.iso.date(),
  weekNumber: z.number().int().min(1),
})

export const didacticWeeksSchema = z.array(didacticWeekSchema)

export const selectedActivitiesSchema = z.array(activityIdSchema)

export const profileSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  selectedActivityKeys: selectedActivitiesSchema,
  customActivities: customActivitiesSchema,
  didacticWeeks: didacticWeeksSchema,
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
