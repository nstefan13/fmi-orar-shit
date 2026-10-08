import { z } from 'zod'
import { NULL_UUID } from '@/types/timetable'
import { allElementsUnique } from '@/lib/utils'

export const themeSchema = z.enum(['light', 'dark', 'system'])
export type Theme = z.infer<typeof themeSchema>

export const activityIdSchema = z.string()

export const selectedDaySchema = z.number().int().min(1).max(5)

export const activeProfileIdSchema = z.uuid()

export const timeSchema = z.object({
  weekday: z.enum(['Luni', 'Marti', 'Miercuri', 'Joi', 'Vineri']),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
})

import { computeCustomActivityId } from '@/lib/hash'

export const customActivitySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    start_time: timeSchema,
    end_time: timeSchema,
    authors: z.array(z.string()),
    location: z.string().nullable(),
    periodicity: z.enum(['odd', 'even']).nullable(),
    enabled: z.boolean(),
  })
  .refine(
    (act) => act.id === computeCustomActivityId(act),
    { message: 'Invalid custom activity id: must match content hash' }
  )

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
  orar_hash: z.string(),
  selectedActivityKeys: selectedActivitiesSchema,
  customActivities: customActivitiesSchema,
  didacticWeeks: didacticWeeksSchema,
})

export const DEFAULT_PROFILE = {
  id: NULL_UUID,
  name: 'Default',
  orar_hash: '',
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

export const syncMetadataSchema = z.object({
  isDirty: z.boolean(),
  lastSyncedVersion: z.number().int().nonnegative(),
  lastSyncedUserId: z.string().nullable().optional(),
})

export type SyncMetadata = z.infer<typeof syncMetadataSchema>

export const cloudUserDataSchema = z.object({
  version: z.number().int().nonnegative(),
  theme: themeSchema.optional(),
  activeProfileId: z.string().optional(),
  profiles: z.array(z.unknown()),
  updatedAt: z.unknown().optional(),
})

export type CloudUserData = z.infer<typeof cloudUserDataSchema>
