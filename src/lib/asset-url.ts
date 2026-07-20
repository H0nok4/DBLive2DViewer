const RAW_ROOT = 'https://raw.githubusercontent.com/bungaku-moe/DaiblosCoreAssets/main/'
const LOCAL_ROOT = '/daiblos-assets/'

function encodedPath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/')
}

export function assetUrlCandidates(jsonPath: string, atlasPath: string) {
  return [
    {
      source: 'local' as const,
      jsonUrl: `${LOCAL_ROOT}${encodedPath(jsonPath)}`,
      atlasUrl: `${LOCAL_ROOT}${encodedPath(atlasPath)}`,
    },
    {
      source: 'remote' as const,
      jsonUrl: `${RAW_ROOT}${encodedPath(jsonPath)}`,
      atlasUrl: `${RAW_ROOT}${encodedPath(atlasPath)}`,
    },
  ]
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

export function shortFolder(folder: string) {
  return folder.replace(/_spine$/i, '').replace(/_/g, ' · ')
}
