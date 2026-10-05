import * as React from 'react'
import rawTimetableData from '@/data/DATA.json'
import type { Timetable } from '@/types/timetable'
import { getSelectedActivityKeys } from '@/lib/timetable'
import { ScheduleView } from '@/components/ScheduleView'
import { SettingsView } from '@/components/SettingsView'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  CalendarIcon,
  SettingsIcon,
  MoonIcon,
  SunIcon,
  BookOpenIcon,
} from 'lucide-react'

const timetableData = rawTimetableData as unknown as Timetable[]

export function App() {
  const [activeTab, setActiveTab] = React.useState<'schedule' | 'settings'>('schedule')
  const [selectedActivityKeys, setSelectedActivityKeys] = React.useState<Set<string>>(() =>
    getSelectedActivityKeys()
  )

  const [isDarkMode, setIsDarkMode] = React.useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return (
        localStorage.getItem('theme') === 'dark' ||
        window.matchMedia('(prefers-color-scheme: dark)').matches
      )
    }
    return false
  })

  React.useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }
  }, [isDarkMode])

  return (
    <div className="flex h-screen w-full flex-col bg-background text-foreground overflow-hidden sm:max-w-lg sm:mx-auto sm:border-x sm:border-border sm:shadow-2xl">
      {/* Top Application Bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border/80 bg-background/90 px-4 py-2.5 backdrop-blur supports-backdrop-filter:bg-background/80">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
            {activeTab === 'schedule' ? (
              <CalendarIcon className="size-4.5" />
            ) : (
              <BookOpenIcon className="size-4.5" />
            )}
          </div>
          <div className="flex flex-col">
            <span className="font-heading text-base font-bold leading-none tracking-tight">
              {activeTab === 'schedule' ? 'Your Schedule' : 'Settings'}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {activeTab === 'schedule'
                ? `${selectedActivityKeys.size} activities active`
                : 'Configure activities'}
            </span>
          </div>
        </div>

        {/* Top Header Actions */}
        <div className="flex items-center gap-1.5">
          {/* Theme toggle */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setIsDarkMode((prev) => !prev)}
            aria-label="Toggle theme"
            className="text-muted-foreground hover:text-foreground"
          >
            {isDarkMode ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
          </Button>

          {/* Navigation between Schedule and Settings */}
          {activeTab === 'schedule' ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActiveTab('settings')}
              className="gap-1.5 font-medium"
            >
              <SettingsIcon className="size-3.5" />
              Settings
              {selectedActivityKeys.size > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-0.5 px-1.5 py-0 text-[10px] font-bold"
                >
                  {selectedActivityKeys.size}
                </Badge>
              )}
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={() => setActiveTab('schedule')}
              className="gap-1.5 font-medium shadow-xs"
            >
              <CalendarIcon className="size-3.5" />
              Schedule
            </Button>
          )}
        </div>
      </header>

      {/* Screen Content */}
      <main className="flex-1 overflow-hidden">
        {activeTab === 'schedule' ? (
          <ScheduleView
            data={timetableData}
            selectedActivityKeys={selectedActivityKeys}
            onNavigateToSettings={() => setActiveTab('settings')}
          />
        ) : (
          <SettingsView
            data={timetableData}
            selectedActivityKeys={selectedActivityKeys}
            onSelectionChange={setSelectedActivityKeys}
          />
        )}
      </main>
    </div>
  )
}

export default App
