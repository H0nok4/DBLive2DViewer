import { useEffect, useRef, useState } from 'react'
import { Application, Container, type Rectangle } from 'pixi.js'
import {
  AttachmentTimeline,
  AttachmentType,
  ColorTimeline,
  DeformTimeline,
  DrawOrderTimeline,
  MixBlend,
  MixDirection,
  Skeleton,
  Spine,
  SpineDebugRenderer,
  TwoColorTimeline,
} from '@pixi-spine/all-3.8'
import type {
  AssetSource,
  LoadState,
  SpineAsset,
  SpineEffect,
  SpineLayerGroupKind,
  SpineLayerInfo,
  SpineMetadata,
  SpineStateGroup,
} from '../types'
import { assetUrlCandidates } from '../lib/asset-url'
import { loadSpineAsset, type LoadedSpineAsset } from '../lib/spine-loader'
import { useI18n } from '../i18n'

interface SpineStageProps {
  asset: SpineAsset
  effects: SpineEffect[]
  animation: string
  persistentAnimations: string[]
  detectCharacterVariants: boolean
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

type CharacterVariantGroup = string

const OVERLAY_TRACK_INDEX = 1
const OVERLAY_BONE_COVERAGE = 0.35
const STATE_MIN_STABLE_DURATION = 0.1
const STATE_MAX_OPTIONS = 6

type ColorTuple = [number, number, number, number]

interface SlotVisualSnapshot {
  slotIndex: number
  attachmentName: string | null
  color: ColorTuple
  darkColor: ColorTuple | null
  deform: number[]
}

interface VisualStateSnapshot {
  id: string
  animationName: string
  time: number
  slots: SlotVisualSnapshot[]
  drawOrder?: number[]
}

interface VisualStateGroupProfile {
  metadata: SpineStateGroup
  slotIndexes: ReadonlySet<number>
  affectsDrawOrder: boolean
}

interface VisualStateProfile {
  groups: VisualStateGroupProfile[]
  snapshots: ReadonlyMap<string, VisualStateSnapshot>
}

interface CharacterVariantProfile {
  animationGroups: ReadonlyMap<string, CharacterVariantGroup>
  defaultGroup: CharacterVariantGroup
  slotIndexes: ReadonlyMap<CharacterVariantGroup, ReadonlySet<number>>
}

interface CharacterVariantBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
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
  return animations.find((name) => /(^|_)idle(?:_?\d+)?($|_)/i.test(name)) ?? animations[0] ?? ''
}

function idleAnimation(spine: Spine) {
  return spine.spineData.animations.find((animation) => /(^|_)idle(?:_?\d+)?($|_)/i.test(animation.name))
}

function animationBoneIndexes(animation: Spine['spineData']['animations'][number]) {
  const indexes = new Set<number>()
  for (const timeline of animation.timelines) {
    const index = timelineBoneIndex(timeline)
    if (index !== undefined) indexes.add(index)
  }
  return indexes
}

function hasMotionTimeline(animation: Spine['spineData']['animations'][number]) {
  return animation.timelines.some((timeline) => {
    return 'boneIndex' in timeline
      || 'ikConstraintIndex' in timeline
      || 'transformConstraintIndex' in timeline
      || 'pathConstraintIndex' in timeline
  })
}

function isOverlayAnimation(spine: Spine, animationName: string) {
  const animation = spine.spineData.findAnimation(animationName)
  const idle = idleAnimation(spine)
  if (!animation || !idle || animation === idle) return false

  const idleBones = animationBoneIndexes(idle).size
  if (idleBones < 10) return false
  return animationBoneIndexes(animation).size / idleBones < OVERLAY_BONE_COVERAGE
}

function collectOverlayAnimations(spine: Spine) {
  return spine.spineData.animations
    .filter((animation) => isOverlayAnimation(spine, animation.name))
    .map((animation) => animation.name)
}

function applyAnimation(spine: Spine, requested: string, loop: boolean) {
  const next = preferredAnimation(spine, requested)
  spine.state.clearTrack(0)
  spine.state.clearTrack(OVERLAY_TRACK_INDEX)
  spine.skeleton.setToSetupPose()

  let trackIndex = 0
  if (next && isOverlayAnimation(spine, next)) {
    const idle = idleAnimation(spine)
    if (idle) spine.state.setAnimation(0, idle.name, true)
    const entry = spine.state.setAnimation(OVERLAY_TRACK_INDEX, next, loop)
    if (!loop) entry.trackEnd = entry.animationEnd
    trackIndex = OVERLAY_TRACK_INDEX
  } else if (next) {
    spine.state.setAnimation(0, next, loop)
  }
  spine.update(0)
  return { name: next, trackIndex }
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
  skeleton.setToSetupPose()
  return skeleton
}

