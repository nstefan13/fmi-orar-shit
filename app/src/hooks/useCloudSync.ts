import * as React from 'react'
import { toast } from '@/components/ui/toast'
import {
  signInWithGoogle,
  signOutUser,
  onAuthUserChanged,
  type User,
} from '@/lib/firebase'
import {
  syncWithCloud,
  scheduleDebouncedSync,
  subscribeSyncStatus,
  resetSyncOnSignOut,
  type SyncStatus,
} from '@/lib/sync'
import { getSyncMetadata } from '@/lib/profile'
import type { Profile } from '@/types/timetable'
import type { Theme } from '@/lib/schemas'

export interface UseCloudSyncOptions {
  /** Callback invoked when cloud changes have been pulled into local storage */
  onStorageRefresh: () => void
  /** Current list of profiles in state (used to trigger debounced sync on mutation) */
  profiles: Profile[]
  /** Currently active profile ID */
  activeProfileId: string
  /** Current active theme */
  theme: Theme
}

export interface UseCloudSyncResult {
  user: User | null
  syncStatus: SyncStatus
  handleSignIn: () => Promise<boolean>
  handleSignOut: () => Promise<void>
  handleManualSync: () => Promise<void>
}

/**
 * Custom hook that manages Firebase Authentication, real-time sync engine subscriptions,
 * initial sync upon login, and debounced auto-sync upon schedule or preference changes.
 */
export function useCloudSync({
  onStorageRefresh,
  profiles,
  activeProfileId,
  theme,
}: UseCloudSyncOptions): UseCloudSyncResult {
  const [user, setUser] = React.useState<User | null>(null)
  const [syncStatus, setSyncStatus] = React.useState<SyncStatus>('idle')

  // Keep onStorageRefresh fresh in ref for async callbacks
  const onStorageRefreshRef = React.useRef(onStorageRefresh)
  React.useEffect(() => {
    onStorageRefreshRef.current = onStorageRefresh
  }, [onStorageRefresh])

  // Subscribe to sync engine status changes
  React.useEffect(() => {
    return subscribeSyncStatus(setSyncStatus)
  }, [])

  // Firebase auth state observer & initial synchronization
  React.useEffect(() => {
    const unsubscribe = onAuthUserChanged(async (currentUser) => {
      setUser(currentUser)
      if (currentUser) {
        try {
          const res = await syncWithCloud(currentUser, () => onStorageRefreshRef.current())
          if (res.action === 'pulled' || res.action === 'switched_user_pulled') {
            toast.success('Synchronized profiles from cloud')
          } else if (res.action === 'pushed_initial') {
            toast.success('Backed up schedules to cloud')
          }
        } catch (err: any) {
          console.error('Initial login sync error:', err)
          toast.error('Failed to sync with cloud. Offline mode active.')
        }
      } else {
        resetSyncOnSignOut()
      }
    })
    return () => unsubscribe()
  }, [])

  // Debounced auto-sync whenever schedule, active profile, or theme changes and local state is dirty
  React.useEffect(() => {
    if (user && getSyncMetadata().isDirty) {
      scheduleDebouncedSync(user, () => onStorageRefreshRef.current())
    }
  }, [profiles, activeProfileId, theme, user])

  const handleSignIn = React.useCallback(async (): Promise<boolean> => {
    try {
      const signedInUser = await signInWithGoogle()
      if (signedInUser) {
        toast.success(`Signed in as ${signedInUser.displayName || 'Google user'}`)
        return true
      }
      return false
    } catch (err: any) {
      console.error('Google Sign-In failed:', err)
      toast.error(err?.message || 'Sign in failed')
      return false
    }
  }, [])

  const handleSignOut = React.useCallback(async (): Promise<void> => {
    try {
      await signOutUser()
      resetSyncOnSignOut()
      toast.info('Signed out of cloud account')
    } catch (err: any) {
      console.error('Sign-out failed:', err)
      toast.error(err?.message || 'Sign out failed')
    }
  }, [])

  const handleManualSync = React.useCallback(async (): Promise<void> => {
    if (!user) return
    try {
      const res = await syncWithCloud(user, () => onStorageRefreshRef.current())
      if (res.action === 'pulled' || res.action === 'switched_user_pulled') {
        toast.success('Downloaded latest schedules from cloud')
      } else if (res.action === 'pushed') {
        toast.success('Uploaded schedules to cloud')
      } else if (res.action === 'in_sync') {
        toast.info('Everything is up to date')
      } else if (res.action === 'offline') {
        toast.warning('Cannot sync while offline')
      }
    } catch (err: any) {
      console.error('Manual sync failed:', err)
      toast.error(err?.message || 'Sync failed')
    }
  }, [user])

  return {
    user,
    syncStatus,
    handleSignIn,
    handleSignOut,
    handleManualSync,
  }
}
