import * as React from 'react'
import type { User } from 'firebase/auth'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarBadge,
} from '@/components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import type { SyncStatus } from '@/lib/sync'
import { cn } from '@/lib/utils'
import {
  User as UserIcon,
  Cloud as CloudIcon,
  CheckCircle2 as CheckCircle2Icon,
  RefreshCw as RefreshCwIcon,
  LogOut as LogOutIcon,
  WifiOff as WifiOffIcon,
  AlertTriangle as AlertTriangleIcon,
  Info as InfoIcon,
} from 'lucide-react'

export interface AccountDialogProps {
  /** Currently authenticated Firebase user or null for guest mode */
  user: User | null
  /** Live status of the synchronization engine */
  syncStatus: SyncStatus
  /** Invoked when user requests Google Sign-In; returns true if authentication succeeded */
  onSignIn: () => Promise<boolean>
  /** Invoked when user requests sign-out */
  onSignOut: () => Promise<void>
  /** Invoked when user triggers an immediate manual sync with Firestore */
  onSync: () => Promise<void>
}

function GoogleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      aria-hidden="true"
    >
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
        fill="#EA4335"
      />
    </svg>
  )
}

/**
 * Account dialog component displaying user profile information, cloud sync status,
 * manual trigger button, and Google Sign-In / Sign-Out workflows.
 */
export function AccountDialog({
  user,
  syncStatus,
  onSignIn,
  onSignOut,
  onSync,
}: AccountDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(false)

  const handleSignInClick = async () => {
    setIsLoading(true)
    try {
      const succeeded = await onSignIn()
      if (succeeded) {
        setOpen(false)
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleSignOutClick = async () => {
    setIsLoading(true)
    try {
      await onSignOut()
      setOpen(false)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSyncClick = async () => {
    setIsLoading(true)
    try {
      await onSync()
    } finally {
      setIsLoading(false)
    }
  }

  const getStatusBadge = () => {
    switch (syncStatus) {
      case 'syncing':
        return (
          <Badge variant="secondary" className="flex items-center gap-1">
            <RefreshCwIcon className="size-3 animate-spin" />
            Syncing...
          </Badge>
        )
      case 'synced':
        return (
          <Badge variant="secondary" className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2Icon className="size-3" />
            Synced with Cloud
          </Badge>
        )
      case 'offline':
        return (
          <Badge variant="secondary" className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <WifiOffIcon className="size-3" />
            Offline Mode
          </Badge>
        )
      case 'error':
        return (
          <Badge variant="destructive" className="flex items-center gap-1">
            <AlertTriangleIcon className="size-3" />
            Sync Error
          </Badge>
        )
      default:
        return (
          <Badge variant="outline" className="flex items-center gap-1">
            <CloudIcon className="size-3" />
            Ready
          </Badge>
        )
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="flex size-8 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={user ? `Account settings for ${user.displayName || 'user'}` : 'Sign in with Google'}
          />
        }
      >
        <Avatar className="size-8 cursor-pointer ring-1 ring-border shadow-xs">
          {user?.photoURL ? (
            <AvatarImage src={user.photoURL} alt={user.displayName || 'Profile picture'} />
          ) : null}
          <AvatarFallback className="bg-primary text-primary-foreground font-semibold text-xs">
            {user?.displayName ? (
              user.displayName.charAt(0).toUpperCase()
            ) : (
              <UserIcon className="size-4" />
            )}
          </AvatarFallback>
          {user && (
            <AvatarBadge
              className={cn(
                'size-2 border border-background',
                syncStatus === 'synced' && 'bg-emerald-500',
                syncStatus === 'syncing' && 'bg-blue-500 animate-pulse',
                syncStatus === 'offline' && 'bg-amber-500',
                syncStatus === 'error' && 'bg-destructive'
              )}
            />
          )}
        </Avatar>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {user ? 'Cloud Account' : 'Connect Your Account'}
          </DialogTitle>
          <DialogDescription>
            {user
              ? 'Your timetable profiles, custom activities, and preferences are synchronized across devices.'
              : 'Sign in with Google to back up your timetable and synchronize changes across all your devices.'}
          </DialogDescription>
        </DialogHeader>

        {user ? (
          <div className="flex flex-col gap-4 py-2">
            <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
              <Avatar className="size-12 ring-2 ring-background">
                {user.photoURL ? (
                  <AvatarImage src={user.photoURL} alt={user.displayName || 'User profile'} />
                ) : null}
                <AvatarFallback className="bg-primary text-primary-foreground text-base font-bold">
                  {user.displayName?.charAt(0).toUpperCase() || 'U'}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="font-medium text-foreground text-sm truncate">
                  {user.displayName || 'Google User'}
                </span>
                <span className="text-xs text-muted-foreground truncate">
                  {user.email}
                </span>
                <div className="mt-1.5 flex items-center">
                  {getStatusBadge()}
                </div>
              </div>
            </div>

            <Alert className="text-xs">
              <CloudIcon className="size-4" />
              <AlertTitle className="text-xs font-medium">Offline-First Synchronization</AlertTitle>
              <AlertDescription className="text-xs">
                Edits are saved immediately to your local device and replicated to Cloud Firestore in the background.
              </AlertDescription>
            </Alert>

            <Separator />

            <div className="flex items-center justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSyncClick}
                disabled={isLoading}
              >
                <RefreshCwIcon data-icon="inline-start" className={isLoading ? 'animate-spin' : undefined} />
                Sync Now
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleSignOutClick}
                disabled={isLoading}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <LogOutIcon data-icon="inline-start" />
                Sign Out
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-3">
            <Alert className="text-xs">
              <InfoIcon className="size-4" />
              <AlertTitle className="text-xs font-medium">How Cloud Sync Works</AlertTitle>
              <AlertDescription className="text-xs">
                <ul className="flex flex-col gap-1.5 list-disc pl-3 mt-1">
                  <li>If you have existing schedules on this device, they will automatically be uploaded to your cloud account.</li>
                  <li>If your cloud account already has saved schedules, they will replace local storage and stay synced.</li>
                  <li>Works 100% offline — you can view and edit schedules anywhere, anytime.</li>
                </ul>
              </AlertDescription>
            </Alert>

            <Button
              size="lg"
              className="w-full text-sm font-medium shadow-sm gap-2"
              onClick={handleSignInClick}
              disabled={isLoading}
            >
              <GoogleIcon />
              Sign In with Google
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
