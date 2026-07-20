import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream, existsSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'

const assetRepositoryRoot = resolve(import.meta.dirname, 'DaiblosCoreAssets')
const localAssetPrefix = '/daiblos-assets/'

const contentTypes: Record<string, string> = {
  '.atlas': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

function localAssetMiddleware(
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) {
  if (!request.url?.startsWith(localAssetPrefix)) {
    next()
    return
  }

  try {
    const requestPath = decodeURIComponent(request.url.slice(localAssetPrefix.length).split('?')[0])
    const target = resolve(assetRepositoryRoot, requestPath)
    const allowedRoot = `${resolve(assetRepositoryRoot, 'spine')}${sep}`.toLowerCase()
    const isAllowed = target.toLowerCase().startsWith(allowedRoot)

    if (!isAllowed || !existsSync(target) || !statSync(target).isFile()) {
      response.statusCode = 404
      response.end('Local Spine asset not found')
      return
    }

    response.statusCode = 200
    response.setHeader('Content-Type', contentTypes[extname(target).toLowerCase()] ?? 'application/octet-stream')
    response.setHeader('Cache-Control', 'public, max-age=3600')
    createReadStream(target).pipe(response)
  } catch {
    response.statusCode = 400
    response.end('Invalid local asset path')
  }
}

function localAssetsPlugin(): Plugin {
  return {
    name: 'daiblos-local-assets',
    configureServer(server) {
      server.middlewares.use(localAssetMiddleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(localAssetMiddleware)
    },
  }
}

export default defineConfig({
  plugins: [react(), localAssetsPlugin()],
  base: './',
  server: {
    host: '127.0.0.1',
    port: 4173,
  },
})
