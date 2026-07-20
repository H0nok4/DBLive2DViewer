import { readdir, stat, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const owner = 'bungaku-moe'
const repo = 'DaiblosCoreAssets'
const branch = 'main'
const source = `https://github.com/${owner}/${repo}`
const scriptDir = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDir, '../DaiblosCoreAssets')
const spineRoot = resolve(repositoryRoot, 'spine')
const outputPath = resolve(scriptDir, '../src/data/assets.generated.json')

function stem(path) {
  return path.split('/').at(-1).replace(/\.[^.]+$/, '')
}

function normalize(value) {
  return value.toLowerCase().replace(/character|charact|chara|spine|skin|break|berak|synchro|[^a-z0-9]/g, '')
}

function displayName(value) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim()
}

function sharedPrefixScore(left, right) {
  const a = normalize(stem(left))
  const b = normalize(stem(right))
  let score = 0
  while (score < a.length && score < b.length && a[score] === b[score]) score += 1
  return score
}

function pickAtlas(jsonPath, atlases) {
  if (atlases.length === 1) return atlases[0]
  return [...atlases].sort((a, b) => sharedPrefixScore(jsonPath, b.path) - sharedPrefixScore(jsonPath, a.path))[0]
}

function isEffect(path) {
  return /(effect|efect|effec|effet|effcet)/i.test(stem(path))
}

function effectLayer(path) {
  const compact = stem(path).toLowerCase().replace(/[^a-z0-9]/g, '')
  return /f\d*$/.test(compact) ? 'front' : 'back'
}

function effectBase(path) {
  return stem(path)
    .replace(/[_\s-]*(?:effect|efect|effec|effet|effcet)[_\s-]*[bf]?\d*$/i, '')
}

function assetFor(json, folderName, atlases, textures) {
  const atlas = pickAtlas(json.path, atlases)
  return {
    id: `${folderName}/${stem(json.path)}`,
    characterId: folderName.match(/^\d+/)?.[0] ?? '—',
    title: displayName(stem(json.path).replace(/^\d+[_-]?/, '')),
    folder: folderName,
    jsonPath: json.path,
    atlasPath: atlas.path,
    texturePaths: textures.map((file) => file.path),
    bytes: json.size + atlas.size + textures.reduce((sum, file) => sum + file.size, 0),
    spineVersion: '3.8.99',
  }
}

function parseCharacterFolder(folderName) {
  const cleaned = folderName.replace(/_spine$/i, '').trim()
  const characterId = cleaned.match(/^\d+/)?.[0]
  let name = cleaned
  let kind = 'default'
  let code = ''

  let match = cleaned.match(/^\d+_(break|berak)_(.+)$/i)
  if (match) {
    kind = 'break'
    name = match[2]
  } else if ((match = cleaned.match(/^\d+_synchro_(.+)$/i))) {
    kind = 'synchro'
    name = match[1]
  } else if ((match = cleaned.match(/^\d+_skin(\d+[a-z]?)_(.+)$/i))) {
    kind = 'skin'
    code = match[1]
    name = match[2]
  } else if ((match = cleaned.match(/^\d+_skin_(.+)$/i))) {
    kind = 'skin'
    const detail = match[1].replace(/_asmr$/i, '')
    const codeMatch = detail.match(/(sp)?(\d{2}[a-z]?)$/i)
    if (codeMatch) {
      code = `${codeMatch[1] ?? ''}${codeMatch[2]}`
      name = detail.slice(0, -codeMatch[0].length)
    } else {
      name = detail
    }
    if (/_asmr$/i.test(match[1])) code = `${code || 'ASMR'} · ASMR`
  } else if ((match = cleaned.match(/^half(\d+)_(.+)$/i))) {
    kind = 'variant'
    code = `半身 ${match[1]}`
    name = match[2]
  } else if ((match = cleaned.match(/^\d+_(.+?)(\d{2}[a-z]?)$/i))) {
    kind = 'skin'
    name = match[1]
    code = match[2]
  } else {
    name = cleaned.replace(/_[12]$/i, '')
    const suffix = cleaned.match(/_([12])$/i)?.[1]
    if (suffix) {
      kind = 'variant'
      code = `形态 ${suffix}`
    }
  }

  name = name.replace(/_spine$/i, '').replace(/^ijensp$/i, 'ijen').replace(/^zues$/i, 'zeus')
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '') || cleaned.toLowerCase()
  return { key, title: displayName(name), characterId, kind, code }
}

function variantLabel(identity, main, mainCount) {
  if (mainCount > 1) {
    const mainStem = stem(main.jsonPath)
      .replace(/^\d+[_-]?/, '')
      .replace(/(?:character|charact|chara)$/i, '')
      .replace(/^skin[_-]?/i, '')
    const codeMatch = mainStem.match(/(?:sp)?\d{2}[a-z]?$/i)
    if (identity.kind === 'skin' && codeMatch) return `皮肤 ${codeMatch[0].toUpperCase()}`
    return displayName(mainStem) || identity.code || '默认'
  }
  if (identity.kind === 'break') return '突破'
  if (identity.kind === 'skin') return `皮肤 ${identity.code.toUpperCase() || '特别版'}`
  if (identity.kind === 'synchro') return '同步形态'
  if (identity.kind === 'variant') return identity.code || '特别形态'
  return '默认'
}

function uniqueVariantLabels(variants) {
  const counts = new Map()
  for (const variant of variants) counts.set(variant.label, (counts.get(variant.label) ?? 0) + 1)
  for (const variant of variants) {
    if ((counts.get(variant.label) ?? 0) < 2) continue
    const id = variant.main.characterId
    const suffix = id === '—' ? variant.main.folder : id
    variant.label = `${variant.label} · ${suffix}`
  }
}

