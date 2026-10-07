import fs from 'node:fs'
import path from 'node:path'
import {
  activityToSchema01,
  computeActivityId,
  computeCustomActivityId,
  computeOrarHash,
  extractContentHashFromId,
} from '../src/lib/hash'
import {
  customActivitySchema,
  profileSchema,
} from '../src/lib/schemas'
import {
  parseImportedProfileJson,
  buildProfileExportData,
} from '../src/lib/profile'
import type { OrarData, CustomActivity, Profile } from '../src/types/timetable'

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ Assertion failed: ${msg}`)
    process.exit(1)
  }
  console.log(`✓ ${msg}`)
}

async function runTests() {
  console.log('--- Starting Verification Suite ---')

  // 1. Verify ORAR.json structure and hashes
  const orarPath = path.resolve(process.cwd(), 'src/data/ORAR.json')
  assert(fs.existsSync(orarPath), 'src/data/ORAR.json exists')

  const orar: OrarData = JSON.parse(fs.readFileSync(orarPath, 'utf8'))
  assert(typeof orar.created_at === 'string' && orar.created_at.length > 0, 'created_at is present')
  assert(typeof orar.hash === 'string' && orar.hash.length === 40, 'root hash is 40-char SHA1')
  assert(Array.isArray(orar.timetables) && orar.timetables.length > 0, 'timetables is non-empty array')

  // Check root hash matches
  const recalculatedRootHash = computeOrarHash(orar.timetables)
  assert(recalculatedRootHash === orar.hash, 'computeOrarHash matches root hash in ORAR.json')

  // Check all timetable and activity IDs
  let totalActs = 0
  const allActIds = new Set<string>()

  for (const t of orar.timetables) {
    assert(t.id.startsWith('tt:'), `Timetable ${t.id} starts with tt:`)
    const seenInTt = new Set<string>()

    for (const a of t.activities) {
      totalActs++
      assert(a.id.startsWith(`${t.id}-ac:`), `Activity ${a.id} starts with ${t.id}-ac:`)
      assert(!seenInTt.has(a.id), `Activity ID ${a.id} is unique within timetable ${t.id}`)
      seenInTt.add(a.id)

      const schema01 = activityToSchema01(a)
      const expectedId = computeActivityId(t.id, schema01)
      assert(a.id === expectedId, `Activity ID ${a.id} matches expected computed ID ${expectedId}`)
      allActIds.add(a.id)
    }
  }
  console.log(`Verified ${orar.timetables.length} timetables and ${totalActs} activities.`)

  // 2. Custom Activity Hashing and Schema Validation
  const validCustomAct: CustomActivity = {
    id: '',
    name: 'Research Session',
    start_time: { weekday: 'Marti', hour: 14, minute: 0 },
    end_time: { weekday: 'Marti', hour: 16, minute: 0 },
    authors: ['Prof. Turing'],
    location: 'Lab 4',
    periodicity: 'odd',
    enabled: true,
  }
  validCustomAct.id = computeCustomActivityId(validCustomAct)
  assert(validCustomAct.id.startsWith('custom-ac:'), 'Custom activity ID starts with custom-ac:')

  const parseSuccess = customActivitySchema.safeParse(validCustomAct)
  assert(parseSuccess.success, 'customActivitySchema validates valid custom activity')

  const invalidCustomAct = { ...validCustomAct, id: 'custom-ac:wronghash123' }
  const parseFail = customActivitySchema.safeParse(invalidCustomAct)
  assert(!parseFail.success, 'customActivitySchema rejects invalid hash')

  // 3. Collision detection
  const customHash = extractContentHashFromId(validCustomAct.id)
  assert(typeof customHash === 'string' && customHash.length === 40, 'extractContentHashFromId extracts 40-char hash')

  // Collision with timetable activity
  const firstTimetableAct = orar.timetables[0].activities[0]
  const timetableActHash = extractContentHashFromId(firstTimetableAct.id)
  assert(typeof timetableActHash === 'string' && timetableActHash.length === 40, 'timetable activity has valid extractable hash')

  // 4. Profile export and import
  const testProfile: Profile = {
    id: '00000000-0000-0000-0000-000000000000',
    name: 'Default',
    orar_hash: orar.hash,
    selectedActivityKeys: [firstTimetableAct.id],
    customActivities: [validCustomAct],
    didacticWeeks: [{ date: '2026-10-12', weekNumber: 3 }],
  }

  const profileValid = profileSchema.safeParse(testProfile)
  assert(profileValid.success, 'profileSchema validates profile with orar_hash')

  const actMap = new Map()
  actMap.set(firstTimetableAct.id, firstTimetableAct)

  const exported = buildProfileExportData(testProfile, actMap, orar)
  assert(exported.name === 'Default', 'Exported profile has correct name')
  assert(exported.orar !== undefined && exported.orar.hash === orar.hash, 'Exported profile contains orar clone')

  const exportedJson = JSON.stringify(exported)
  const imported = parseImportedProfileJson(exportedJson, orar)
  assert(imported.orar_hash === orar.hash, 'Imported profile resolved correct orar_hash')
  assert(imported.customCount === 1, 'Imported 1 custom activity')
  assert(imported.matchedSelectedCount === 1, 'Imported 1 selected activity')

  // 5. Deduplication of colliding IDs during import
  const duplicateJson = JSON.stringify({
    name: 'Duplicates Test',
    selectedActivityKeys: [firstTimetableAct.id, firstTimetableAct.id, firstTimetableAct.id],
    'custom activities': [validCustomAct, validCustomAct],
  })
  const dedupedImport = parseImportedProfileJson(duplicateJson, orar)
  assert(dedupedImport.selectedActivityKeys.length === 1, 'Duplicate selected activity IDs deduplicated on import')
  assert(dedupedImport.customActivities.length === 1, 'Duplicate custom activity IDs deduplicated on import')

  // 6. Purge simulation when ORAR changes
  const oldSelectedKeys = [firstTimetableAct.id, 'tt:999-ac:nonexistentactivityhash']
  const latestActivityIds = new Set(orar.timetables.flatMap((t) => t.activities.map((a) => a.id)))
  const purged = oldSelectedKeys.filter((k) => !latestActivityIds.has(k))
  assert(purged.length === 1 && purged[0] === 'tt:999-ac:nonexistentactivityhash', 'Correctly identified missing activity to purge')

  console.log('--- All Tests Passed Successfully! ---')
}

runTests().catch((err) => {
  console.error(err)
  process.exit(1)
})
