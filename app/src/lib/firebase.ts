import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app'
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type Auth,
  type User,
} from 'firebase/auth'
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyAYs2TmlqmTkGy31sGWlr1FI0JV-EMK0zE",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "fmi-orar-shit.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "fmi-orar-shit",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "fmi-orar-shit.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "258751651264",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:258751651264:web:d81fa952452a233366fc25",
}

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId
)

let app: FirebaseApp | null = null
let auth: Auth | null = null
let db: Firestore | null = null
const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

if (isFirebaseConfigured) {
  try {
    app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)
    auth = getAuth(app)
    try {
      db = initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      })
    } catch {
      // If already initialized (e.g. HMR in Vite)
      db = getFirestore(app)
    }
  } catch (e) {
    console.error('Failed to initialize Firebase:', e)
  }
}

export { app, auth, db, googleProvider }
export type { User }

/**
 * Sign in with Google using popup.
 * Gracefully handles user-initiated cancellation (closing popup) by returning null.
 */
export async function signInWithGoogle(): Promise<User | null> {
  if (!auth) {
    throw new Error('Firebase is not configured. Please add your credentials to .env')
  }
  try {
    const result = await signInWithPopup(auth, googleProvider)
    return result.user
  } catch (error: any) {
    if (
      error?.code === 'auth/popup-closed-by-user' ||
      error?.code === 'auth/cancelled-popup-request'
    ) {
      // User closed the popup or clicked outside — not an error to throw
      return null
    }
    if (error?.code === 'auth/configuration-not-found' || error?.code === 'auth/operation-not-allowed') {
      throw new Error(
        'Google Sign-In is not enabled in Firebase Console. Go to Firebase Console > Authentication > Sign-in method and enable Google.'
      )
    }
    if (error?.code === 'auth/unauthorized-domain') {
      throw new Error(
        'Domain not authorized. Add "localhost" under Firebase Console > Authentication > Settings > Authorized domains.'
      )
    }
    throw error
  }
}

/**
 * Sign out current user from Firebase Auth.
 */
export async function signOutUser(): Promise<void> {
  if (!auth) return
  await signOut(auth)
}

/**
 * Listen to auth state changes. Returns an unsubscribe function.
 */
export function onAuthUserChanged(callback: (user: User | null) => void): () => void {
  if (!auth) {
    callback(null)
    return () => {}
  }
  return onAuthStateChanged(auth, callback)
}

