import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const repositoryUrl = 'https://github.com/bungaku-moe/DaiblosCoreAssets.git'
const assetRoot = resolve(import.meta.dirname, '../DaiblosCoreAssets')
const gitDirectory = resolve(assetRoot, '.git')
const downloader = resolve(import.meta.dirname, 'download-assets-parallel.mjs')
const manifestGenerator = resolve(import.meta.dirname, 'generate-manifest.mjs')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (!existsSync(gitDirectory)) {
  console.log('Preparing lightweight Git metadata…')
  run('git', [
    'clone',
    '--depth', '1',
    '--filter=blob:none',
    '--no-checkout',
    '--single-branch',
    '--branch', 'main',
    repositoryUrl,
    assetRoot,
  ])
} else {
  console.log('Updating repository metadata…')
  run('git', ['-C', assetRoot, 'pull', '--ff-only'])
}

const revisionResult = spawnSync('git', ['-C', assetRoot, 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
  shell: false,
})
if (revisionResult.error) throw revisionResult.error
if (revisionResult.status !== 0) process.exit(revisionResult.status ?? 1)
const revision = revisionResult.stdout.trim()

console.log(`Synchronizing and verifying assets at ${revision.slice(0, 7)}…`)
run(process.execPath, [downloader, revision])
run('git', ['-C', assetRoot, 'read-tree', 'HEAD'])
const verificationResult = spawnSync(
  'git',
  ['-C', assetRoot, 'status', '--short', '--untracked-files=no'],
  {
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1' },
  },
)
if (verificationResult.error) throw verificationResult.error
if (verificationResult.status !== 0) process.exit(verificationResult.status ?? 1)
if (verificationResult.stdout.trim()) {
  console.error('Asset verification failed: the local worktree differs from the selected commit.')
  console.error(verificationResult.stdout)
  process.exit(1)
}

console.log(`Local assets are ready at ${assetRoot}`)
console.log('Rebuilding the grouped character / CG manifest…')
run(process.execPath, [manifestGenerator])
