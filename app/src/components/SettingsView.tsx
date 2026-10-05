import * as React from 'react'
import type { Activity, Timetable, DidacticWeekSpec } from '@/types/timetable'
import {
  buildSearchIndex,
  searchTimetables,
  saveSelectedActivityKeys,
  formatActivityName,
  formatDateString,
  getDidacticWeeks,
  saveDidacticWeeks,
  type SearchIndex,
} from '@/lib/timetable'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ActivityDetailsDialog } from '@/components/ActivityDetailsDialog'
import {
  SearchIcon,
  XIcon,
  CheckCheckIcon,
  RotateCcwIcon,
  InfoIcon,
  Trash2Icon,
} from 'lucide-react'

interface SettingsViewProps {
  data: Timetable[]
  selectedActivityKeys: Set<string>
  onSelectionChange: (newKeys: Set<string>) => void
  didacticWeeks?: DidacticWeekSpec[]
  onDidacticWeeksChange?: (specs: DidacticWeekSpec[]) => void
}

export function SettingsView({
  data,
  selectedActivityKeys,
  onSelectionChange,
  didacticWeeks: didacticWeeksProps,
  onDidacticWeeksChange: onDidacticWeeksChangeProps,
}: SettingsViewProps) {
  const [searchQuery, setSearchQuery] = React.useState('')
  const [selectedActivityForModal, setSelectedActivityForModal] =
    React.useState<Activity | null>(null)

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
          {/* Section 1: Weeks (before Activities) */}
          <div className="flex flex-col gap-3 border-b border-border/70 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <h1 className="font-heading text-xl font-bold tracking-tight">
                  Weeks
                </h1>
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
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="text-sm"
                />
                {searchQuery && (
                  <InputGroupAddon align="inline-end">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setSearchQuery('')}
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
              <div className="flex flex-col gap-5">
                {displayGroups.map((group) => {
                  const activities = group.activities
                  const totalCount = activities.length
                  const selectedCount = activities.filter((act) =>
                    selectedActivityKeys.has(act.id)
                  ).length

                  const isAllSelected = totalCount > 0 && selectedCount === totalCount
                  const isSomeSelected = selectedCount > 0 && selectedCount < totalCount

                  return (
                    <div
                      key={group.timetableId}
                      className="flex flex-col gap-2 rounded-lg border border-border/50 bg-card p-3 shadow-xs transition-colors hover:border-border"
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
                          className="size-4.5"
                        />
                        <label
                          htmlFor={`tt-${group.timetableId}`}
                          className="flex-1 cursor-pointer font-heading text-sm font-bold tracking-tight text-foreground select-none"
                        >
                          {group.timetableTitle}
                        </label>
                        <span className="text-[11px] text-muted-foreground font-mono">
                          {selectedCount}/{totalCount}
                        </span>
                      </div>

                      {/* Level 2: Activities indented under timetable */}
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
    </div>
  )
}
