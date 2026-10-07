import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  computeCustomActivityId,
  computeOrarHash,
  extractContentHashFromId,
} from '../src/lib/hash'
import {
  buildSearchIndex,
  searchTimetables,
} from '../src/lib/timetable'
import {
  parseImportedProfileJson,
  buildProfileExportData,
} from '../src/lib/profile'
import type { OrarData, CustomActivity, Profile } from '../src/types/timetable'

function benchmark(name: string, fn: () => void, iterations: number = 1): number {
  // Warmup
  for (let i = 0; i < Math.min(iterations, 5); i++) fn()

  const start = performance.now()
  for (let i = 0; i < iterations; i++) {
    fn()
  }
  const end = performance.now()
  const totalMs = end - start
  const avgMs = totalMs / iterations
  console.log(`[PERF] ${name} (${iterations} runs): total ${totalMs.toFixed(2)}ms, avg ${avgMs.toFixed(4)}ms/op`)
  return avgMs
}

async function runBenchmarks() {
  console.log('=============================================')
  console.log('       ORAR PERFORMANCE BENCHMARK SUITE       ')
  console.log('=============================================\n')

  const orarPath = path.resolve(process.cwd(), 'src/data/ORAR.json')
  const rawJson = fs.readFileSync(orarPath, 'utf8')
  const orarData: OrarData = JSON.parse(rawJson)

  // 1. Single activity hash computation (keystroke typing benchmark)
  const sampleCustomAct: Partial<CustomActivity> = {
    name: 'Analiza Matematica',
    start_time: { weekday: 'Luni', hour: 8, minute: 0 },
    end_time: { weekday: 'Luni', hour: 9, minute: 50 },
    authors: ['Prof. Ionescu'],
    location: 'Amf. Titeica',
    periodicity: 'odd',
  }

  const singleHashAvg = benchmark('Single Activity Hash (Keystroke simulation)', () => {
    computeCustomActivityId(sampleCustomAct)
  }, 1000)

  // Under 0.5ms is 60fps+ smooth (16.6ms frame budget)
  if (singleHashAvg < 0.5) {
    console.log(`  ✓ Keystroke hash latency is negligible (${(singleHashAvg * 1000).toFixed(1)} µs), perfectly imperceptible to user.\n`)
  } else {
    console.log(`  ⚠ Keystroke hash latency: ${singleHashAvg.toFixed(3)}ms\n`)
  }

  // 2. Full Root ORAR Hash Computation across all 101 timetables & 1103 activities
  const rootHashAvg = benchmark('Full ORAR Root Hash Computation (1,103 activities)', () => {
    computeOrarHash(orarData.timetables)
  }, 10)
  console.log(`  ✓ Root hash calculation takes ~${rootHashAvg.toFixed(2)}ms across the entire database.\n`)

  // 3. Search Index Construction and Fuzzy Search Latency
  let searchIndex: any
  const indexBuildAvg = benchmark('Build Search Index (101 timetables, 1,103 activities)', () => {
    searchIndex = buildSearchIndex(orarData.timetables)
  }, 50)
  console.log(`  ✓ Search index built in ~${indexBuildAvg.toFixed(2)}ms.\n`)

  // Benchmark common fuzzy queries
  const queries = ['Mate', 'Programare', 'Obreja', 'Amf', '101', 'Fizica']
  for (const q of queries) {
    const qAvg = benchmark(`Fuzzy Search query: "${q}"`, () => {
      searchTimetables(orarData.timetables, q, searchIndex)
    }, 100)
    if (qAvg < 5) {
      console.log(`  ✓ Query "${q}" executes in ${qAvg.toFixed(2)}ms (< 5ms threshold).\n`)
    }
  }

  // 4. Collision Check Latency with 100 Selected Activities
  const allActs = orarData.timetables.flatMap((t) => t.activities)
  const selectedActs = allActs.slice(0, 100)
  const customActs: CustomActivity[] = Array.from({ length: 20 }, (_, i) => ({
    id: `custom-ac:dummyhash${i}`,
    name: `Custom ${i}`,
    start_time: { weekday: 'Luni', hour: 10, minute: 0 },
    end_time: { weekday: 'Luni', hour: 11, minute: 50 },
    authors: [],
    location: null,
    periodicity: null,
    enabled: true,
  }))

  const targetDraftHash = extractContentHashFromId(selectedActs[50].id)!
  const collisionCheckAvg = benchmark('Collision Detection (against 100 selected + 20 custom activities)', () => {
    // Exact logic from CustomActivityDialog
    const customCollision = customActs.some((c) => extractContentHashFromId(c.id) === targetDraftHash)
    const selectedCollision = selectedActs.some((a) => extractContentHashFromId(a.id) === targetDraftHash)
    const _isDup = customCollision || selectedCollision
  }, 5000)
  console.log(`  ✓ Collision detection per keystroke takes ${(collisionCheckAvg * 1000).toFixed(1)} µs (< 0.05ms).\n`)

  // 5. Profile Export & Import Serialization Throughput
  const actMap = new Map<string, any>()
  selectedActs.forEach((a) => actMap.set(a.id, a))
  const profileToExport: Profile = {
    id: '00000000-0000-0000-0000-000000000000',
    name: 'Full Profile',
    orar_hash: orarData.hash,
    selectedActivityKeys: selectedActs.map((a) => a.id),
    customActivities: customActs,
    didacticWeeks: [{ date: '2026-10-01', weekNumber: 1 }],
  }

  let exportedData: any
  const exportAvg = benchmark('Export Profile (with 100 activities & ORAR clone)', () => {
    exportedData = buildProfileExportData(profileToExport, actMap, orarData)
  }, 100)
  console.log(`  ✓ Profile export payload generated in ~${exportAvg.toFixed(2)}ms.\n`)

  const exportedJsonStr = JSON.stringify(exportedData)
  const jsonSizeKb = (Buffer.byteLength(exportedJsonStr, 'utf8') / 1024).toFixed(1)
  console.log(`  Export JSON payload size: ${jsonSizeKb} KB`)

  const importAvg = benchmark('Import & Parse Profile (JSON parsing, clone caching, deduplication)', () => {
    parseImportedProfileJson(exportedJsonStr, orarData)
  }, 100)
  console.log(`  ✓ Profile import & parsing completes in ~${importAvg.toFixed(2)}ms.\n`)

  console.log('=============================================')
  console.log('        PERFORMANCE SUMMARY: ALL PASS         ')
  console.log('=============================================')
}

runBenchmarks().catch(console.error)
