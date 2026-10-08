import * as React from 'react'
import rawOrarData from '@/data/ORAR.json'
import type { DidacticWeekSpec, CustomActivity, Profile, OrarData } from '@/types/timetable'
import { NULL_UUID } from '@/types/timetable'
import {
  ensureOrarVersion,
  saveOrarClone,
  getOrarClone,
  getProfiles,
  saveProfiles,
  getActiveProfileId,
  saveActiveProfileId,
} from '@/lib/profile'
import { ScheduleView } from '@/components/ScheduleView'
import { SettingsView } from '@/components/SettingsView'
import { Button } from '@/components/ui/button'
import { Toaster, toast } from '@/components/ui/toast'
import {
  CalendarIcon,
  SettingsIcon,
  MoonIcon,
  SunIcon,
  MonitorIcon,
} from 'lucide-react'
import { AccountDialog } from '@/components/AccountDialog'
import { useCloudSync } from '@/hooks/useCloudSync'
import { markStorageDirty, STORAGE_KEY_THEME } from '@/lib/profile'
import { fetchOrarByHash } from '@/lib/sync'

import { themeSchema, type Theme } from '@/lib/schemas'
export type { Theme }

function getInitialTheme(): Theme {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem(STORAGE_KEY_THEME)
    const result = themeSchema.safeParse(saved)
    if (result.success) {
      return result.data
    }
  }
  return 'system'
}

const latestOrar = rawOrarData as unknown as OrarData

// Clean start versioning check and ensure latest clone is saved in localStorage
ensureOrarVersion()
saveOrarClone(latestOrar)

