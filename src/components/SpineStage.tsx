import { useEffect, useRef, useState } from 'react'
import { Application, Container, type Rectangle } from 'pixi.js'
import { AttachmentType, MixBlend, MixDirection, Skeleton, Spine, SpineDebugRenderer } from '@pixi-spine/all-3.8'
import type {
  AssetSource,
  LoadState,
  SpineAsset,
  SpineEffect,
  SpineLayerGroupKind,
  SpineLayerInfo,
  SpineMetadata,
} from '../types'
import { assetUrlCandidates } from '../lib/asset-url'
import { loadSpineAsset, type LoadedSpineAsset } from '../lib/spine-loader'

interface SpineStageProps {
  asset: SpineAsset
  effects: SpineEffect[]
  animation: string
  persistentAnimations: string[]
  skin: string
  loop: boolean
  paused: boolean
  speed: number
  zoom: number
  flipped: boolean
  debug: boolean
  retryKey: number
  resetViewKey: number
  hiddenLayerIds: string[]
  onLoadState: (state: LoadState) => void
  onSourceChange: (source: AssetSource) => void
  onMetadata: (metadata: SpineMetadata) => void
  onLayers: (layers: SpineLayerInfo[]) => void
  onProgress: (current: number, duration: number) => void
  onZoomChange: (zoom: number) => void
}

interface ViewOffset {
  x: number
  y: number
}

interface LoadedLayer {
  asset: SpineAsset
  resource: LoadedSpineAsset
  layer: 'main' | 'back' | 'front'
}

interface SpineInstance {
  id: string
  label: string
  kind: SpineLayerGroupKind
  spine: Spine
}

function positionGroup(
  group: Container,
  app: Application,
  zoom: number,
  flipped: boolean,
  offset: ViewOffset,
  bounds?: Rectangle,
) {
  const measured = bounds ?? group.getLocalBounds()
  if (!measured.width || !measured.height) return

  const availableWidth = Math.max(320, app.screen.width) * 0.76
  const availableHeight = Math.max(320, app.screen.height) * 0.8
  const fitted = Math.min(availableWidth / measured.width, availableHeight / measured.height)
  const scale = Math.max(0.02, Math.min(4, fitted)) * zoom
  const scaleX = flipped ? -scale : scale

  group.scale.set(scaleX, scale)
  group.position.set(
    app.screen.width / 2 + offset.x - (measured.x + measured.width / 2) * scaleX,
    app.screen.height / 2 + offset.y - (measured.y + measured.height / 2) * scale,
  )
}

function preferredAnimation(spine: Spine, requested: string) {
  const animations = spine.spineData.animations.map((item) => item.name)
  if (requested && animations.includes(requested)) return requested
  return animations.find((name) => /(^|_)idle($|_)/i.test(name)) ?? animations[0] ?? ''
}

function applyAnimation(spine: Spine, requested: string, loop: boolean) {
  const next = preferredAnimation(spine, requested)
  if (next) spine.state.setAnimation(0, next, loop)
  spine.update(0)
  return next
}

function colorsMatch(
  left: { r: number; g: number; b: number; a: number } | null | undefined,
  right: { r: number; g: number; b: number; a: number } | null | undefined,
) {
  if (!left || !right) return left === right
  return Math.abs(left.r - right.r) < 0.0001
    && Math.abs(left.g - right.g) < 0.0001
    && Math.abs(left.b - right.b) < 0.0001
    && Math.abs(left.a - right.a) < 0.0001
}

function arraysMatch(left: ArrayLike<number>, right: ArrayLike<number>) {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (Math.abs(left[index] - right[index]) >= 0.0001) return false
  }
  return true
}

function createPoseSkeleton(spine: Spine) {
  const skeleton = new Skeleton(spine.spineData)
  if (spine.skeleton.skin) skeleton.setSkin(spine.skeleton.skin)
  skeleton.setSlotsToSetupPose()
  return skeleton
}

