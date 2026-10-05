import * as React from 'react'
import type { Activity, Timetable } from '@/types/timetable'
import {
  buildSearchIndex,
  searchTimetables,
  getActivityKey,
  saveSelectedActivityKeys,
  formatActivityName,
  type SearchIndex,
} from '@/lib/timetable'
import { Checkbox } from '@/components/ui/checkbox'
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
} from 'lucide-react'

interface SettingsViewProps {
  data: Timetable[]
  selectedActivityKeys: Set<string>
  onSelectionChange: (newKeys: Set<string>) => void
}

export function SettingsView({
  data,
  selectedActivityKeys,
  onSelectionChange,
}: SettingsViewProps) {
  const [searchQuery, setSearchQuery] = React.useState('')
  const [selectedActivityForModal, setSelectedActivityForModal] =
    React.useState<Activity | null>(null)
  const [selectedSessionsForModal, setSelectedSessionsForModal] =
    React.useState<Activity[]>([])

  const handleOpenActivityModal = (timetableTitle: string, actName: string) => {
    const tt = data.find((t) => t.title === timetableTitle)
    if (tt) {
      const matchingSessions = tt.activities
        .filter((a) => formatActivityName(a) === actName)
        .map((a) => ({ ...a, _timetableTitle: timetableTitle }))

      if (matchingSessions.length > 0) {
        setSelectedActivityForModal(matchingSessions[0])
        setSelectedSessionsForModal(matchingSessions)
      }
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

  // Helper to toggle a single activity
  const handleToggleActivity = (timetableTitle: string, activityFormattedName: string) => {
    const key = getActivityKey(timetableTitle, activityFormattedName)
    const next = new Set(selectedActivityKeys)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    saveSelectedActivityKeys(next)
    onSelectionChange(next)
  }

  // Helper to toggle an entire timetable (Level 1)
  const handleToggleTimetable = (timetableTitle: string, activities: string[]) => {
    const next = new Set(selectedActivityKeys)
    const allSelected = activities.every((actName) =>
      selectedActivityKeys.has(getActivityKey(timetableTitle, actName))
    )

    if (allSelected) {
      // If all are selected, deselect all for this timetable
      activities.forEach((actName) => {
        next.delete(getActivityKey(timetableTitle, actName))
      })
    } else {
      // If some or none are selected, select all for this timetable
      activities.forEach((actName) => {
        next.add(getActivityKey(timetableTitle, actName))
      })
    }

    saveSelectedActivityKeys(next)
    onSelectionChange(next)
  }

  // Select all visible activities
  const handleSelectAllVisible = () => {
    const next = new Set(selectedActivityKeys)
    displayGroups.forEach((group) => {
      group.activities.forEach((actName) => {
        next.add(getActivityKey(group.timetableTitle, actName))
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
      {/* Section Header */}
      <div className="flex flex-col gap-3 border-b border-border/70 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h1 className="font-heading text-xl font-bold tracking-tight">
              Activities
            </h1>
            <p className="text-xs text-muted-foreground sm:text-sm">
              Select which activities you want to see you your schedule
            </p>
          </div>
          <Badge variant="secondary" className="px-2.5 py-1 text-xs font-semibold">
            {selectedActivityKeys.size} selected
          </Badge>
        </div>

        {/* Search Box - Fuzzy search on underlying JSON */}
        <div className="flex items-center gap-2">
          <InputGroup className="h-10 flex-1">
            <InputGroupAddon align="inline-start">
              <SearchIcon className="size-4 text-muted-foreground" />
            </InputGroupAddon>
            <InputGroupInput
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search timetables, activities, professors..."
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
      <ScrollArea className="flex-1 min-h-0 px-4 py-3 sm:px-5">
        {displayGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
            <SearchIcon className="size-8 opacity-40" />
            <p className="text-sm font-medium">No timetables or activities matched your search.</p>
            <p className="text-xs">Try searching by course name, professor, room, or group number.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-5 pb-6">
            {displayGroups.map((group) => {
              const activities = group.activities
              const totalCount = activities.length
              const selectedCount = activities.filter((actName) =>
                selectedActivityKeys.has(
                  getActivityKey(group.timetableTitle, actName)
                )
              ).length

              const isAllSelected = totalCount > 0 && selectedCount === totalCount
              const isSomeSelected = selectedCount > 0 && selectedCount < totalCount

              return (
                <div
                  key={group.timetableTitle}
                  className="flex flex-col gap-2 rounded-lg border border-border/50 bg-card p-3 shadow-xs transition-colors hover:border-border"
                >
                  {/* Level 1: Timetable name & parent checkbox */}
                  <div className="flex items-center gap-2.5">
                    <Checkbox
                      id={`tt-${group.timetableTitle}`}
                      checked={isAllSelected}
                      indeterminate={isSomeSelected}
                      onCheckedChange={() =>
                        handleToggleTimetable(group.timetableTitle, activities)
                      }
                      className="size-4.5"
                    />
                    <label
                      htmlFor={`tt-${group.timetableTitle}`}
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
                    {activities.map((actName) => {
                      const key = getActivityKey(group.timetableTitle, actName)
                      const isChecked = selectedActivityKeys.has(key)

                      return (
                        <div
                          key={key}
                          className="flex items-center justify-between gap-2 py-0.5 group"
                        >
                          <div className="flex flex-1 items-center gap-2.5 min-w-0">
                            <Checkbox
                              id={key}
                              checked={isChecked}
                              onCheckedChange={() =>
                                handleToggleActivity(group.timetableTitle, actName)
                              }
                              className="size-4 shrink-0"
                            />
                            <label
                              htmlFor={key}
                              className={`cursor-pointer text-xs font-medium select-none transition-colors break-words ${
                                isChecked
                                  ? 'text-foreground font-semibold'
                                  : 'text-muted-foreground hover:text-foreground'
                              }`}
                            >
                              {actName}
                            </label>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              handleOpenActivityModal(group.timetableTitle, actName)
                            }}
                            className="size-6 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                            title={`Details for ${actName}`}
                            aria-label={`Details for ${actName}`}
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
      </ScrollArea>

      {/* Activity Details Dialog */}
      <ActivityDetailsDialog
        activity={selectedActivityForModal}
        allSessions={selectedSessionsForModal}
        open={Boolean(selectedActivityForModal)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedActivityForModal(null)
            setSelectedSessionsForModal([])
          }
        }}
      />
    </div>
  )
}
