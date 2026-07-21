import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = path.join(projectRoot, 'src', 'data', 'assets.generated.json')
const assetRoot = path.join(projectRoot, 'DaiblosCoreAssets')
const showAll = process.argv.includes('--all')
const asJson = process.argv.includes('--json')

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const seenModels = new Set()
const candidates = []
let modelCount = 0
let animationCount = 0

function countKeys(value) {
  return value && typeof value === 'object' ? Object.keys(value).length : 0
}

function deformSlotNames(deform) {
  const names = new Set()
  for (const skin of Object.values(deform ?? {})) {
    for (const slotName of Object.keys(skin ?? {})) names.add(slotName)
  }
  return names
}

for (const entry of manifest.entries) {
  for (const variant of entry.variants) {
    const jsonPath = variant.main.jsonPath
    if (seenModels.has(jsonPath)) continue
    seenModels.add(jsonPath)

    const localPath = path.join(assetRoot, ...jsonPath.split('/'))
    if (!fs.existsSync(localPath)) continue

    let skeleton
    try {
      skeleton = JSON.parse(fs.readFileSync(localPath, 'utf8'))
    } catch (error) {
      console.warn(`Skipped invalid JSON: ${jsonPath} (${error.message})`)
      continue
    }

    modelCount += 1
    for (const [animationName, animation] of Object.entries(skeleton.animations ?? {})) {
      animationCount += 1
      const affectedSlots = new Set(Object.keys(animation.slots ?? {}))
      for (const slotName of deformSlotNames(animation.deform)) affectedSlots.add(slotName)
      const drawOrderFrames = (animation.drawOrder ?? animation.draworder ?? []).length
      const motionTimelineCount = countKeys(animation.bones)
        + countKeys(animation.ik)
        + countKeys(animation.transform)
        + countKeys(animation.paths)

      if (motionTimelineCount > 0) continue
      if (affectedSlots.size < 2 && drawOrderFrames === 0) continue

      candidates.push({
        entry: entry.title,
        category: entry.category,
        variant: variant.label,
        folder: variant.main.folder,
        animation: animationName,
        affectedSlots: affectedSlots.size,
        drawOrderFrames,
      })
    }
  }
}

const entryCount = new Set(candidates.map((candidate) => `${candidate.category}:${candidate.entry}`)).size
const referenceChecks = [
  ['Melody', '20080_skin_melody06_spine', 'click10a'],
  ['Ushuaia', '30481_skin_ushuaia04_spine', 'click1'],
  ['Ccc', '50250_skin_ccc04_spine', 'click6'],
].map(([entry, folder, animation]) => ({
  entry,
  folder,
  animation,
  found: candidates.some((candidate) => candidate.entry === entry
    && candidate.folder === folder
    && candidate.animation.toLowerCase() === animation.toLowerCase()),
}))

const result = {
  modelsScanned: modelCount,
  animationsScanned: animationCount,
  candidateAnimations: candidates.length,
  affectedEntries: entryCount,
  references: referenceChecks,
  candidates,
}

if (asJson) {
  console.log(JSON.stringify(result, null, 2))
  process.exit(referenceChecks.every((reference) => reference.found) ? 0 : 1)
}

console.log(`Scanned ${modelCount} unique main Spine models and ${animationCount} animations.`)
console.log(`Found ${candidates.length} structurally state-like animations across ${entryCount} library entries.`)
console.log('Reference coverage:')
for (const reference of referenceChecks) {
  console.log(`  ${reference.found ? 'OK' : 'MISSING'}  ${reference.entry} / ${reference.folder} / ${reference.animation}`)
}

const countsByEntry = new Map()
for (const candidate of candidates) {
  const key = `${candidate.category}:${candidate.entry}`
  countsByEntry.set(key, (countsByEntry.get(key) ?? 0) + 1)
}
console.log('Highest candidate counts:')
for (const [entry, count] of [...countsByEntry].sort((left, right) => right[1] - left[1]).slice(0, 12)) {
  console.log(`  ${String(count).padStart(3)}  ${entry}`)
}

if (showAll) {
  console.log('All candidates:')
  for (const candidate of candidates) {
    console.log(`  ${candidate.entry}\t${candidate.variant}\t${candidate.animation}\t${candidate.affectedSlots} slots`)
  }
}

if (!referenceChecks.every((reference) => reference.found)) process.exitCode = 1
