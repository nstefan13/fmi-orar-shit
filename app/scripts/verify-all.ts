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
  selectedDaySchema,
} from '../src/lib/schemas'
import {
  parseImportedProfileJson,
  buildProfileExportData,
} from '../src/lib/profile'
import {
  getDefaultDay,
  getSelectedDay,
  saveSelectedDay,
  sortTimetableDisplayGroups,
  STORAGE_KEY_SELECTED_DAY,
  type TimetableDisplayGroup,
} from '../src/lib/timetable'
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

  // 7. Verify selectedDaySchema and sessionStorage persistence
  assert(selectedDaySchema.safeParse(1).success, 'selectedDaySchema accepts 1 (Monday)')
  assert(selectedDaySchema.safeParse(5).success, 'selectedDaySchema accepts 5 (Friday)')
  assert(!selectedDaySchema.safeParse(0).success, 'selectedDaySchema rejects 0')
  assert(!selectedDaySchema.safeParse(6).success, 'selectedDaySchema rejects 6')
  assert(!selectedDaySchema.safeParse('3').success, 'selectedDaySchema rejects string')

  const defaultDay = getDefaultDay()
  assert(defaultDay >= 1 && defaultDay <= 5, 'getDefaultDay returns 1-5')

  // Test sessionStorage integration
  const mockStorage = new Map<string, string>()
  const mockSessionStorage = {
    getItem: (key: string) => mockStorage.get(key) ?? null,
    setItem: (key: string, val: string) => { mockStorage.set(key, val) },
    removeItem: (key: string) => { mockStorage.delete(key) },
    clear: () => { mockStorage.clear() },
  }
  ;(globalThis as any).sessionStorage = mockSessionStorage
  ;(globalThis as any).window = globalThis

  assert(getSelectedDay() === defaultDay, 'getSelectedDay defaults to default day when storage empty')
  saveSelectedDay(4)
  assert(mockStorage.get(STORAGE_KEY_SELECTED_DAY) === '4', 'saveSelectedDay stores day in sessionStorage')
  assert(getSelectedDay() === 4, 'getSelectedDay reads saved day from sessionStorage')

  // 8. Verify sortTimetableDisplayGroups puts selected and half selected at top
  const dummyAct = (id: string) => ({
    id,
    weekday: 'Luni',
    start_time: { weekday: 'Luni', hour: 8, minute: 0 },
    end_time: { weekday: 'Luni', hour: 10, minute: 0 },
    name: 'Act ' + id,
    type: null,
    authors: [],
    location: null,
    periodicity: null,
    subgroup: null,
  })

  const groupUnselected: TimetableDisplayGroup = {
    timetableId: 'tt:unselected',
    timetableTitle: 'Unselected TT',
    activities: [dummyAct('a1'), dummyAct('a2')],
  }
  const groupHalfSelected: TimetableDisplayGroup = {
    timetableId: 'tt:half',
    timetableTitle: 'Half Selected TT',
    activities: [dummyAct('b1'), dummyAct('b2')],
  }
  const groupFullySelected: TimetableDisplayGroup = {
    timetableId: 'tt:full',
    timetableTitle: 'Fully Selected TT',
    activities: [dummyAct('c1'), dummyAct('c2')],
  }

  const activeKeys = new Set(['b1', 'c1', 'c2'])
  const sorted = sortTimetableDisplayGroups(
    [groupUnselected, groupHalfSelected, groupFullySelected],
    activeKeys
  )

  assert(sorted[0].timetableId === 'tt:full', 'Fully selected timetable is at index 0')
  assert(sorted[1].timetableId === 'tt:half', 'Half selected timetable is at index 1')
  assert(sorted[2].timetableId === 'tt:unselected', 'Unselected timetable is at index 2')

  // Test during search: filtered activities
  const searchResults: TimetableDisplayGroup[] = [
    { timetableId: 'tt:searchUnselected', timetableTitle: 'Search Unselected', activities: [dummyAct('s_un1')] },
    { timetableId: 'tt:searchSelected', timetableTitle: 'Search Selected', activities: [dummyAct('s_sel1')] },
  ]
  const searchKeys = new Set(['s_sel1'])
  const sortedSearch = sortTimetableDisplayGroups(searchResults, searchKeys)
  assert(sortedSearch[0].timetableId === 'tt:searchSelected', 'Selected timetable in search is at top')
  assert(sortedSearch[1].timetableId === 'tt:searchUnselected', 'Unselected timetable in search is after')

  console.log('--- All Tests Passed Successfully! ---')
}

runTests().catch((err) => {
  console.error(err)
  process.exit(1)
})
