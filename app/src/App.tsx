import * as React from 'react'
import rawTimetableData from '@/data/DATA.json'
import type { Timetable, DidacticWeekSpec } from '@/types/timetable'
import { getSelectedActivityKeys, getDidacticWeeks, getDidacticWeekForDate } from '@/lib/timetable'
import { ScheduleView } from '@/components/ScheduleView'
import { SettingsView } from '@/components/SettingsView'
import { Button } from '@/components/ui/button'
import {
  CalendarIcon,
  SettingsIcon,
  MoonIcon,
  SunIcon,
  MonitorIcon,
  BookOpenIcon,
} from 'lucide-react'

export type Theme = 'light' | 'dark' | 'system'

function getInitialTheme(): Theme {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('theme') as Theme | null
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      return saved
    }
  }
  return 'system'
}

const timetableData = rawTimetableData as unknown as Timetable[]

export function App() {
  const [activeTab, setActiveTab] = React.useState<'schedule' | 'settings'>('schedule')
  const [selectedActivityKeys, setSelectedActivityKeys] = React.useState<Set<string>>(() =>
    getSelectedActivityKeys()
  )
  const [didacticWeeks, setDidacticWeeks] = React.useState<DidacticWeekSpec[]>(() =>
    getDidacticWeeks()
  )

  const currentWeekNumber = React.useMemo(() => {
    return getDidacticWeekForDate(new Date(), didacticWeeks)
  }, [didacticWeeks])

  const [theme, setTheme] = React.useState<Theme>(getInitialTheme)

  React.useEffect(() => {
    localStorage.setItem('theme', theme)

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      const isDark =
        theme === 'dark' || (theme === 'system' && mediaQuery.matches)
      if (isDark) {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
    }

    applyTheme()

    if (theme === 'system') {
      mediaQuery.addEventListener('change', applyTheme)
      return () => mediaQuery.removeEventListener('change', applyTheme)
    }
  }, [theme])

  const toggleTheme = () => {
    setTheme((prev) => {
      if (prev === 'dark') return 'light'
      if (prev === 'light') return 'system'
      return 'dark'
    })
  }

  return (
    <div className="flex h-screen w-full flex-col bg-background text-foreground overflow-hidden sm:max-w-lg sm:mx-auto sm:border-x sm:border-border sm:shadow-2xl">
      {/* Top Application Bar */}
      <header className="sticky top-0 z-40 flex shrink-0 items-center justify-between border-b border-border/80 bg-background/90 px-4 py-2.5 backdrop-blur supports-backdrop-filter:bg-background/80">
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
                ? `${selectedActivityKeys.size} activities active${currentWeekNumber !== null ? ` • Week ${currentWeekNumber}` : ''}`
                : 'Configure weeks & activities'}
            </span>
          </div>
        </div>

        {/* Top Header Actions */}
        <div className="flex items-center gap-1.5">
          {/* Theme toggle (dark, light, system) */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggleTheme}
            aria-label={`Current theme: ${theme}. Click to switch between dark, light, and system.`}
            title={`Theme: ${theme.charAt(0).toUpperCase() + theme.slice(1)} (click to switch)`}
            className="text-muted-foreground hover:text-foreground"
          >
            {theme === 'dark' && <MoonIcon className="size-4" />}
            {theme === 'light' && <SunIcon className="size-4" />}
            {theme === 'system' && <MonitorIcon className="size-4" />}
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
      <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {activeTab === 'schedule' ? (
          <ScheduleView
            data={timetableData}
            selectedActivityKeys={selectedActivityKeys}
            didacticWeeks={didacticWeeks}
            onNavigateToSettings={() => setActiveTab('settings')}
          />
        ) : (
          <SettingsView
            data={timetableData}
            selectedActivityKeys={selectedActivityKeys}
            onSelectionChange={setSelectedActivityKeys}
            didacticWeeks={didacticWeeks}
            onDidacticWeeksChange={setDidacticWeeks}
          />
        )}
      </main>
    </div>
  )
}

export default App
