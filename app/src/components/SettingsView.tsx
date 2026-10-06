import * as React from 'react'
import type { Activity, Timetable, DidacticWeekSpec, CustomActivity, Profile } from '@/types/timetable'
import { NULL_UUID } from '@/types/timetable'
import {
  buildSearchIndex,
  searchTimetables,
  saveSelectedActivityKeys,
  formatActivityName,
  formatDateString,
  getDidacticWeeks,
  saveDidacticWeeks,
  getCustomActivities,
  saveCustomActivities,
  type SearchIndex,
} from '@/lib/timetable'
import { DEFAULT_PROFILE, downloadProfileJson } from '@/lib/profile'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ActivityDetailsDialog } from '@/components/ActivityDetailsDialog'
import { CustomActivityDialog } from '@/components/CustomActivityDialog'
import { CreateProfileDialog } from '@/components/CreateProfileDialog'
import { RenameProfileDialog } from '@/components/RenameProfileDialog'
import { DeleteProfileDialog } from '@/components/DeleteProfileDialog'
import { cn } from '@/lib/utils'
import {
  SearchIcon,
  XIcon,
  CheckCheckIcon,
  RotateCcwIcon,
  InfoIcon,
  Trash2Icon,
  ChevronDownIcon,
  PencilIcon,
  PlusIcon,
  DownloadIcon,
} from 'lucide-react'

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

interface SettingsViewProps {
  data: Timetable[]
  selectedActivityKeys: Set<string>
  onSelectionChange: (newKeys: Set<string>) => void
  didacticWeeks?: DidacticWeekSpec[]
  onDidacticWeeksChange?: (specs: DidacticWeekSpec[]) => void
  customActivities?: CustomActivity[]
  onCustomActivitiesChange?: (activities: CustomActivity[]) => void
  profiles?: Profile[]
  activeProfileId?: string
  onSelectProfile?: (id: string) => void
  onCreateProfile?: (profile: Profile) => void
  onRenameActiveProfile?: (newName: string) => void
  onDeleteActiveProfile?: () => void
}