function colorTuple(color: { r: number; g: number; b: number; a: number }): ColorTuple {
  return [color.r, color.g, color.b, color.a]
}

function captureVisualSnapshot(
  spine: Spine,
  animation: Spine['spineData']['animations'][number] | undefined,
  time: number,
  slotIndexes: ReadonlySet<number>,
  affectsDrawOrder: boolean,
): VisualStateSnapshot {
  const skeleton = createPoseSkeleton(spine)
  if (animation) {
    animation.apply(skeleton, -1, time, false, [], 1, MixBlend.setup, MixDirection.mixIn)
  }
  return {
    id: '',
    animationName: animation?.name ?? '',
    time,
    slots: [...slotIndexes].sort((left, right) => left - right).map((slotIndex) => {
      const slot = skeleton.slots[slotIndex]
      return {
        slotIndex,
        attachmentName: slot.getAttachment()?.name ?? null,
        color: colorTuple(slot.color),
        darkColor: slot.darkColor ? colorTuple(slot.darkColor) : null,
        deform: Array.from(slot.deform),
      }
    }),
    drawOrder: affectsDrawOrder ? skeleton.drawOrder.map((slot) => slot.data.index) : undefined,
  }
}

function deformFingerprint(values: ReadonlyArray<number>) {
  let hash = 2166136261
  for (const value of values) {
    hash ^= Math.round(value * 1000)
    hash = Math.imul(hash, 16777619)
  }
  return `${values.length}:${hash >>> 0}`
}

function visualSnapshotSignature(snapshot: VisualStateSnapshot) {
  const slots = snapshot.slots.map((slot) => {
    const color = slot.color.map((value) => Math.round(value * 255)).join('.')
    const dark = slot.darkColor?.map((value) => Math.round(value * 255)).join('.') ?? '-'
    return `${slot.slotIndex}:${slot.attachmentName ?? '-'}:${color}:${dark}:${deformFingerprint(slot.deform)}`
  })
  return `${slots.join('|')}#${snapshot.drawOrder?.join('.') ?? '-'}`
}

function visualSnapshotDistance(base: VisualStateSnapshot, candidate: VisualStateSnapshot) {
  let score = 0
  for (let index = 0; index < candidate.slots.length; index += 1) {
    const left = base.slots[index]
    const right = candidate.slots[index]
    if (left.attachmentName !== right.attachmentName) score += 4
    if ((left.color[3] > 0.05) !== (right.color[3] > 0.05)) score += 4
    if (!arraysMatch(left.color, right.color)) score += 1
    if (!colorsMatch(
      left.darkColor && { r: left.darkColor[0], g: left.darkColor[1], b: left.darkColor[2], a: left.darkColor[3] },
      right.darkColor && { r: right.darkColor[0], g: right.darkColor[1], b: right.darkColor[2], a: right.darkColor[3] },
    )) score += 1
    if (!arraysMatch(left.deform, right.deform)) score += 3
  }
  if (base.drawOrder && candidate.drawOrder && !arraysMatch(base.drawOrder, candidate.drawOrder)) score += 4
  return score
}

function visibleAffectedSlots(snapshot: VisualStateSnapshot) {
  return snapshot.slots.filter((slot) => slot.attachmentName && slot.color[3] > 0.05).length
}

function representativeStateColor(base: VisualStateSnapshot, candidate: VisualStateSnapshot) {
  let selected: ColorTuple | undefined
  let selectedDistance = 0
  for (let index = 0; index < candidate.slots.length; index += 1) {
    const left = base.slots[index].color
    const right = candidate.slots[index].color
    if (right[3] <= 0.2 || left[3] <= 0.2) continue
    const distance = Math.hypot(right[0] - left[0], right[1] - left[1], right[2] - left[2])
    if (distance <= selectedDistance || distance < 0.08) continue
    selected = right
    selectedDistance = distance
  }
  if (!selected) return undefined
  return `#${selected.slice(0, 3).map((value) => Math.round(value * 255).toString(16).padStart(2, '0')).join('')}`
}

function visualTimelineTimes(timeline: unknown) {
  let stride = 0
  if (timeline instanceof ColorTimeline) stride = ColorTimeline.ENTRIES
  else if (timeline instanceof TwoColorTimeline) stride = TwoColorTimeline.ENTRIES
  else if (timeline instanceof AttachmentTimeline || timeline instanceof DeformTimeline || timeline instanceof DrawOrderTimeline) stride = 1
  if (!stride) return []
  const frames = Reflect.get(timeline as object, 'frames') as ArrayLike<number>
  const times: number[] = []
  for (let index = 0; index < frames.length; index += stride) times.push(frames[index])
  return times
}

function collectVisualStateProfile(spine: Spine): VisualStateProfile {
  const snapshots = new Map<string, VisualStateSnapshot>()
  const groups: VisualStateGroupProfile[] = []

  for (const animation of spine.spineData.animations) {
    if (animation === idleAnimation(spine)) continue
    const slotIndexes = new Set<number>()
    const keyTimes = new Set<number>([0, animation.duration])
    let affectsDrawOrder = false
    for (const timeline of animation.timelines) {
      const slotIndex = timelineSlotIndex(timeline)
      if (slotIndex !== undefined) slotIndexes.add(slotIndex)
      if (timeline instanceof DrawOrderTimeline) affectsDrawOrder = true
      for (const time of visualTimelineTimes(timeline)) keyTimes.add(time)
    }
    if (slotIndexes.size < 2 && !affectsDrawOrder) continue

    // A reusable visual state may swap attachments, tint slots, change mesh
    // deformation, or reorder slots. Bone/constraint timelines are motion
    // clips, even when they happen to hold a pose for part of their duration.
    // Persisting those clips creates duplicate limbs and frozen characters.
    if (hasMotionTimeline(animation)) continue

    const setup = captureVisualSnapshot(spine, undefined, 0, slotIndexes, affectsDrawOrder)
    const base = captureVisualSnapshot(spine, animation, 0, slotIndexes, affectsDrawOrder)
    const setupSignature = visualSnapshotSignature(setup)
    const baseSignature = visualSnapshotSignature(base)
    const boundaries = [...keyTimes]
      .filter((time) => Number.isFinite(time) && time >= 0 && time <= animation.duration)
      .sort((left, right) => left - right)
      .filter((time, index, values) => index === 0 || Math.abs(time - values[index - 1]) > 0.0001)
    const candidates = new Map<string, { snapshot: VisualStateSnapshot; stableDuration: number; score: number }>()

    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const start = boundaries[index]
      const end = boundaries[index + 1]
      const stableDuration = end - start
      if (stableDuration < STATE_MIN_STABLE_DURATION) continue
      const inset = Math.min(0.002, stableDuration * 0.1)
      const left = captureVisualSnapshot(spine, animation, start + inset, slotIndexes, affectsDrawOrder)
      const right = captureVisualSnapshot(spine, animation, end - inset, slotIndexes, affectsDrawOrder)
      if (visualSnapshotSignature(left) !== visualSnapshotSignature(right)) continue
      const signature = visualSnapshotSignature(left)
      if (signature === baseSignature || signature === setupSignature) continue
      const score = visualSnapshotDistance(base, left)
      const existing = candidates.get(signature)
      if (!existing || stableDuration > existing.stableDuration) {
        left.time = (start + end) / 2
        candidates.set(signature, { snapshot: left, stableDuration, score })
      }
    }

    let ranked = [...candidates.values()]
    const baselineVisible = visibleAffectedSlots(base)
    ranked = ranked.filter(({ snapshot }) => {
      if (!slotIndexes.size) return true
      const minimumVisible = baselineVisible ? Math.max(1, Math.floor(baselineVisible * 0.25)) : 1
      return visibleAffectedSlots(snapshot) >= minimumVisible
    })
    const maximumScore = Math.max(0, ...ranked.map((candidate) => candidate.score))
    ranked = ranked.filter((candidate) => candidate.score >= Math.max(1, maximumScore * 0.25))

    if (!ranked.length) {
      const score = visualSnapshotDistance(setup, base)
      if (score > 0) ranked = [{ snapshot: base, stableDuration: animation.duration, score }]
    }
    if (!ranked.length) continue

    ranked = ranked
      .sort((left, right) => right.score - left.score || right.stableDuration - left.stableDuration)
      .slice(0, STATE_MAX_OPTIONS)
      .sort((left, right) => left.snapshot.time - right.snapshot.time)
    const groupId = animation.name
    const options = ranked.map(({ snapshot }, index) => {
      const id = `${groupId}~${index + 1}`
      snapshot.id = id
      snapshot.animationName = animation.name
      snapshots.set(id, snapshot)
      return {
        id,
        label: `State ${index + 1}`,
        time: snapshot.time,
        previewColor: representativeStateColor(setup, snapshot),
      }
    })
    groups.push({
      metadata: { id: groupId, label: animation.name, affectedSlots: slotIndexes.size, conflicts: [], options },
      slotIndexes,
      affectsDrawOrder,
    })
  }

  for (const group of groups) {
    group.metadata.conflicts = groups
      .filter((candidate) => candidate !== group && (
        (group.affectsDrawOrder && candidate.affectsDrawOrder)
        || [...group.slotIndexes].some((index) => candidate.slotIndexes.has(index))
      ))
      .map((candidate) => candidate.metadata.id)
  }
  return { groups, snapshots }
}