function isPersistentStateAnimation(spine: Spine, animation: Spine['spineData']['animations'][number]) {
  const hasMotionTimeline = animation.timelines.some((timeline) => {
    return 'boneIndex' in timeline
      || 'ikConstraintIndex' in timeline
      || 'transformConstraintIndex' in timeline
      || 'pathConstraintIndex' in timeline
  })
  if (hasMotionTimeline) return false

  const setup = createPoseSkeleton(spine)
  const posed = createPoseSkeleton(spine)
  animation.apply(
    posed,
    -1,
    animation.duration + 0.0001,
    false,
    [],
    1,
    MixBlend.setup,
    MixDirection.mixIn,
  )

  const slotChanged = posed.slots.some((slot, index) => {
    const setupSlot = setup.slots[index]
    return slot.getAttachment() !== setupSlot.getAttachment()
      || !colorsMatch(slot.color, setupSlot.color)
      || !colorsMatch(slot.darkColor, setupSlot.darkColor)
      || !arraysMatch(slot.deform, setupSlot.deform)
  })
  if (slotChanged) return true

  return posed.drawOrder.some((slot, index) => slot.data.index !== setup.drawOrder[index].data.index)
}

function collectPersistentStateAnimations(spine: Spine) {
  return spine.spineData.animations
    .filter((animation) => isPersistentStateAnimation(spine, animation))
    .map((animation) => animation.name)
}

function stateTrackIndex(spine: Spine, animationName: string) {
  const index = spine.spineData.animations.findIndex((animation) => animation.name === animationName)
  return index < 0 ? undefined : index + 1
}

function restoreTrackedPose(spine: Spine) {
  spine.skeleton.setToSetupPose()
  spine.state.apply(spine.skeleton)
  spine.skeleton.updateWorldTransform()
}

function syncPersistentAnimations(spine: Spine, requested: ReadonlySet<string>, active: Set<string>) {
  let removed = false
  for (const name of [...active]) {
    if (requested.has(name)) continue
    const trackIndex = stateTrackIndex(spine, name)
    if (trackIndex !== undefined) spine.state.clearTrack(trackIndex)
    active.delete(name)
    removed = true
  }

  for (const name of requested) {
    if (active.has(name)) continue
    const trackIndex = stateTrackIndex(spine, name)
    if (trackIndex === undefined) continue
    spine.state.setAnimation(trackIndex, name, false)
    active.add(name)
  }

  if (removed) restoreTrackedPose(spine)
  spine.update(0)
}

function isRenderableAttachment(type: AttachmentType) {
  return type === AttachmentType.Region || type === AttachmentType.Mesh || type === AttachmentType.LinkedMesh
}

