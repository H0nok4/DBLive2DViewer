import { ALPHA_MODES, BaseTexture, MIPMAP_MODES } from 'pixi.js'
import {
  AtlasAttachmentLoader,
  SkeletonJson,
  TextureAtlas,
  type SkeletonData,
} from '@pixi-spine/all-3.8'

interface AtlasPageSpec {
  name: string
  width: number
  height: number
  requiredWidth: number
  requiredHeight: number
}

export interface LoadedSpineAsset {
  spineData: SkeletonData
  normalizedPages: string[]
  destroy: () => void
}

function parseAtlasPages(atlasText: string): AtlasPageSpec[] {
  const blocks = atlasText
    .replace(/^\uFEFF/, '')
    .split(/(?:\r?\n){2,}/)
    .map((block) => block.trim())
    .filter(Boolean)

  return blocks.map((block) => {
    const lines = block.split(/\r?\n/)
    const name = lines[0].trim()
    let width = 0
    let height = 0
    let requiredWidth = 0
    let requiredHeight = 0
    let region: { x: number; y: number; width: number; height: number; rotated: boolean } | undefined

    const commitRegion = () => {
      if (!region) return
      const frameWidth = region.rotated ? region.height : region.width
      const frameHeight = region.rotated ? region.width : region.height
      requiredWidth = Math.max(requiredWidth, region.x + frameWidth)
      requiredHeight = Math.max(requiredHeight, region.y + frameHeight)
    }

    for (let index = 1; index < lines.length; index += 1) {
      const line = lines[index].trim()
      if (!line.includes(':')) {
        commitRegion()
        region = { x: 0, y: 0, width: 0, height: 0, rotated: false }
        continue
      }

      const pair = (key: string) => new RegExp(`^${key}:\\s*(-?\\d+)\\s*,\\s*(-?\\d+)`, 'i').exec(line)
      if (!region) {
        const size = pair('size')
        if (size) {
          width = Number(size[1])
          height = Number(size[2])
        }
        continue
      }

      const bounds = /^bounds:\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)/i.exec(line)
      const xy = pair('xy')
      const size = pair('size')
      const rotate = /^rotate:\s*(.+)$/i.exec(line)?.[1].trim().toLowerCase()
      if (bounds) {
        region.x = Number(bounds[1])
        region.y = Number(bounds[2])
        region.width = Number(bounds[3])
        region.height = Number(bounds[4])
      } else if (xy) {
        region.x = Number(xy[1])
        region.y = Number(xy[2])
      } else if (size) {
        region.width = Number(size[1])
        region.height = Number(size[2])
      } else if (rotate) {
        region.rotated = rotate === 'true' || (rotate !== 'false' && Number(rotate) % 180 !== 0)
      }
    }
    commitRegion()

    return { name, width, height, requiredWidth, requiredHeight }
  })
}

function imageUrlForPage(atlasUrl: string, pageName: string) {
  const atlasAbsoluteUrl = new URL(atlasUrl, window.location.href)
  const encodedPageName = pageName.split('/').map(encodeURIComponent).join('/')
  return new URL(encodedPageName, new URL('.', atlasAbsoluteUrl)).toString()
}

async function fetchChecked(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`)
  return response
}

async function loadPageTexture(
  page: AtlasPageSpec,
  atlasUrl: string,
  signal: AbortSignal,
) {
  const imageUrl = imageUrlForPage(atlasUrl, page.name)
  const imageResponse = await fetchChecked(imageUrl, signal)
  const blob = await imageResponse.blob()
  let bitmap = await createImageBitmap(blob, {
    // The repository PNG channels are already premultiplied (for example the
    // Reduvia blush mask stores RGBA around 42/30/33/43). Premultiplying again
    // turns translucent pink overlays into gray-black patches.
    premultiplyAlpha: 'none',
  })
  if (signal.aborted) {
    bitmap.close()
    throw signal.reason
  }

  // Many repository pages were resized to power-of-two dimensions without
  // updating the atlas coordinates. Restore the atlas' logical page size; the
  // region extents are retained as a safety net for malformed size headers.
  const width = Math.max(page.width || bitmap.width, page.requiredWidth)
  const height = Math.max(page.height || bitmap.height, page.requiredHeight)
  const normalized = width !== bitmap.width || height !== bitmap.height

  if (normalized) {
    bitmap.close()
    bitmap = await createImageBitmap(blob, {
      premultiplyAlpha: 'none',
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: 'high',
    })
    if (signal.aborted) {
      bitmap.close()
      throw signal.reason
    }
  }

  return {
    // These atlases specify Linear rather than a mipmapped minification mode.
    // Disabling Pixi's POT default prevents neighboring packed regions and
    // transparent-black padding from leaking into joints and facial meshes.
    texture: BaseTexture.from(bitmap, {
      alphaMode: ALPHA_MODES.PMA,
      mipmap: MIPMAP_MODES.OFF,
      resolution: 1,
      resourceOptions: {
        alphaMode: ALPHA_MODES.PMA,
        ownsImageBitmap: true,
      },
    }),
    normalized,
  }
}

function createTextureAtlas(atlasText: string, textures: Map<string, BaseTexture>) {
  return new Promise<TextureAtlas>((resolve, reject) => {
    try {
      new TextureAtlas(
        atlasText,
        (pageName, done) => {
          const texture = textures.get(pageName)
          if (!texture) throw new Error(`Atlas 引用了不存在的纹理页: ${pageName}`)
          done(texture)
        },
        (atlas) => {
          if (!atlas) reject(new Error('Atlas 解析失败'))
          else resolve(atlas)
        },
      )
    } catch (error) {
      reject(error)
    }
  })
}

export async function loadSpineAsset(
  jsonUrl: string,
  atlasUrl: string,
  signal: AbortSignal,
): Promise<LoadedSpineAsset> {
  const textures = new Map<string, BaseTexture>()
  let atlas: TextureAtlas | undefined

  try {
    const [jsonResponse, atlasResponse] = await Promise.all([
      fetchChecked(jsonUrl, signal),
      fetchChecked(atlasUrl, signal),
    ])
    const [jsonData, atlasText] = await Promise.all([
      jsonResponse.json(),
      atlasResponse.text(),
    ])
    const pages = parseAtlasPages(atlasText)
    if (!pages.length) throw new Error('Atlas 中没有可用的纹理页')

    const loadedPages = await Promise.all(
      pages.map(async (page) => {
        const loaded = await loadPageTexture(page, atlasUrl, signal)
        textures.set(page.name, loaded.texture)
        return { page, ...loaded }
      }),
    )

    atlas = await createTextureAtlas(atlasText, textures)
    const attachmentLoader = new AtlasAttachmentLoader(atlas)
    const skeletonJson = new SkeletonJson(attachmentLoader)
    const spineData = skeletonJson.readSkeletonData(jsonData)

    return {
      spineData,
      normalizedPages: loadedPages.filter((page) => page.normalized).map((page) => page.page.name),
      destroy: () => {
        for (const region of atlas?.regions ?? []) region.texture.destroy(false)
        for (const texture of textures.values()) texture.destroy()
        textures.clear()
      },
    }
  } catch (error) {
    for (const region of atlas?.regions ?? []) region.texture.destroy(false)
    for (const texture of textures.values()) texture.destroy()
    throw error
  }
}
