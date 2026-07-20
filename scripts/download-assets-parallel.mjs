import { mkdir, rename, stat, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const owner = 'bungaku-moe'
const repository = 'DaiblosCoreAssets'
const revision = process.argv[2] ?? 'main'
const targetRoot = resolve(import.meta.dirname, '../DaiblosCoreAssets')
const concurrency = 8
const sourceRoots = [
  `https://cdn.jsdelivr.net/gh/${owner}/${repository}@${revision}/`,
  `https://raw.githubusercontent.com/${owner}/${repository}/${revision}/`,
  `https://raw.githubusercontent.com/${owner}/${repository}/${revision}/`,
]

const apiResponse = await fetch(
  `https://api.github.com/repos/${owner}/${repository}/git/trees/${revision}?recursive=1`,
  { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Daiblos-Spine-Viewer' } },
)
if (!apiResponse.ok) throw new Error(`GitHub tree request failed: ${apiResponse.status}`)

const tree = await apiResponse.json()
if (tree.truncated) throw new Error('GitHub returned a truncated repository tree')
const files = tree.tree.filter((item) => item.type === 'blob')
const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
let completedFiles = 0
let readyBytes = 0
let downloadedBytes = 0
let cursor = 0
const startedAt = Date.now()

async function existingFileMatches(path, size) {
  try {
    return (await stat(path)).size === size
  } catch {
    return false
  }
}

function downloadWithCurl(url, target, timeoutSeconds) {
  return new Promise((resolveDownload, rejectDownload) => {
    const command = process.platform === 'win32' ? 'curl.exe' : 'curl'
    const child = spawn(command, [
      '--fail',
      '--location',
      '--silent',
      '--show-error',
      '--max-time',
      String(timeoutSeconds),
      '--output',
      target,
      url,
    ], { stdio: ['ignore', 'ignore', 'pipe'] })
    let errorOutput = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { errorOutput += chunk })
    child.on('error', rejectDownload)
    child.on('close', (code) => {
      if (code === 0) resolveDownload()
      else rejectDownload(new Error(errorOutput.trim() || `curl exited with ${code}`))
    })
  })
}

async function downloadOnce(file, sourceRoot) {
  const target = resolve(targetRoot, file.path)
  if (await existingFileMatches(target, file.size)) {
    completedFiles += 1
    readyBytes += file.size
    return
  }

  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.part`
  await unlink(temporary).catch(() => {})
  const encodedPath = file.path.split('/').map(encodeURIComponent).join('/')
  await downloadWithCurl(
    `${sourceRoot}${encodedPath}`,
    temporary,
    sourceRoot.includes('jsdelivr') ? 60 : 180,
  )
  if (!(await existingFileMatches(temporary, file.size))) {
    throw new Error(`Size check failed: ${file.path}`)
  }
  await rename(temporary, target)
  completedFiles += 1
  readyBytes += file.size
  downloadedBytes += file.size
}

async function download(file) {
  let lastError
  for (let attempt = 1; attempt <= sourceRoots.length; attempt += 1) {
    try {
      await downloadOnce(file, sourceRoots[attempt - 1])
      return
    } catch (error) {
      lastError = error
      console.warn(`Retry ${attempt}/${sourceRoots.length}: ${file.path}`)
    }
  }
  throw lastError
}

async function worker() {
  while (cursor < files.length) {
    const file = files[cursor]
    cursor += 1
    await download(file)
  }
}

const progressTimer = setInterval(() => {
  const elapsedSeconds = Math.max(1, (Date.now() - startedAt) / 1000)
  const readyGiB = (readyBytes / 1024 ** 3).toFixed(2)
  const totalGiB = (totalBytes / 1024 ** 3).toFixed(2)
  const speedMiB = (downloadedBytes / 1024 ** 2 / elapsedSeconds).toFixed(1)
  console.log(`${completedFiles}/${files.length} files · ${readyGiB}/${totalGiB} GiB ready · ${speedMiB} MiB/s`)
}, 5000)

try {
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
} finally {
  clearInterval(progressTimer)
}

console.log(`Snapshot ready: ${files.length} files, ${(totalBytes / 1024 ** 3).toFixed(2)} GiB`)