function applyVisualStates(
  spine: Spine,
  requested: ReadonlySet<string>,
  snapshots: ReadonlyMap<string, VisualStateSnapshot>,
) {
  for (const id of requested) {
    const snapshot = snapshots.get(id)
    if (!snapshot) continue
    for (const visual of snapshot.slots) {
      const slot = spine.skeleton.slots[visual.slotIndex]
      const attachment = visual.attachmentName
        ? spine.skeleton.getAttachment(visual.slotIndex, visual.attachmentName)
        : null
      slot.setAttachment(attachment!)
      slot.color.set(...visual.color)
      if (slot.darkColor && visual.darkColor) slot.darkColor.set(...visual.darkColor)
      slot.deform.length = 0
      slot.deform.push(...visual.deform)
    }
    if (snapshot.drawOrder) {
      spine.skeleton.drawOrder.length = 0
      for (const slotIndex of snapshot.drawOrder) spine.skeleton.drawOrder.push(spine.skeleton.slots[slotIndex])
    }
  }
  spine.skeleton.updateWorldTransform()
}

function isRenderableAttachment(type: AttachmentType) {
  return type === AttachmentType.Region || type === AttachmentType.Mesh || type === AttachmentType.LinkedMesh
}

function timelineSlotIndex(timeline: unknown) {
  if (!timeline || typeof timeline !== 'object' || !('slotIndex' in timeline)) return undefined
  const value = Reflect.get(timeline, 'slotIndex')
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

function timelineBoneIndex(timeline: unknown) {
  if (!timeline || typeof timeline !== 'object' || !('boneIndex' in timeline)) return undefined
  const value = Reflect.get(timeline, 'boneIndex')
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

function characterVariantGroup(name: string): CharacterVariantGroup | undefined {
  const match = name.match(/^([a-z][a-z0-9]{0,11})_/i)
  return match?.[1].toUpperCase()
}

function dominantCharacterGroup(
  counts: ReadonlyMap<CharacterVariantGroup, number>,
  minimum: number,
) {
  const ranked = [...counts].sort((left, right) => right[1] - left[1])
  const [first, second] = ranked
  if (!first || first[1] < minimum || first[1] < (second?.[1] ?? 0) * 2) return undefined
  return first[0]
}

function animationBoneGroup(
  spine: Spine,
  animation: Spine['spineData']['animations'][number],
  candidates: ReadonlySet<CharacterVariantGroup>,
) {
  const counts = new Map([...candidates].map((group) => [group, 0]))
  for (const timeline of animation.timelines) {
    const boneIndex = timelineBoneIndex(timeline)
    if (boneIndex === undefined) continue
    const group = characterVariantGroup(spine.spineData.bones[boneIndex]?.name ?? '')
    if (group && counts.has(group)) counts.set(group, (counts.get(group) ?? 0) + 1)
  }
  return dominantCharacterGroup(counts, 8)
}

function animationSlotGroup(
  spine: Spine,
  animation: Spine['spineData']['animations'][number],
  candidates: ReadonlySet<CharacterVariantGroup>,
) {
  const counts = new Map([...candidates].map((group) => [group, 0]))
  for (const timeline of animation.timelines) {
    const slotIndex = timelineSlotIndex(timeline)
    if (slotIndex === undefined) continue
    const group = characterVariantGroup(spine.spineData.slots[slotIndex]?.name ?? '')
    if (group && counts.has(group)) counts.set(group, (counts.get(group) ?? 0) + 1)
  }
  return dominantCharacterGroup(counts, 4)
}

function animationNameGroup(
  name: string,
  candidates: ReadonlySet<CharacterVariantGroup>,
): CharacterVariantGroup | undefined {
  for (const group of candidates) {
    const escaped = group.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`(?:^|[_-])${escaped}(?:\\d+)?(?:[_-]|$)`, 'i').test(name)) return group
  }
  return undefined
}

