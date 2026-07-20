export type LibraryCategory = 'character' | 'cg'

export type VariantKind = 'default' | 'skin' | 'break' | 'synchro' | 'variant'

export type EffectLayer = 'back' | 'front'

export interface SpineAsset {
  id: string
  characterId: string
  title: string
  folder: string
  jsonPath: string
  atlasPath: string
  texturePaths: string[]
  bytes: number
  spineVersion: string
}

export interface SpineEffect {
  layer: EffectLayer
  asset: SpineAsset
}

export interface SpineVariant {
  id: string
  label: string
  kind: VariantKind
  main: SpineAsset
  effects: SpineEffect[]
  bytes: number
}

export interface LibraryEntry {
  id: string
  title: string
  category: LibraryCategory
  characterIds: string[]
  variants: SpineVariant[]
}

export interface AssetManifest {
  generatedAt: string
  source: string
  revision: string
  folderCount: number
  modelCount: number
  entryCount: number
  entries: LibraryEntry[]
}

export interface SpineMetadata {
  animations: string[]
  stateAnimations: string[]
  variantGroups: string[]
  skins: string[]
  slots: number
  bones: number
}

export type SpineLayerGroupKind = 'main' | 'back' | 'front'

export interface SpineLayerInfo {
  id: string
  name: string
  attachment: string
  groupId: string
  groupLabel: string
  groupKind: SpineLayerGroupKind
  slotIndex: number
}

export type AssetSource = 'checking' | 'local' | 'remote'

export type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading'; message: string }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }
