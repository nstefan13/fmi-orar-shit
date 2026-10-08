import fs from 'node:fs'
import path from 'node:path'
import objectHash from 'object-hash'
import { initializeApp } from 'firebase/app'
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || "AIzaSyAYs2TmlqmTkGy31sGWlr1FI0JV-EMK0zE",
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || "fmi-orar-shit.firebaseapp.com",
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || "fmi-orar-shit",
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || "fmi-orar-shit.firebasestorage.app",
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "258751651264",
  appId: process.env.VITE_FIREBASE_APP_ID || "1:258751651264:web:d81fa952452a233366fc25",
}

// Schema-01 conversion helper
function activityToSchema01(act: any) {
  return {
    start_time: {
      weekday: act.start_time?.weekday ?? '',
      hour: act.start_time?.hour ?? 0,
      minute: act.start_time?.minute ?? 0,
    },
    end_time: {
      weekday: act.end_time?.weekday ?? '',
      hour: act.end_time?.hour ?? 0,
      minute: act.end_time?.minute ?? 0,
    },
    name: act.name ?? '',
    type: act.type !== undefined ? act.type : null,
    authors: Array.isArray(act.authors) ? act.authors : [],
    location: act.location !== undefined ? act.location : null,
    periodicity: act.periodicity !== undefined ? act.periodicity : null,
    subgroup: act.subgroup !== undefined ? act.subgroup : null,
  }
}

function computeOrarHash(timetables: any[]) {
  const sanitized = timetables.map((t) => ({
    id: t.id,
    title: t.title,
    activities: t.activities.map((a: any) => activityToSchema01(a)),
  }))
  return objectHash(sanitized)
}

async function main() {
  const inputArg = process.argv[2] || 'src/data/DATA.json'
  const inputPath = path.resolve(process.cwd(), inputArg)
  const outputPath = path.resolve(process.cwd(), 'src/data/ORAR.json')

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file does not exist: ${inputPath}`)
    process.exit(1)
  }

  const raw = fs.readFileSync(inputPath, 'utf8')
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupFileName = `DATA_backup_${timestamp}.json`
  const backupPath = path.join('/tmp', backupFileName)

  fs.writeFileSync(backupPath, raw, 'utf8')
  console.log(`✓ Backup successfully created at: ${backupPath}`)

  const parsed = JSON.parse(raw)
  const rawTimetables = Array.isArray(parsed) ? parsed : parsed.timetables || []

  let totalOriginalActivities = 0
  let totalDeduplicatedActivities = 0
  let strippedWeekdayCount = 0

  const migratedTimetables = rawTimetables.map((t: any) => {
    const ttNum = String(t.id).replace(/^(IMG-|tt:)/, '')
    const newTimetableId = `tt:${ttNum}`

    const seenActivityIds = new Set<string>()
    const deduplicatedActivities: any[] = []

    for (const act of t.activities || []) {
      totalOriginalActivities++
      const schema01 = activityToSchema01(act)
      const actHash = objectHash(schema01)
      const newActivityId = `${newTimetableId}-ac:${actHash}`

      if (seenActivityIds.has(newActivityId)) {
        // Skip duplicate, keeping only the first one
        continue
      }

      seenActivityIds.add(newActivityId)

      // Strip redundant weekday attribute from activity root
      if ('weekday' in act) strippedWeekdayCount++
      const { weekday: _ignoredWeekday, ...cleanAct } = act

      deduplicatedActivities.push({
        ...cleanAct,
        id: newActivityId,
      })
    }

    totalDeduplicatedActivities += deduplicatedActivities.length

    return {
      ...t,
      id: newTimetableId,
      activities: deduplicatedActivities,
    }
  })

  const rootHash = computeOrarHash(migratedTimetables)
  const result = {
    created_at: new Date().toISOString(),
    hash: rootHash,
    timetables: migratedTimetables,
  }

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8')
  console.log(`✓ Transformed ORAR data written to: ${outputPath}`)
  console.log(`  - Root hash: ${rootHash}`)
  console.log(`  - Total timetables: ${migratedTimetables.length}`)
  console.log(`  - Activities before: ${totalOriginalActivities}`)
  console.log(`  - Activities after: ${totalDeduplicatedActivities}`)
  console.log(`  - Stripped 'weekday' from ${strippedWeekdayCount} activities`)

  // Publish to Firestore global 'orares' collection
  console.log(`Publishing to global collection 'orares/${rootHash}' in Firestore (${firebaseConfig.projectId})...`)
  try {
    const app = initializeApp(firebaseConfig)
    const db = getFirestore(app)
    const orarDocRef = doc(db, 'orares', rootHash)
    await setDoc(orarDocRef, result)

    const snapshot = await getDoc(orarDocRef)
    if (snapshot.exists()) {
      console.log(`✓ Successfully published and verified in Firestore: orares/${rootHash}`)
      process.exit(0)
    } else {
      console.warn(`⚠ Uploaded, but verification getDoc returned empty.`)
      process.exit(1)
    }
  } catch (err) {
    console.error(`✗ Failed to publish to Firestore:`, err)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