function attachmentVertices(slot: Skeleton['slots'][number]) {
  const attachment = slot.getAttachment()
  if (!attachment || !isRenderableAttachment(attachment.type)) return undefined
  const computeWorldVertices = Reflect.get(attachment, 'computeWorldVertices')
  if (typeof computeWorldVertices !== 'function') return undefined

  if (attachment.type === AttachmentType.Region) {
    const vertices = new Float32Array(8)
    computeWorldVertices.call(attachment, slot.bone, vertices, 0, 2)
    return vertices
  }

  const worldVerticesLength = Reflect.get(attachment, 'worldVerticesLength')
  if (typeof worldVerticesLength !== 'number' || worldVerticesLength < 2) return undefined
  const vertices = new Float32Array(worldVerticesLength)
  computeWorldVertices.call(attachment, slot, 0, worldVerticesLength, vertices, 0, 2)
  return vertices
}

function collectCharacterVariantBounds(
  spine: Spine,
  groups: ReadonlySet<CharacterVariantGroup>,
) {
  const skeleton = createPoseSkeleton(spine)
  skeleton.updateWorldTransform()
  const bounds = new Map<CharacterVariantGroup, CharacterVariantBounds>()

  for (const slot of skeleton.slots) {
    const group = characterVariantGroup(slot.data.name)
    if (!group || !groups.has(group)) continue
    const vertices = attachmentVertices(slot)
    if (!vertices) continue
    const current = bounds.get(group) ?? {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    }
    for (let index = 0; index < vertices.length; index += 2) {
      current.minX = Math.min(current.minX, vertices[index])
      current.minY = Math.min(current.minY, vertices[index + 1])
      current.maxX = Math.max(current.maxX, vertices[index])
      current.maxY = Math.max(current.maxY, vertices[index + 1])
    }
    bounds.set(group, current)
  }
  return bounds
}

function characterVariantOverlap(left: CharacterVariantBounds, right: CharacterVariantBounds) {
  const intersectionWidth = Math.max(0, Math.min(left.maxX, right.maxX) - Math.max(left.minX, right.minX))
  const intersectionHeight = Math.max(0, Math.min(left.maxY, right.maxY) - Math.max(left.minY, right.minY))
  const leftArea = Math.max(0, left.maxX - left.minX) * Math.max(0, left.maxY - left.minY)
  const rightArea = Math.max(0, right.maxX - right.minX) * Math.max(0, right.maxY - right.minY)
  const smallerArea = Math.min(leftArea, rightArea)
  return smallerArea > 0 ? intersectionWidth * intersectionHeight / smallerArea : 0
}

function largestOverlappingVariantGroup(
  groups: ReadonlySet<CharacterVariantGroup>,
  bounds: ReadonlyMap<CharacterVariantGroup, CharacterVariantBounds>,
  slotIndexes: ReadonlyMap<CharacterVariantGroup, ReadonlySet<number>>,
  boneCounts: ReadonlyMap<CharacterVariantGroup, number>,
) {
  const remaining = new Set(groups)
  const components: CharacterVariantGroup[][] = []
  while (remaining.size) {
    const first = remaining.values().next().value as CharacterVariantGroup
    const component: CharacterVariantGroup[] = []
    const queue = [first]
    remaining.delete(first)
    while (queue.length) {
      const group = queue.shift()!
      component.push(group)
      const groupBounds = bounds.get(group)
      if (!groupBounds) continue
      for (const candidate of [...remaining]) {
        const candidateBounds = bounds.get(candidate)
        const slotSizes = [slotIndexes.get(group)?.size ?? 0, slotIndexes.get(candidate)?.size ?? 0]
        const boneSizes = [boneCounts.get(group) ?? 0, boneCounts.get(candidate) ?? 0]
        const slotSimilarity = Math.min(...slotSizes) / Math.max(...slotSizes)
        const boneSimilarity = Math.min(...boneSizes) / Math.max(...boneSizes)
        if (!candidateBounds
          || characterVariantOverlap(groupBounds, candidateBounds) < 0.45
          || slotSimilarity < 0.45
          || boneSimilarity < 0.4) continue
        remaining.delete(candidate)
        queue.push(candidate)
      }
    }
    if (component.length >= 2) components.push(component)
  }
  return components.sort((left, right) => {
    const size = (component: CharacterVariantGroup[]) => component.reduce(
      (total, group) => total + (slotIndexes.get(group)?.size ?? 0),
      0,
    )
    return size(right) - size(left)
  })[0]
}