function timelineSlotIndex(timeline: unknown) {
  if (!timeline || typeof timeline !== 'object' || !('slotIndex' in timeline)) return undefined
  const value = Reflect.get(timeline, 'slotIndex')
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

function renderableSlotIndexes(spine: Spine) {
  const indexes = new Set<number>()
  for (const skin of spine.spineData.skins) {
    for (const entry of skin.getAttachments()) {
      if (isRenderableAttachment(entry.attachment.type)) indexes.add(entry.slotIndex)
    }
  }
  return indexes
}

function collectLayerInfo(instances: SpineInstance[], requestedAnimation: string) {
  const result: SpineLayerInfo[] = []

  for (const instance of instances) {
    const { spine } = instance
    const renderableIndexes = renderableSlotIndexes(spine)
    const relevantIndexes = new Set<number>()
    const currentAnimation = spine.spineData.findAnimation(preferredAnimation(spine, requestedAnimation))

    for (const timeline of currentAnimation?.timelines ?? []) {
      const index = timelineSlotIndex(timeline)
      if (index !== undefined) relevantIndexes.add(index)
    }
    for (let index = 0; index < spine.skeleton.slots.length; index += 1) {
      const attachment = spine.skeleton.slots[index].getAttachment()
      if (attachment && isRenderableAttachment(attachment.type)) relevantIndexes.add(index)
    }

    const drawOrder = new Map(spine.skeleton.drawOrder.map((slot, index) => [slot.data.index, index]))
    const sortedIndexes = [...relevantIndexes]
      .filter((index) => renderableIndexes.has(index))
      .sort((left, right) => (drawOrder.get(right) ?? right) - (drawOrder.get(left) ?? left))

    for (const slotIndex of sortedIndexes) {
      const slot = spine.skeleton.slots[slotIndex]
      const attachment = slot.getAttachment()
      result.push({
        id: `${instance.id}::${slotIndex}`,
        name: slot.data.name,
        attachment: attachment?.name ?? slot.data.attachmentName ?? '',
        groupId: instance.id,
        groupLabel: instance.label,
        groupKind: instance.kind,
        slotIndex,
      })
    }
  }

  return result
}

function applyLayerVisibility(instance: SpineInstance, hiddenLayerIds: ReadonlySet<string>) {
  for (let index = 0; index < instance.spine.slotContainers.length; index += 1) {
    instance.spine.slotContainers[index].renderable = !hiddenLayerIds.has(`${instance.id}::${index}`)
  }
}

function lockLayerVisibility(instance: SpineInstance, hiddenLayerIdsRef: React.RefObject<ReadonlySet<string>>) {
  const originalUpdate = instance.spine.update.bind(instance.spine)
  instance.spine.update = (delta: number) => {
    originalUpdate(delta)
    applyLayerVisibility(instance, hiddenLayerIdsRef.current)
  }
}

function layerIdentity(layer: LoadedLayer) {
  if (layer.layer === 'back') return { id: `back:${layer.asset.id}`, label: `背景 Effect · ${layer.asset.title}`, kind: 'back' as const }
  if (layer.layer === 'front') return { id: `front:${layer.asset.id}`, label: `前景 Effect · ${layer.asset.title}`, kind: 'front' as const }
  return { id: `main:${layer.asset.id}`, label: `主骨架 · ${layer.asset.title}`, kind: 'main' as const }
}

function destroyResources(resources: LoadedSpineAsset[]) {
  for (const resource of resources) resource.destroy()
}

export function SpineStage({
  asset,
  effects,
  animation,
  persistentAnimations,
  skin,
  loop,
  paused,
  speed,
  zoom,
  flipped,
  debug,
  retryKey,
  resetViewKey,
  hiddenLayerIds,
  onLoadState,
  onSourceChange,
  onMetadata,
  onLayers,
  onProgress,
  onZoomChange,
}: SpineStageProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const groupRef = useRef<Container | null>(null)
  const spineRef = useRef<Spine | null>(null)
  const spineLayersRef = useRef<Spine[]>([])
  const spineInstancesRef = useRef<SpineInstance[]>([])
  const activeStateAnimationsRef = useRef<Set<string>>(new Set())
  const requestedStateAnimationsRef = useRef<ReadonlySet<string>>(new Set(persistentAnimations))
  const hiddenLayerIdsRef = useRef<ReadonlySet<string>>(new Set(hiddenLayerIds))
  const loadedAssetsRef = useRef<LoadedSpineAsset[]>([])
  const boundsRef = useRef<Rectangle | undefined>(undefined)
  const offsetRef = useRef<ViewOffset>({ x: 0, y: 0 })
  const viewPropsRef = useRef({ zoom, flipped })
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const lastProgressRef = useRef(0)
  const [rendererReady, setRendererReady] = useState(false)
  const effectKey = effects.map((effect) => `${effect.layer}:${effect.asset.id}`).join('|')
  const persistentAnimationKey = persistentAnimations.join('|')
  requestedStateAnimationsRef.current = new Set(persistentAnimations)

  const layout = () => {
    const group = groupRef.current
    const app = appRef.current
    if (!group || !app) return
    positionGroup(group, app, viewPropsRef.current.zoom, viewPropsRef.current.flipped, offsetRef.current, boundsRef.current)
  }

  const clearStage = (app: Application) => {
    const group = groupRef.current
    if (group) {
      app.stage.removeChild(group)
      group.destroy({ children: true })
    }
    destroyResources(loadedAssetsRef.current)
    groupRef.current = null
    spineRef.current = null
    spineLayersRef.current = []
    spineInstancesRef.current = []
    activeStateAnimationsRef.current.clear()
    loadedAssetsRef.current = []
    boundsRef.current = undefined
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const app = new Application({
      resizeTo: host,
      backgroundAlpha: 0,
      premultipliedAlpha: true,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      powerPreference: 'high-performance',
    })
    appRef.current = app
    const canvas = app.view as HTMLCanvasElement
    canvas.setAttribute('aria-label', 'Spine animation canvas')
    host.appendChild(canvas)

    const resizeObserver = new ResizeObserver(() => requestAnimationFrame(layout))
    resizeObserver.observe(host)
    setRendererReady(true)

    return () => {
      setRendererReady(false)
      resizeObserver.disconnect()
      clearStage(app)
      appRef.current = null
      app.destroy(true, { children: true })
    }
  }, [])

  useEffect(() => {
    if (!rendererReady || !appRef.current) return
    const app = appRef.current
    let cancelled = false
    let tickerHandler: (() => void) | undefined
    const abortController = new AbortController()

    async function loadEffect(effect: SpineEffect, source: AssetSource) {
      const candidate = assetUrlCandidates(effect.asset.jsonPath, effect.asset.atlasPath).find((item) => item.source === source)
      if (!candidate) throw new Error(`缺少 ${source} 素材地址`)
      return loadSpineAsset(candidate.jsonUrl, candidate.atlasUrl, abortController.signal)
    }

    async function load() {
      onSourceChange('checking')
      onLoadState({ kind: 'loading', message: effects.length ? `正在组合角色与 ${effects.length} 个 Effect 图层…` : '正在从本地素材库读取骨架与纹理…' })
      onProgress(0, 0)
      onLayers([])
      clearStage(app)

      try {
        let layers: LoadedLayer[] | undefined
        let lastError: unknown

        for (const candidate of assetUrlCandidates(asset.jsonPath, asset.atlasPath)) {
          if (candidate.source === 'remote') {
            onLoadState({ kind: 'loading', message: '本地素材不可用，正在切换远程备用源…' })
          }

          const candidateResources: LoadedSpineAsset[] = []
          try {
            const mainResource = await loadSpineAsset(candidate.jsonUrl, candidate.atlasUrl, abortController.signal)
            candidateResources.push(mainResource)
            const nextLayers: LoadedLayer[] = [{ asset, resource: mainResource, layer: 'main' }]
            for (const effect of effects) {
              try {
                const resource = await loadEffect(effect, candidate.source)
                candidateResources.push(resource)
                nextLayers.push({ asset: effect.asset, resource, layer: effect.layer })
              } catch (error) {
                if (abortController.signal.aborted) throw error
                console.warn(`[SpineStage] skipped Effect layer ${effect.asset.id}`, error)
              }
            }
            layers = nextLayers
            onSourceChange(candidate.source)
            break
          } catch (error) {
            destroyResources(candidateResources)
            lastError = error
            if (abortController.signal.aborted) break
          }
        }

        if (!layers) throw lastError ?? new Error('没有可用的素材源')
        if (cancelled) {
          destroyResources(layers.map((layer) => layer.resource))
          return
        }

        const group = new Container()
        const orderedLayers = [
          ...layers.filter((layer) => layer.layer === 'back'),
          ...layers.filter((layer) => layer.layer === 'main'),
          ...layers.filter((layer) => layer.layer === 'front'),
        ]
        let mainSpine: Spine | undefined
        const spineInstances: SpineInstance[] = []

        for (const layer of orderedLayers) {
          const spine = new Spine(layer.resource.spineData)
          if (skin && spine.spineData.findSkin(skin)) {
            spine.skeleton.setSkinByName(skin)
            spine.skeleton.setSlotsToSetupPose()
          }
          const identity = layerIdentity(layer)
          const instance: SpineInstance = { ...identity, spine }
          lockLayerVisibility(instance, hiddenLayerIdsRef)
          applyAnimation(spine, animation, loop)
          applyLayerVisibility(instance, hiddenLayerIdsRef.current)
          spine.state.timeScale = paused ? 0 : speed
          if (layer.layer === 'main') mainSpine = spine
          spineInstances.push(instance)
          group.addChild(spine)
        }

        if (!mainSpine) throw new Error('角色主骨架未能加载')
        syncPersistentAnimations(mainSpine, requestedStateAnimationsRef.current, activeStateAnimationsRef.current)
        loadedAssetsRef.current = layers.map((layer) => layer.resource)
        spineLayersRef.current = group.children.filter((child): child is Spine => child instanceof Spine)
        spineInstancesRef.current = spineInstances
        spineRef.current = mainSpine
        groupRef.current = group
        app.stage.addChild(group)

        boundsRef.current = group.getLocalBounds()
        offsetRef.current = { x: 0, y: 0 }
        layout()

        const animations = mainSpine.spineData.animations.map((item) => item.name)
        const skins = mainSpine.spineData.skins.map((item) => item.name)
        onMetadata({
          animations,
          stateAnimations: collectPersistentStateAnimations(mainSpine),
          skins,
          slots: mainSpine.spineData.slots.length,
          bones: mainSpine.spineData.bones.length,
        })
        onLayers(collectLayerInfo(spineInstances, animation))
        onLoadState({ kind: 'ready' })

        tickerHandler = () => {
          const now = performance.now()
          if (now - lastProgressRef.current < 120) return
          lastProgressRef.current = now
          const entry = mainSpine.state.tracks[0]
          if (!entry) return
          const duration = Math.max(0, entry.animationEnd - entry.animationStart)
          const current = duration > 0 ? entry.trackTime % duration : 0
          onProgress(current, duration)
        }
        app.ticker.add(tickerHandler)
      } catch (error) {
        if (cancelled) return
        console.error('[SpineStage] model load failed', error)
        const detail = error instanceof Error ? error.message : String(error)
        onLoadState({
          kind: 'error',
          message: `模型加载失败。请检查本地素材或稍后重试。\n${detail}`,
        })
      }
    }

    void load()
    return () => {
      cancelled = true
      abortController.abort()
      if (tickerHandler) app.ticker?.remove(tickerHandler)
    }
  }, [asset.id, effectKey, rendererReady, retryKey])

  useEffect(() => {
    const mainSpine = spineRef.current
    if (!mainSpine || !animation) return
    for (const spine of spineLayersRef.current) applyAnimation(spine, animation, loop)
    for (const instance of spineInstancesRef.current) applyLayerVisibility(instance, hiddenLayerIdsRef.current)
    onLayers(collectLayerInfo(spineInstancesRef.current, animation))
    onProgress(0, mainSpine.spineData.findAnimation(preferredAnimation(mainSpine, animation))?.duration ?? 0)
  }, [animation, loop])

  useEffect(() => {
    const mainSpine = spineRef.current
    if (!mainSpine) return
    syncPersistentAnimations(mainSpine, new Set(persistentAnimations), activeStateAnimationsRef.current)
    for (const instance of spineInstancesRef.current) applyLayerVisibility(instance, hiddenLayerIdsRef.current)
    onLayers(collectLayerInfo(spineInstancesRef.current, animation))
  }, [persistentAnimationKey])

  useEffect(() => {
    if (!skin) return
    for (const spine of spineLayersRef.current) {
      if (!spine.spineData.findSkin(skin)) continue
      spine.skeleton.setSkinByName(skin)
      spine.skeleton.setSlotsToSetupPose()
      spine.update(0)
    }
    for (const instance of spineInstancesRef.current) applyLayerVisibility(instance, hiddenLayerIdsRef.current)
    onLayers(collectLayerInfo(spineInstancesRef.current, animation))
  }, [skin])

  useEffect(() => {
    const nextHiddenLayerIds = new Set(hiddenLayerIds)
    hiddenLayerIdsRef.current = nextHiddenLayerIds
    for (const instance of spineInstancesRef.current) applyLayerVisibility(instance, nextHiddenLayerIds)
  }, [hiddenLayerIds])

  useEffect(() => {
    for (const spine of spineLayersRef.current) spine.state.timeScale = paused ? 0 : speed
  }, [paused, speed])

  useEffect(() => {
    viewPropsRef.current = { zoom, flipped }
    layout()
  }, [zoom, flipped])

  useEffect(() => {
    offsetRef.current = { x: 0, y: 0 }
    layout()
  }, [resetViewKey])

  useEffect(() => {
    const spine = spineRef.current
    if (!spine) return
    if (!debug) {
      spine.debug = null as unknown as SpineDebugRenderer
      return
    }
    const renderer = new SpineDebugRenderer()
    renderer.drawPaths = false
    renderer.drawBoundingBoxes = false
    renderer.drawClipping = false
    renderer.drawRegionAttachments = false
    renderer.drawMeshTriangles = false
    renderer.bonesColor = 0xd9ff67
    renderer.meshHullColor = 0xff6b58
    spine.debug = renderer
  }, [debug])

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    offsetRef.current.x += event.clientX - drag.x
    offsetRef.current.y += event.clientY - drag.y
    drag.x = event.clientX
    drag.y = event.clientY
    layout()
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
  }

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const direction = event.deltaY > 0 ? -0.08 : 0.08
    onZoomChange(Math.min(2.4, Math.max(0.2, zoom + direction)))
  }

  return (
    <div
      ref={hostRef}
      className="canvas-host"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
    />
  )
}