export function App() {
  const [activeTab, setActiveTab] = React.useState<'schedule' | 'settings'>('schedule')

  // Theme State
  const [theme, setTheme] = React.useState<Theme>(getInitialTheme)

  // Profiles State
  const [profiles, setProfiles] = React.useState<Profile[]>(() =>
    getProfiles(latestOrar.hash)
  )
  const [activeProfileId, setActiveProfileId] = React.useState<string>(() =>
    getActiveProfileId()
  )

  // Helper to reload state from storage after a cloud sync pull or sign out
  const refreshFromStorage = React.useCallback(() => {
    saveOrarClone(latestOrar)
    setProfiles(getProfiles(latestOrar.hash))
    setActiveProfileId(getActiveProfileId())
    setTheme(getInitialTheme())
  }, [])

  // Cloud Authentication & Sync orchestration
  const {
    user,
    syncStatus,
    handleSignIn,
    handleSignOut,
    handleManualSync,
  } = useCloudSync({
    onStorageRefresh: refreshFromStorage,
    profiles,
    activeProfileId,
    theme,
  })

  // Derived Active Profile
  const activeProfile = React.useMemo(() => {
    return profiles.find((p) => p.id === activeProfileId) || profiles[0]
  }, [profiles, activeProfileId])

  // Derive the ORAR dataset for the active profile (or fallback to latest)
  const currentOrar = React.useMemo(() => {
    if (activeProfile && activeProfile.orar_hash) {
      const clone = getOrarClone(activeProfile.orar_hash)
      if (clone) return clone
    }
    return latestOrar
  }, [activeProfile])

  // Asynchronously resolve orar clone if not locally cached yet
  React.useEffect(() => {
    if (activeProfile?.orar_hash && !getOrarClone(activeProfile.orar_hash)) {
      fetchOrarByHash(activeProfile.orar_hash, user?.uid).then((resolved) => {
        if (resolved) {
          refreshFromStorage()
        }
      })
    }
  }, [activeProfile?.orar_hash, user?.uid, refreshFromStorage])

  const timetableData = currentOrar.timetables

  // Active profile's properties
  const selectedActivityKeys = React.useMemo(() => {
    return new Set(activeProfile.selectedActivityKeys)
  }, [activeProfile.selectedActivityKeys])

  const didacticWeeks = activeProfile.didacticWeeks
  const customActivities = activeProfile.customActivities

  const activeCustomCount = React.useMemo(() => {
    return customActivities.filter((c) => c.enabled).length
  }, [customActivities])

  const totalActiveActivities = selectedActivityKeys.size + activeCustomCount

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      ;(window as any).toast = toast
    }
  }, [])

  // Handlers for updating active profile
  const handleSelectionChange = React.useCallback(
    (newKeys: Set<string>) => {
      const keysArr = Array.from(newKeys)
      setProfiles((prev) => {
        const updated = prev.map((p) =>
          p.id === activeProfile.id ? { ...p, selectedActivityKeys: keysArr } : p
        )
        saveProfiles(updated)
        return updated
      })
    },
    [activeProfile.id]
  )

  const handleDidacticWeeksChange = React.useCallback(
    (updatedWeeks: DidacticWeekSpec[]) => {
      setProfiles((prev) => {
        const updated = prev.map((p) =>
          p.id === activeProfile.id ? { ...p, didacticWeeks: updatedWeeks } : p
        )
        saveProfiles(updated)
        return updated
      })
    },
    [activeProfile.id]
  )

  const handleCustomActivitiesChange = React.useCallback(
    (updatedCustom: CustomActivity[]) => {
      setProfiles((prev) => {
        const updated = prev.map((p) =>
          p.id === activeProfile.id ? { ...p, customActivities: updatedCustom } : p
        )
        saveProfiles(updated)
        return updated
      })
    },
    [activeProfile.id]
  )

  const handleSelectProfile = React.useCallback((id: string) => {
    setActiveProfileId(id)
    saveActiveProfileId(id)
  }, [])

  const handleCreateProfile = React.useCallback((newProfile: Profile) => {
    setProfiles((prev) => {
      const updated = [...prev, newProfile]
      saveProfiles(updated)
      return updated
    })
    setActiveProfileId(newProfile.id)
    saveActiveProfileId(newProfile.id)
  }, [])

  const handleRenameActiveProfile = React.useCallback(
    (newName: string) => {
      if (activeProfile.id === NULL_UUID) return
      setProfiles((prev) => {
        const updated = prev.map((p) =>
          p.id === activeProfile.id ? { ...p, name: newName } : p
        )
        saveProfiles(updated)
        return updated
      })
    },
    [activeProfile.id]
  )

  const handleDeleteActiveProfile = React.useCallback(() => {
    if (activeProfile.id === NULL_UUID) return
    setProfiles((prev) => {
      const updated = prev.filter((p) => p.id !== activeProfile.id)
      saveProfiles(updated)
      return updated
    })
    setActiveProfileId(NULL_UUID)
    saveActiveProfileId(NULL_UUID)
  }, [activeProfile.id])

  const handleUpdateProfileOrar = React.useCallback(
    (profileId: string, newKeys: string[], newOrarHash: string) => {
      setProfiles((prev) => {
        const updated = prev.map((p) =>
          p.id === profileId
            ? { ...p, selectedActivityKeys: newKeys, orar_hash: newOrarHash }
            : p
        )
        saveProfiles(updated)
        return updated
      })
    },
    []
  )

  React.useEffect(() => {
    const result = themeSchema.safeParse(theme)
    if (result.success) {
      localStorage.setItem(STORAGE_KEY_THEME, result.data)
    }

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
      const next: Theme = prev === 'dark' ? 'light' : prev === 'light' ? 'system' : 'dark'
      markStorageDirty()
      return next
    })
  }

  return (
    <div className="flex h-dvh w-full flex-col bg-background text-foreground overflow-hidden sm:max-w-lg sm:mx-auto sm:border-x sm:border-border sm:shadow-2xl">
      <Toaster position="top-center" />

      {/* Top Application Bar */}
      <header className="sticky top-0 z-40 flex shrink-0 items-center justify-between border-b border-border/80 bg-background/90 px-4 py-2.5 backdrop-blur supports-backdrop-filter:bg-background/80">
        <div className="flex items-center gap-2.5">
          <AccountDialog
            user={user}
            syncStatus={syncStatus}
            onSignIn={handleSignIn}
            onSignOut={handleSignOut}
            onSync={handleManualSync}
          />
          <div className="flex flex-col">
            <span className="font-heading text-base font-bold leading-none tracking-tight">
              {activeTab === 'schedule' ? 'Your Schedule' : 'Settings'}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {activeTab === 'schedule'
                ? `${totalActiveActivities} activities active`
                : `Profile: ${activeProfile.name}`}
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
            customActivities={customActivities}
            onNavigateToSettings={() => setActiveTab('settings')}
          />
        ) : (
          <SettingsView
            data={timetableData}
            selectedActivityKeys={selectedActivityKeys}
            onSelectionChange={handleSelectionChange}
            didacticWeeks={didacticWeeks}
            onDidacticWeeksChange={handleDidacticWeeksChange}
            customActivities={customActivities}
            onCustomActivitiesChange={handleCustomActivitiesChange}
            profiles={profiles}
            activeProfileId={activeProfileId}
            currentOrar={currentOrar}
            latestOrar={latestOrar}
            onSelectProfile={handleSelectProfile}
            onCreateProfile={handleCreateProfile}
            onRenameActiveProfile={handleRenameActiveProfile}
            onDeleteActiveProfile={handleDeleteActiveProfile}
            onUpdateProfileOrar={handleUpdateProfileOrar}
          />
        )}
      </main>
    </div>
  )
}

export default App