export function SettingsView({
  data,
  selectedActivityKeys,
  onSelectionChange,
  didacticWeeks: didacticWeeksProps,
  onDidacticWeeksChange: onDidacticWeeksChangeProps,
  customActivities: customActivitiesProps,
  onCustomActivitiesChange: onCustomActivitiesChangeProps,
  profiles = [DEFAULT_PROFILE],
  activeProfileId = NULL_UUID,
  onSelectProfile,
  onCreateProfile,
  onRenameActiveProfile,
  onDeleteActiveProfile,
}: SettingsViewProps) {
  const [searchQuery, setSearchQuery] = React.useState('')
  const [selectedActivityForModal, setSelectedActivityForModal] =
    React.useState<Activity | null>(null)

  // Profile Dialogs State
  const [isCreateProfileOpen, setIsCreateProfileOpen] = React.useState(false)
  const [isRenameProfileOpen, setIsRenameProfileOpen] = React.useState(false)
  const [isDeleteProfileOpen, setIsDeleteProfileOpen] = React.useState(false)

  // Active profile computation
  const activeProfile = React.useMemo(() => {
    return (
      profiles.find((p) => p.id === activeProfileId) ||
      profiles[0] ||
      DEFAULT_PROFILE
    )
  }, [profiles, activeProfileId])

  const isDefaultProfile = activeProfile.id === NULL_UUID

  // Track manually uncollapsed timetable IDs when not searching (default is collapsed)
  const [manualExpandedIds, setManualExpandedIds] = React.useState<Set<string>>(() => new Set())
  // Track manually collapsed timetable IDs when searching (default in search is expanded)
  const [manualCollapsedInSearchIds, setManualCollapsedInSearchIds] = React.useState<Set<string>>(() => new Set())

  const isSearching = searchQuery.trim().length > 0

  const handleSearchChange = (val: string) => {
    setSearchQuery(val)
    setManualCollapsedInSearchIds(new Set())
  }

  const handleClearSearch = () => {
    setSearchQuery('')
    setManualCollapsedInSearchIds(new Set())
  }

  const toggleTimetableExpanded = React.useCallback(
    (timetableId: string) => {
      if (isSearching) {
        setManualCollapsedInSearchIds((prev) => {
          const next = new Set(prev)
          if (next.has(timetableId)) {
            next.delete(timetableId)
          } else {
            next.add(timetableId)
          }
          return next
        })
      } else {
        setManualExpandedIds((prev) => {
          const next = new Set(prev)
          if (next.has(timetableId)) {
            next.delete(timetableId)
          } else {
            next.add(timetableId)
          }
          return next
        })
      }
    },
    [isSearching]
  )

  const [internalDidacticWeeks, setInternalDidacticWeeks] = React.useState<DidacticWeekSpec[]>(() =>
    getDidacticWeeks()
  )
  const currentDidacticWeeks = didacticWeeksProps ?? internalDidacticWeeks

  const handleWeeksUpdate = (updated: DidacticWeekSpec[]) => {
    if (onDidacticWeeksChangeProps) {
      onDidacticWeeksChangeProps(updated)
    } else {
      setInternalDidacticWeeks(updated)
    }
    saveDidacticWeeks(updated)
  }

  const handleAddWeek = () => {
    const id = `week-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    let defaultDate = formatDateString(new Date())
    let defaultWeek = 1

    if (currentDidacticWeeks.length > 0) {
      const last = currentDidacticWeeks[currentDidacticWeeks.length - 1]
      defaultWeek = last.weekNumber + 1
      try {
        const [y, m, d] = last.date.split('-').map(Number)
        const nextDate = new Date(y, m - 1, d + 7)
        defaultDate = formatDateString(nextDate)
      } catch {
        defaultDate = formatDateString(new Date())
      }
    }

    const updated = [...currentDidacticWeeks, { id, date: defaultDate, weekNumber: defaultWeek }]
    handleWeeksUpdate(updated)
  }

  const handleUpdateWeek = (id: string, field: 'date' | 'weekNumber', val: string | number) => {
    const updated = currentDidacticWeeks.map((item) => {
      if (item.id === id) {
        return { ...item, [field]: val }
      }
      return item
    })
    handleWeeksUpdate(updated)
  }

  const handleRemoveWeek = (id: string) => {
    const updated = currentDidacticWeeks.filter((item) => item.id !== id)
    handleWeeksUpdate(updated)
  }

  const [internalCustomActivities, setInternalCustomActivities] = React.useState<CustomActivity[]>(() =>
    getCustomActivities()
  )
  const currentCustomActivities = customActivitiesProps ?? internalCustomActivities

  const handleCustomActivitiesUpdate = (updated: CustomActivity[]) => {
    if (onCustomActivitiesChangeProps) {
      onCustomActivitiesChangeProps(updated)
    } else {
      setInternalCustomActivities(updated)
    }
    saveCustomActivities(updated)
  }

  const [isCustomDialogOpen, setIsCustomDialogOpen] = React.useState(false)
  const [editingCustomActivity, setEditingCustomActivity] = React.useState<CustomActivity | null>(null)

  const handleOpenCreateCustom = () => {
    setEditingCustomActivity(null)
    setIsCustomDialogOpen(true)
  }

  const handleOpenEditCustom = (act: CustomActivity) => {
    setEditingCustomActivity(act)
    setIsCustomDialogOpen(true)
  }

  const handleSaveCustomActivity = (saved: CustomActivity) => {
    const exists = currentCustomActivities.some((c) => c.id === saved.id)
    let updated: CustomActivity[]
    if (exists) {
      updated = currentCustomActivities.map((c) => (c.id === saved.id ? saved : c))
    } else {
      updated = [...currentCustomActivities, saved]
    }
    handleCustomActivitiesUpdate(updated)
  }

  const handleToggleCustomActivity = (id: string) => {
    const updated = currentCustomActivities.map((c) => {
      if (c.id === id) {
        return { ...c, enabled: !c.enabled }
      }
      return c
    })
    handleCustomActivitiesUpdate(updated)
  }

  const handleRemoveCustomActivity = (id: string) => {
    const updated = currentCustomActivities.filter((c) => c.id !== id)
    handleCustomActivitiesUpdate(updated)
  }

  // Fast O(1) lookup of activity by unique activity ID
  const activityMap = React.useMemo(() => {
    const map = new Map<string, Activity>()
    data.forEach((t) => {
      t.activities.forEach((a) => {
        map.set(a.id, {
          ...a,
          _timetableId: t.id,
          _timetableTitle: t.title,
        })
      })
    })
    return map
  }, [data])

  // Open modal using activity ID
  const handleOpenActivityModal = (activityId: string) => {
    const target = activityMap.get(activityId)
    if (target) {
      setSelectedActivityForModal(target)
    }
  }

  // Build search index once for fast fuzzy search over underlying JSON
  const searchIndex: SearchIndex = React.useMemo(() => {
    return buildSearchIndex(data)
  }, [data])

  // Run fuzzy search with fuzzysort on underlying JSON
  const displayGroups = React.useMemo(() => {
    return searchTimetables(data, searchQuery, searchIndex)
  }, [data, searchQuery, searchIndex])

  // Helper to toggle a single activity using its ID
  const handleToggleActivity = (activityId: string) => {
    const next = new Set(selectedActivityKeys)
    if (next.has(activityId)) {
      next.delete(activityId)
    } else {
      next.add(activityId)
    }
    saveSelectedActivityKeys(next)
    onSelectionChange(next)
  }

  // Helper to toggle an entire timetable (Level 1)
  const handleToggleTimetable = (activityIds: string[]) => {
    const next = new Set(selectedActivityKeys)
    const allSelected = activityIds.every((id) => next.has(id))

    if (allSelected) {
      activityIds.forEach((id) => {
        next.delete(id)
      })
    } else {
      activityIds.forEach((id) => {
        next.add(id)
      })
    }

    saveSelectedActivityKeys(next)
    onSelectionChange(next)
  }

  // Select all visible activities
  const handleSelectAllVisible = () => {
    const next = new Set(selectedActivityKeys)
    displayGroups.forEach((group) => {
      group.activities.forEach((act) => {
        next.add(act.id)
      })
    })
    saveSelectedActivityKeys(next)
    onSelectionChange(next)
  }

  // Deselect all
  const handleDeselectAll = () => {
    const next = new Set<string>()
    saveSelectedActivityKeys(next)
    onSelectionChange(next)
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col">
          {/* Section 0: Profiles (above Weeks) */}
          <div className="flex flex-col gap-3.5 border-b border-border/70 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <h1 className="font-heading text-xl font-bold tracking-tight">
                  Profiles
                </h1>
                <p className="text-xs text-muted-foreground sm:text-sm">
                  Save and load schedules from your friends and more!
                </p>
              </div>
              <Badge variant="secondary" className="px-2.5 py-1 text-xs font-semibold">
                {profiles.length} {profiles.length === 1 ? 'profile' : 'profiles'}
              </Badge>
            </div>

            {/* Profile Selection Row: ToggleGroup + "+" button */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <ToggleGroup
                value={[activeProfile.id]}
                onValueChange={(val) => {
                  // Enforce: at any time one profile MUST be active, and ONLY one.
                  if (val && val.length > 0 && val[0]) {
                    onSelectProfile?.(val[0])
                  }
                }}
                variant="outline"
                spacing={2}
                className="flex-wrap"
              >
                {profiles.map((p) => (
                  <ToggleGroupItem
                    key={p.id}
                    value={p.id}
                    className="h-8 px-3 text-xs sm:text-sm font-medium rounded-lg max-w-[160px] truncate"
                    title={p.name}
                  >
                    <span className="truncate">{p.name}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>

              {/* Button to add a new profile */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsCreateProfileOpen(true)}
                className="h-8 px-2.5 rounded-lg border-dashed hover:border-solid hover:bg-accent/50 transition-colors"
                title="Create or import profile"
                aria-label="Add a new profile"
              >
                <PlusIcon className="size-3.5" />
              </Button>
            </div>

            {/* 3 wide action buttons at the bottom of the section */}
            <div className="grid grid-cols-3 gap-2 pt-1">
              {/* Export button */}
              <Button
                type="button"
                variant="outline"
                onClick={() => downloadProfileJson(activeProfile, activityMap)}
                className="h-9 px-2 font-medium text-xs sm:text-sm gap-1.5"
                title={`Export profile "${activeProfile.name}" as JSON`}
              >
                <DownloadIcon data-icon="inline-start" />
                <span className="truncate">Export</span>
              </Button>

              {/* Change Name button */}
              <Button
                type="button"
                variant="outline"
                disabled={isDefaultProfile}
                onClick={() => setIsRenameProfileOpen(true)}
                className="h-9 px-2 font-medium text-xs sm:text-sm gap-1.5 disabled:opacity-40"
                title={
                  isDefaultProfile
                    ? 'The default profile name cannot be changed'
                    : `Change name of profile "${activeProfile.name}"`
                }
              >
                <PencilIcon data-icon="inline-start" />
                <span className="truncate">Change Name</span>
              </Button>

              {/* Delete button (red, destructive) */}
              <Button
                type="button"
                variant="destructive"
                disabled={isDefaultProfile}
                onClick={() => setIsDeleteProfileOpen(true)}
                className="h-9 px-2 font-medium text-xs sm:text-sm gap-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-40"
                title={
                  isDefaultProfile
                    ? 'The default profile cannot be deleted'
                    : `Delete profile "${activeProfile.name}"`
                }
              >
                <Trash2Icon data-icon="inline-start" />
                <span className="truncate">Delete</span>
              </Button>
            </div>
          </div>

          {/* Section 1: Weeks (before Activities) */}
          <div className="flex flex-col gap-3 border-b border-border/70 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <h2 className="font-heading text-xl font-bold tracking-tight">
                  Weeks
                </h2>
                <p className="text-xs text-muted-foreground sm:text-sm">
                  Define didactical week numbers for specific days
                </p>
              </div>
              {currentDidacticWeeks.length > 0 && (
                <Badge variant="secondary" className="px-2.5 py-1 text-xs font-semibold">
                  {currentDidacticWeeks.length} {currentDidacticWeeks.length === 1 ? 'rule' : 'rules'}
                </Badge>
              )}
            </div>

            {/* Input fields appearing before the button */}
            {currentDidacticWeeks.length > 0 && (
              <div className="flex flex-col gap-2.5 pt-1">
                {currentDidacticWeeks.map((spec) => (
                  <div
                    key={spec.id}
                    className="flex items-center gap-2 rounded-lg border border-border/60 bg-card p-2.5 shadow-xs"
                  >
                    {/* Day Input */}
                    <div className="flex-1 min-w-0">
                      <label
                        htmlFor={`week-day-${spec.id}`}
                        className="mb-1 block text-[11px] font-semibold text-muted-foreground"
                      >
                        Day
                      </label>
                      <Input
                        id={`week-day-${spec.id}`}
                        type="date"
                        value={spec.date}
                        onChange={(e) => handleUpdateWeek(spec.id, 'date', e.target.value)}
                        className="h-8 text-xs sm:text-sm"
                        aria-label="Specify a day"
                      />
                    </div>

                    {/* Week Number Input */}
                    <div className="w-24 sm:w-28 shrink-0">
                      <label
                        htmlFor={`week-num-${spec.id}`}
                        className="mb-1 block text-[11px] font-semibold text-muted-foreground"
                      >
                        Week #
                      </label>
                      <Input
                        id={`week-num-${spec.id}`}
                        type="number"
                        min={1}
                        placeholder="Week #"
                        value={spec.weekNumber || ''}
                        onChange={(e) =>
                          handleUpdateWeek(
                            spec.id,
                            'weekNumber',
                            Math.max(1, parseInt(e.target.value, 10) || 1)
                          )
                        }
                        className="h-8 text-xs sm:text-sm font-mono"
                        aria-label="Week number"
                      />
                    </div>

                    {/* Delete button */}
                    <div className="self-end pb-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleRemoveWeek(spec.id)}
                        className="size-8 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        title="Remove week rule"
                        aria-label="Remove week rule"
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Wide button */}
            <Button
              type="button"
              variant="outline"
              onClick={handleAddWeek}
              className="w-full font-medium h-9 border-dashed hover:border-solid hover:bg-accent/50 transition-colors"
            >
              Specify a didactial week +
            </Button>
          </div>

          {/* Section: Custom Activities (between Weeks and Activities) */}
          <div className="flex flex-col gap-3 border-b border-border/70 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <h2 className="font-heading text-xl font-bold tracking-tight">
                  Custom Activities
                </h2>
                <p className="text-xs text-muted-foreground sm:text-sm">
                  Add your own activities in the schedule, even if they are not in the official timetable!
                </p>
              </div>
              {currentCustomActivities.length > 0 && (
                <Badge variant="secondary" className="px-2.5 py-1 text-xs font-semibold">
                  {currentCustomActivities.length}{' '}
                  {currentCustomActivities.length === 1 ? 'activity' : 'activities'}
                </Badge>
              )}
            </div>

            {/* List of custom activities */}
            {currentCustomActivities.length > 0 && (
              <div className="flex flex-col gap-2 pt-1">
                {currentCustomActivities.map((act) => (
                  <div
                    key={act.id}
                    className="flex items-center justify-between gap-2.5 rounded-lg border border-border/60 bg-card p-2.5 shadow-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <Checkbox
                        id={`custom-${act.id}`}
                        checked={act.enabled !== false}
                        onCheckedChange={() => handleToggleCustomActivity(act.id)}
                        className="size-4.5 shrink-0"
                      />
                      <div className="flex flex-col min-w-0">
                        <label
                          htmlFor={`custom-${act.id}`}
                          className={`cursor-pointer text-sm font-semibold truncate ${
                            act.enabled !== false
                              ? 'text-foreground'
                              : 'text-muted-foreground line-through'
                          }`}
                        >
                          {act.name}
                        </label>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span>{act.weekday}</span>
                          <span>•</span>
                          <span>
                            {pad(act.start_time.hour)}:{pad(act.start_time.minute)} -{' '}
                            {pad(act.end_time.hour)}:{pad(act.end_time.minute)}
                          </span>
                          {act.periodicity && (
                            <>
                              <span>•</span>
                              <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                                {act.periodicity}
                              </Badge>
                            </>
                          )}
                          {act.location && (
                            <>
                              <span>•</span>
                              <span className="truncate max-w-[120px]">{act.location}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleOpenEditCustom(act)}
                        className="size-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                        title="Edit custom activity"
                        aria-label={`Edit ${act.name}`}
                      >
                        <PencilIcon className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleRemoveCustomActivity(act.id)}
                        className="size-8 rounded-md text-destructive hover:bg-destructive/10 hover:text-destructive"
                        title="Delete custom activity"
                        aria-label={`Delete ${act.name}`}
                      >
                        <Trash2Icon className="size-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Wide button: labeled "Add custom activity" (no plus icon) */}
            <Button
              type="button"
              variant="outline"
              onClick={handleOpenCreateCustom}
              className="w-full font-medium h-9 border-dashed hover:border-solid hover:bg-accent/50 transition-colors"
            >
              Add custom activity
            </Button>
          </div>

          {/* Section 2: Activities Header */}
          <div className="sticky top-0 z-10 flex flex-col gap-3 border-b border-border/70 bg-background/95 p-4 backdrop-blur supports-backdrop-filter:bg-background/80 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <h2 className="font-heading text-xl font-bold tracking-tight">
                  Activities
                </h2>
                <p className="text-xs text-muted-foreground sm:text-sm">
                  Select which activities you want to see on your schedule
                </p>
              </div>
              <Badge variant="secondary" className="px-2.5 py-1 text-xs font-semibold">
                {selectedActivityKeys.size} selected
              </Badge>
            </div>

            {/* Search Box - Fuzzy search on underlying JSON */}
            <div className="flex items-center gap-2">
              <InputGroup className="w-full">
                <InputGroupAddon align="inline-start">
                  <SearchIcon className="size-4 text-muted-foreground" />
                </InputGroupAddon>
                <InputGroupInput
                  type="text"
                  placeholder="Search by course, room, professor, group..."
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="text-sm"
                />
                {searchQuery && (
                  <InputGroupAddon align="inline-end">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={handleClearSearch}
                      className="size-5 rounded-full p-0"
                    >
                      <XIcon className="size-3" />
                      <span className="sr-only">Clear search</span>
                    </Button>
                  </InputGroupAddon>
                )}
              </InputGroup>
            </div>

            {/* Quick selection action buttons */}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {searchQuery
                  ? `Found ${displayGroups.length} timetables matching "${searchQuery}"`
                  : `${displayGroups.length} timetables available`}
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={handleSelectAllVisible}
                  className="h-6 gap-1 text-[11px]"
                >
                  <CheckCheckIcon className="size-3" />
                  Select all
                </Button>
                {selectedActivityKeys.size > 0 && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={handleDeselectAll}
                    className="h-6 gap-1 text-[11px] text-destructive hover:text-destructive"
                  >
                    <RotateCcwIcon className="size-3" />
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* 2-Level Hierarchical Checkbox List */}
          <div className="px-4 py-3 sm:px-5 pb-8">
            {displayGroups.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
                <SearchIcon className="size-8 opacity-40" />
                <p className="text-sm font-medium">No timetables or activities matched your search.</p>
                <p className="text-xs">Try searching by course name, professor, room, or group number.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 sm:gap-3">
                {displayGroups.map((group) => {
                  const activities = group.activities
                  const totalCount = activities.length
                  const selectedCount = activities.filter((act) =>
                    selectedActivityKeys.has(act.id)
                  ).length

                  const isAllSelected = totalCount > 0 && selectedCount === totalCount
                  const isSomeSelected = selectedCount > 0 && selectedCount < totalCount

                  const isExpanded = isSearching
                    ? !manualCollapsedInSearchIds.has(group.timetableId)
                    : manualExpandedIds.has(group.timetableId)

                  return (
                    <div
                      key={group.timetableId}
                      className={cn(
                        "flex flex-col rounded-lg border border-border/50 bg-card p-3 shadow-xs transition-colors hover:border-border",
                        isExpanded && "gap-2"
                      )}
                    >
                      {/* Level 1: Timetable name & parent checkbox */}
                      <div className="flex items-center gap-2.5">
                        <Checkbox
                          id={`tt-${group.timetableId}`}
                          checked={isAllSelected}
                          indeterminate={isSomeSelected}
                          onCheckedChange={() =>
                            handleToggleTimetable(activities.map((a) => a.id))
                          }
                          className="size-4.5 shrink-0"
                        />
                        <label
                          htmlFor={`tt-${group.timetableId}`}
                          className="flex-1 min-w-0 cursor-pointer font-heading text-sm font-bold tracking-tight text-foreground select-none"
                        >
                          {group.timetableTitle}
                        </label>
                        <span className="text-[11px] text-muted-foreground font-mono shrink-0 select-none">
                          {selectedCount}/{totalCount}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            toggleTimetableExpanded(group.timetableId)
                          }}
                          aria-label={
                            isExpanded
                              ? `Collapse ${group.timetableTitle}`
                              : `Expand ${group.timetableTitle}`
                          }
                          aria-expanded={isExpanded}
                          className="size-6 shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-md -mr-1"
                        >
                          <ChevronDownIcon
                            className={cn(
                              "size-3.5 transition-transform duration-200",
                              !isExpanded && "-rotate-90"
                            )}
                          />
                        </Button>
                      </div>

                      {/* Level 2: Activities indented under timetable (only rendered if uncollapsed) */}
                      {isExpanded && (
                        <div className="flex flex-col gap-2 pl-6 pt-1 border-l-2 border-border/40 ml-2">
                          {activities.map((act) => {
                            const isChecked = selectedActivityKeys.has(act.id)

                            return (
                              <div
                                key={act.id}
                                className="flex items-center justify-between gap-2 py-0.5 group"
                              >
                                <div className="flex flex-1 items-center gap-2.5 min-w-0">
                                  <Checkbox
                                    id={act.id}
                                    checked={isChecked}
                                    onCheckedChange={() => handleToggleActivity(act.id)}
                                    className="size-4 shrink-0"
                                  />
                                  <label
                                    htmlFor={act.id}
                                    className={`cursor-pointer text-xs font-medium select-none transition-colors break-words ${
                                      isChecked
                                        ? 'text-foreground font-semibold'
                                        : 'text-muted-foreground hover:text-foreground'
                                    }`}
                                  >
                                    {formatActivityName(act)}
                                  </label>
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-xs"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    handleOpenActivityModal(act.id)
                                  }}
                                  className="size-6 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                                  title={`Details for ${formatActivityName(act)}`}
                                  aria-label={`Details for ${formatActivityName(act)}`}
                                >
                                  <InfoIcon className="size-3.5" />
                                </Button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Activity Details Dialog */}
      <ActivityDetailsDialog
        activity={selectedActivityForModal}
        open={Boolean(selectedActivityForModal)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedActivityForModal(null)
          }
        }}
      />

      {/* Custom Activity Dialog */}
      <CustomActivityDialog
        open={isCustomDialogOpen}
        onOpenChange={setIsCustomDialogOpen}
        initialActivity={editingCustomActivity}
        onSave={handleSaveCustomActivity}
      />

      {/* Create / Import Profile Dialog */}
      <CreateProfileDialog
        open={isCreateProfileOpen}
        onOpenChange={setIsCreateProfileOpen}
        allActivities={React.useMemo(() => Array.from(activityMap.values()), [activityMap])}
        onCreateProfile={(newProfile) => {
          onCreateProfile?.(newProfile)
        }}
      />

      {/* Rename Profile Dialog */}
      <RenameProfileDialog
        open={isRenameProfileOpen}
        onOpenChange={setIsRenameProfileOpen}
        currentName={activeProfile.name}
        onRename={(newName) => {
          onRenameActiveProfile?.(newName)
        }}
      />

      {/* Delete Profile Confirmation Dialog */}
      <DeleteProfileDialog
        open={isDeleteProfileOpen}
        onOpenChange={setIsDeleteProfileOpen}
        profileName={activeProfile.name}
        onConfirmDelete={() => {
          onDeleteActiveProfile?.()
        }}
      />
    </div>
  )
}