function dedupeVariants(variants) {
  const unique = new Map()
  for (const variant of variants) {
    const key = `${variant.kind}:${stem(variant.main.jsonPath).toLowerCase()}`
    const current = unique.get(key)
    if (!current || sharedPrefixScore(variant.main.folder, variant.main.jsonPath) > sharedPrefixScore(current.main.folder, current.main.jsonPath)) {
      unique.set(key, variant)
    }
  }
  return [...unique.values()]
}

function kindFromMain(identity, main) {
  const mainStem = stem(main.jsonPath)
  if (/(^|_)(break|berak)(_|$)/i.test(mainStem)) return 'break'
  if (/(^|_)synchro(_|$)/i.test(mainStem)) return 'synchro'
  if (/(^|_)skin(_|$)/i.test(mainStem)) return 'skin'
  return identity.kind
}

function variantRank(variant) {
  const ranks = { default: 0, break: 1, synchro: 2, skin: 3, variant: 4 }
  return ranks[variant.kind] ?? 9
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(path))
    else if (entry.isFile()) {
      const info = await stat(path)
      files.push({
        path: relative(repositoryRoot, path).split(sep).join('/'),
        size: info.size,
      })
    }
  }
  return files
}

function gitRevision() {
  const result = spawnSync('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', shell: false })
  return result.status === 0 ? result.stdout.trim() : branch
}

const files = await walk(spineRoot)
const groups = new Map()
for (const file of files) {
  const folder = file.path.slice(0, file.path.lastIndexOf('/'))
  if (!groups.has(folder)) groups.set(folder, [])
  groups.get(folder).push(file)
}

const characterEntries = new Map()
const cgEntries = []
let modelCount = 0

for (const [folder, folderFiles] of groups) {
  const jsonFiles = folderFiles.filter((file) => file.path.toLowerCase().endsWith('.json') && !/\s#\d+\.json$/i.test(file.path))
  const atlasFiles = folderFiles.filter((file) => file.path.toLowerCase().endsWith('.atlas'))
  const textureFiles = folderFiles.filter((file) => /\.(png|webp|jpg|jpeg)$/i.test(file.path) && !/\s#\d+\.(png|webp|jpg|jpeg)$/i.test(file.path))
  if (!jsonFiles.length || !atlasFiles.length) continue

  const folderName = folder.split('/').at(-1)
  const mainFiles = jsonFiles.filter((file) => !isEffect(file.path))
  const effectFiles = jsonFiles.filter((file) => isEffect(file.path))
  if (!mainFiles.length) continue
  modelCount += jsonFiles.length

  const mains = mainFiles.map((json) => assetFor(json, folderName, atlasFiles, textureFiles))
  const effects = effectFiles.map((json) => assetFor(json, folderName, atlasFiles, textureFiles))
  const effectsByMain = new Map(mains.map((main) => [main.id, []]))

  for (const effect of effects) {
    const target = [...mains].sort((a, b) => sharedPrefixScore(effectBase(effect.jsonPath), b.jsonPath) - sharedPrefixScore(effectBase(effect.jsonPath), a.jsonPath))[0]
    effectsByMain.get(target.id).push({ layer: effectLayer(effect.jsonPath), asset: effect })
  }

  if (/^cg/i.test(folderName)) {
    const variants = mains.map((main) => {
      const attached = effectsByMain.get(main.id)
      return {
        id: main.id,
        label: mains.length === 1 ? 'CG 主画面' : main.title,
        kind: 'variant',
        main,
        effects: attached,
        bytes: main.bytes + attached.reduce((sum, effect) => sum + effect.asset.bytes, 0),
      }
    })
    const rawTitle = folderName.replace(/^cg\d*[_-]?/i, '').replace(/_spine$/i, '') || folderName
    cgEntries.push({
      id: `cg:${folderName.toLowerCase()}`,
      title: displayName(rawTitle),
      category: 'cg',
      characterIds: [],
      variants,
    })
    continue
  }

  const identity = parseCharacterFolder(folderName)
  const entry = characterEntries.get(identity.key) ?? {
    id: `character:${identity.key}`,
    title: identity.title,
    category: 'character',
    characterIds: [],
    variants: [],
  }
  if (identity.characterId && !entry.characterIds.includes(identity.characterId)) entry.characterIds.push(identity.characterId)

  for (const main of mains) {
    const attached = effectsByMain.get(main.id)
    const kind = kindFromMain(identity, main)
    entry.variants.push({
      id: main.id,
      label: variantLabel({ ...identity, kind }, main, mains.length),
      kind,
      main,
      effects: attached,
      bytes: main.bytes + attached.reduce((sum, effect) => sum + effect.asset.bytes, 0),
    })
  }
  characterEntries.set(identity.key, entry)
}

const characters = [...characterEntries.values()]
for (const entry of characters) {
  entry.variants = dedupeVariants(entry.variants)
  uniqueVariantLabels(entry.variants)
  entry.characterIds.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  entry.variants.sort((a, b) => variantRank(a) - variantRank(b) || a.label.localeCompare(b.label, undefined, { numeric: true }))
}

characters.sort((a, b) => (a.characterIds[0] ?? '999999').localeCompare(b.characterIds[0] ?? '999999', undefined, { numeric: true }) || a.title.localeCompare(b.title))
cgEntries.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))

const entries = [...characters, ...cgEntries]
const output = {
  generatedAt: new Date().toISOString(),
  source,
  revision: gitRevision(),
  folderCount: groups.size,
  modelCount,
  entryCount: entries.length,
  entries,
}

await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(`Generated ${characters.length} characters and ${cgEntries.length} CG entries (${modelCount} Spine files) -> ${outputPath}`)