function collectCharacterVariantProfile(spine: Spine): CharacterVariantProfile | undefined {
  const slotIndexes = new Map<CharacterVariantGroup, Set<number>>()
  const boneCounts = new Map<CharacterVariantGroup, number>()
  for (const slot of spine.spineData.slots) {
    const group = characterVariantGroup(slot.name)
    if (!group) continue
    if (!slotIndexes.has(group)) slotIndexes.set(group, new Set())
    slotIndexes.get(group)!.add(slot.index)
  }
  for (const bone of spine.spineData.bones) {
    const group = characterVariantGroup(bone.name)
    if (group) boneCounts.set(group, (boneCounts.get(group) ?? 0) + 1)
  }

  const candidates = new Set(
    [...slotIndexes]
      .filter(([group, indexes]) => indexes.size >= 40 && (boneCounts.get(group) ?? 0) >= 60)
      .map(([group]) => group),
  )
  if (candidates.size < 2) return undefined

  const animationGroups = new Map<string, CharacterVariantGroup>()
  const motionGroups = new Set<CharacterVariantGroup>()
  for (const animation of spine.spineData.animations) {
    const boneGroup = animationBoneGroup(spine, animation, candidates)
    if (boneGroup) motionGroups.add(boneGroup)
    const group = boneGroup
      ?? animationNameGroup(animation.name, candidates)
      ?? animationSlotGroup(spine, animation, candidates)
    if (group) animationGroups.set(animation.name, group)
  }

  if (motionGroups.size < 2) return undefined

  const bounds = collectCharacterVariantBounds(spine, motionGroups)
  const overlappingGroups = largestOverlappingVariantGroup(motionGroups, bounds, slotIndexes, boneCounts)
  if (!overlappingGroups) return undefined
  const selectedGroups = new Set(overlappingGroups)
  const selectedSlotIndexes = new Map(
    [...slotIndexes].filter(([group]) => selectedGroups.has(group)),
  )
  const selectedAnimationGroups = new Map(
    [...animationGroups].filter(([, group]) => selectedGroups.has(group)),
  )

  const idle = spine.spineData.animations.find((item) => /(^|_)idle(?:_?\d+)?($|_)/i.test(item.name))
  const defaultGroup = (idle && selectedAnimationGroups.get(idle.name)) ?? overlappingGroups[0]
  return { animationGroups: selectedAnimationGroups, defaultGroup, slotIndexes: selectedSlotIndexes }
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

function applyLayerVisibility(
  instance: SpineInstance,
  hiddenLayerIds: ReadonlySet<string>,
  automaticHiddenSlotIndexes: ReadonlySet<number>,
) {
  for (let index = 0; index < instance.spine.slotContainers.length; index += 1) {
    const manuallyHidden = hiddenLayerIds.has(`${instance.id}::${index}`)
    const automaticallyHidden = instance.kind === 'main' && automaticHiddenSlotIndexes.has(index)
    instance.spine.slotContainers[index].renderable = !manuallyHidden && !automaticallyHidden
  }
}

function lockPostUpdate(
  instance: SpineInstance,
  hiddenLayerIdsRef: React.RefObject<ReadonlySet<string>>,
  automaticHiddenSlotIndexesRef: React.RefObject<ReadonlySet<number>>,
  requestedVisualStatesRef: React.RefObject<ReadonlySet<string>>,
  visualStateProfileRef: React.RefObject<VisualStateProfile | undefined>,
) {
  const originalUpdate = instance.spine.update.bind(instance.spine)
  instance.spine.update = (delta: number) => {
    originalUpdate(delta)
    if (instance.kind === 'main' && visualStateProfileRef.current) {
      applyVisualStates(
        instance.spine,
        requestedVisualStatesRef.current,
        visualStateProfileRef.current.snapshots,
      )
    }
    applyLayerVisibility(instance, hiddenLayerIdsRef.current, automaticHiddenSlotIndexesRef.current)
  }
}

function layerIdentity(layer: LoadedLayer) {
  if (layer.layer === 'back') return { id: `back:${layer.asset.id}`, label: layer.asset.title, kind: 'back' as const }
  if (layer.layer === 'front') return { id: `front:${layer.asset.id}`, label: layer.asset.title, kind: 'front' as const }
  return { id: `main:${layer.asset.id}`, label: layer.asset.title, kind: 'main' as const }
}

function destroyResources(resources: LoadedSpineAsset[]) {
  for (const resource of resources) resource.destroy()
}

export function SpineStage({
  asset,
  effects,
  animation,
  persistentAnimations,
  detectCharacterVariants,
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
  const { t } = useI18n()
  const hostRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const groupRef = useRef<Container | null>(null)
  const spineRef = useRef<Spine | null>(null)
  const spineLayersRef = useRef<Spine[]>([])
  const spineInstancesRef = useRef<SpineInstance[]>([])
  const playbackTrackIndexRef = useRef(0)
  const requestedVisualStatesRef = useRef<ReadonlySet<string>>(new Set(persistentAnimations))
  const visualStateProfileRef = useRef<VisualStateProfile | undefined>(undefined)
  const hiddenLayerIdsRef = useRef<ReadonlySet<string>>(new Set(hiddenLayerIds))
  const characterVariantProfileRef = useRef<CharacterVariantProfile | undefined>(undefined)
  const activeCharacterGroupRef = useRef<CharacterVariantGroup | undefined>(undefined)
  const automaticHiddenSlotIndexesRef = useRef<ReadonlySet<number>>(new Set())
  const loadedAssetsRef = useRef<LoadedSpineAsset[]>([])
  const boundsRef = useRef<Rectangle | undefined>(undefined)
  const offsetRef = useRef<ViewOffset>({ x: 0, y: 0 })
  const viewPropsRef = useRef({ zoom, flipped })
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const lastProgressRef = useRef(0)
  const tRef = useRef(t)
  const [rendererReady, setRendererReady] = useState(false)
  const effectKey = effects.map((effect) => `${effect.layer}:${effect.asset.id}`).join('|')
  const persistentAnimationKey = persistentAnimations.join('|')
  requestedVisualStatesRef.current = new Set(persistentAnimations)
  tRef.current = t

  const updateAutomaticCharacterVisibility = (requestedAnimation: string) => {
    const profile = characterVariantProfileRef.current
    if (!profile) {
      automaticHiddenSlotIndexesRef.current = new Set()
      activeCharacterGroupRef.current = undefined
      return
    }
    const nextGroup = profile.animationGroups.get(requestedAnimation)
      ?? activeCharacterGroupRef.current
      ?? profile.defaultGroup
    activeCharacterGroupRef.current = nextGroup
    const hiddenIndexes = new Set<number>()
    for (const [group, indexes] of profile.slotIndexes) {
      if (group === nextGroup) continue
      for (const index of indexes) hiddenIndexes.add(index)
    }
    automaticHiddenSlotIndexesRef.current = hiddenIndexes
  }

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
    playbackTrackIndexRef.current = 0
    visualStateProfileRef.current = undefined
    characterVariantProfileRef.current = undefined
    activeCharacterGroupRef.current = undefined
    automaticHiddenSlotIndexesRef.current = new Set()
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
      if (!candidate) throw new Error(tRef.current('load.missingSource', { source }))
      return loadSpineAsset(candidate.jsonUrl, candidate.atlasUrl, abortController.signal)
    }

    async function load() {
      onSourceChange('checking')
      onLoadState({
        kind: 'loading',
        message: effects.length
          ? tRef.current('load.combiningEffects', { count: effects.length })
          : tRef.current('load.local'),
      })
      onProgress(0, 0)
      onLayers([])
      clearStage(app)

      try {
        let layers: LoadedLayer[] | undefined
        let lastError: unknown

        for (const candidate of assetUrlCandidates(asset.jsonPath, asset.atlasPath)) {
          if (candidate.source === 'remote') {
            onLoadState({ kind: 'loading', message: tRef.current('load.remoteFallback') })
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

        if (!layers) throw lastError ?? new Error(tRef.current('load.noSource'))
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
          lockPostUpdate(
            instance,
            hiddenLayerIdsRef,
            automaticHiddenSlotIndexesRef,
            requestedVisualStatesRef,
            visualStateProfileRef,
          )
          const playback = applyAnimation(spine, animation, loop)
          applyLayerVisibility(instance, hiddenLayerIdsRef.current, automaticHiddenSlotIndexesRef.current)
          spine.state.timeScale = paused ? 0 : speed
          if (layer.layer === 'main') {
            mainSpine = spine
            playbackTrackIndexRef.current = playback.trackIndex
          }
          spineInstances.push(instance)
          group.addChild(spine)
        }

        if (!mainSpine) throw new Error(tRef.current('load.noMain'))
        visualStateProfileRef.current = collectVisualStateProfile(mainSpine)
        characterVariantProfileRef.current = detectCharacterVariants
          ? collectCharacterVariantProfile(mainSpine)
          : undefined
        activeCharacterGroupRef.current = undefined
        updateAutomaticCharacterVisibility(preferredAnimation(mainSpine, animation))
        mainSpine.update(0)
        for (const instance of spineInstances) {
          applyLayerVisibility(instance, hiddenLayerIdsRef.current, automaticHiddenSlotIndexesRef.current)
        }
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
        const stateGroups = visualStateProfileRef.current.groups.map((group) => group.metadata)
        onMetadata({
          animations,
          stateAnimations: stateGroups.map((group) => group.id),
          stateGroups,
          overlayAnimations: collectOverlayAnimations(mainSpine),
          variantGroups: [...(characterVariantProfileRef.current?.slotIndexes.keys() ?? [])]
            .sort((left, right) => left.localeCompare(right)),
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
          const entry = mainSpine.state.tracks[playbackTrackIndexRef.current]
            ?? mainSpine.state.tracks[0]
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
          message: `${tRef.current('load.failed')}\n${detail}`,
        })
      }
    }

    void load()
    return () => {
      cancelled = true
      abortController.abort()
      if (tickerHandler) app.ticker?.remove(tickerHandler)
    }
  }, [asset.id, effectKey, detectCharacterVariants, rendererReady, retryKey])

  useEffect(() => {
    const mainSpine = spineRef.current
    if (!mainSpine || !animation) return
    for (const spine of spineLayersRef.current) {
      const playback = applyAnimation(spine, animation, loop)
      if (spine === mainSpine) playbackTrackIndexRef.current = playback.trackIndex
    }
    updateAutomaticCharacterVisibility(preferredAnimation(mainSpine, animation))
    for (const instance of spineInstancesRef.current) {
      applyLayerVisibility(instance, hiddenLayerIdsRef.current, automaticHiddenSlotIndexesRef.current)
    }
    onLayers(collectLayerInfo(spineInstancesRef.current, animation))
    onProgress(0, mainSpine.spineData.findAnimation(preferredAnimation(mainSpine, animation))?.duration ?? 0)
  }, [animation, loop])

  useEffect(() => {
    const mainSpine = spineRef.current
    if (!mainSpine) return
    // Clearing a snapshot must restore slots that the currently playing
    // animation does not key. Otherwise the previous attachment, tint, mesh
    // deformation, or draw order can remain visible after selecting Default.
    mainSpine.skeleton.setSlotsToSetupPose()
    mainSpine.update(0)
    for (const instance of spineInstancesRef.current) {
      applyLayerVisibility(instance, hiddenLayerIdsRef.current, automaticHiddenSlotIndexesRef.current)
    }
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
    for (const instance of spineInstancesRef.current) {
      applyLayerVisibility(instance, hiddenLayerIdsRef.current, automaticHiddenSlotIndexesRef.current)
    }
    onLayers(collectLayerInfo(spineInstancesRef.current, animation))
  }, [skin])

  useEffect(() => {
    const nextHiddenLayerIds = new Set(hiddenLayerIds)
    hiddenLayerIdsRef.current = nextHiddenLayerIds
    for (const instance of spineInstancesRef.current) {
      applyLayerVisibility(instance, nextHiddenLayerIds, automaticHiddenSlotIndexesRef.current)
    }
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
