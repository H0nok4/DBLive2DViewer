import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Locale = 'en' | 'zh'

const en = {
  'site.title': 'Daiblos Spine Observatory',
  'site.description': 'A browser-based Spine 3.8 asset viewer for DaiblosCoreAssets.',
  'language.selector': 'Language',
  'category.character': 'Characters',
  'category.cg': 'CG',
  'background.label': 'Stage background',
  'background.grid': 'Grid',
  'background.dusk': 'Dusk',
  'background.paper': 'Light',
  'common.effectLayer': '1 effect layer',
  'common.effectLayers': '{count} effect layers',
  'common.bones': 'BONES',
  'common.slots': 'SLOTS',
  'top.openLibrary': 'Open asset library',
  'top.assetCount': '{characters} characters · {cg} CG',
  'top.openRepository': 'View asset repository',
  'top.openInspector': 'Open control panel',
  'library.title': 'Asset Library',
  'library.close': 'Close asset library',
  'library.search': 'Search characters, CG, or IDs…',
  'library.clearSearch': 'Clear search',
  'library.category': 'Asset category',
  'library.results': 'RESULTS',
  'library.skin': '1 skin',
  'library.skins': '{count} skins',
  'library.scene': '1 scene',
  'library.scenes': '{count} scenes',
  'library.empty': 'No matching assets',
  'stage.nowObserving': 'NOW OBSERVING',
  'stage.assembling': 'ASSEMBLING RIG',
  'stage.interrupted': 'LOAD INTERRUPTED',
  'stage.retry': 'Retry',
  'toolbar.play': 'Play',
  'toolbar.pause': 'Pause',
  'toolbar.reset': 'Reset view',
  'toolbar.flip': 'Flip horizontally',
  'toolbar.debug': 'Skeleton debug view',
  'toolbar.copy': 'Copy a link to this view',
  'toolbar.copied': 'Link copied',
  'toolbar.fullscreen': 'Fullscreen',
  'toolbar.hint': 'Drag to move · Scroll to zoom',
  'inspector.controlTitle': 'Animation Console',
  'inspector.layerTitle': 'Layer Console',
  'inspector.close': 'Close control panel',
  'inspector.mode': 'Console mode',
  'inspector.animations': 'Animations',
  'inspector.layers': 'Layers',
  'inspector.animationControl': 'Animation controls',
  'control.progress': 'Playback Progress',
  'control.resume': 'Resume',
  'control.pause': 'Pause',
  'control.loop': 'Loop',
  'control.animationsAndStates': 'Animations & States',
  'control.stateSettings': 'State Settings',
  'control.directSnapshot': 'Apply snapshots directly',
  'control.default': 'Default',
  'control.stateAria': '{name} state',
  'control.stateTooltip': 'Stable visual state sampled near {time}s in {animation}',
  'control.stateOption': 'State {index}',
  'control.actionClips': 'Action Clips',
  'control.overlayPlaying': 'OVERLAY PLAYING',
  'control.overlay': 'OVERLAY',
  'control.extractedState': 'A stable snapshot was extracted from 1 animation; fades, fully hidden transitions, and ending reset frames are excluded.',
  'control.extractedStates': 'Stable snapshots were extracted from {count} animations; fades, fully hidden transitions, and ending reset frames are excluded.',
  'control.overlayHint': 'Overlay actions retain the underlying Idle pose, preventing unkeyed bones from freezing or alternate attachments from appearing together.',
  'control.variantHint': 'Detected {names} as {count} overlapping character forms; inactive forms are hidden automatically during playback.',
  'control.characterSkins': 'Character Skins',
  'control.cgScenes': 'CG Scenes',
  'control.mergedEffect': 'Merged 1 Effect background layer',
  'control.mergedEffects': 'Merged {count} Effect background layers',
  'control.skeletonSkin': 'Built-in Skeleton Skin',
  'control.speed': 'Playback Speed',
  'control.openAssetFolder': 'Open current asset folder',
  'control.closePanel': 'Close panel',
  'layer.control': 'Layer controls',
  'layer.visible': ' / {count} visible',
  'layer.animationLocked': 'Synced with animation',
  'layer.search': 'Filter slots or attachments…',
  'layer.filter': 'Filter layers',
  'layer.clearFilter': 'Clear layer filter',
  'layer.showAll': 'Show all',
  'layer.hideAll': 'Hide all',
  'layer.filterOne': '1 layer matched',
  'layer.filterCount': '{count} layers matched',
  'layer.showGroup': 'Show group',
  'layer.hideGroup': 'Hide group',
  'layer.loading': 'Reading layers from the current animation…',
  'layer.noMatches': 'No matching layers',
  'layer.noLayers': 'This animation has no switchable layers',
  'layer.tryOther': 'Try another slot or attachment name',
  'layer.excluded': 'Clipping masks and non-rendering slots are excluded automatically',
  'layer.groupBack': 'Background Effect · {name}',
  'layer.groupFront': 'Foreground Effect · {name}',
  'layer.groupMain': 'Main Skeleton · {name}',
  'load.missingSource': 'Missing {source} asset URL',
  'load.combiningEffects': 'Combining the character with {count} Effect layers…',
  'load.local': 'Reading skeleton and textures from the local asset library…',
  'load.remoteFallback': 'Local assets are unavailable. Switching to the remote fallback…',
  'load.noSource': 'No asset source is available',
  'load.noMain': 'The main skeleton could not be loaded',
  'load.failed': 'The model failed to load. Check the local assets or try again later.',
} as const

export type MessageKey = keyof typeof en
export type TranslationValues = Record<string, string | number>
export type Translator = (key: MessageKey, values?: TranslationValues) => string

const zh: Record<MessageKey, string> = {
  'site.title': 'Daiblos Spine Observatory',
  'site.description': 'DaiblosCoreAssets 的 Spine 3.8 动画资源在线预览器。',
  'language.selector': '语言',
  'category.character': '角色',
  'category.cg': 'CG',
  'background.label': '舞台背景',
  'background.grid': '网格',
  'background.dusk': '暮色',
  'background.paper': '明亮',
  'common.effectLayer': '1 个效果层',
  'common.effectLayers': '{count} 个效果层',
  'common.bones': 'BONES',
  'common.slots': 'SLOTS',
  'top.openLibrary': '打开素材库',
  'top.assetCount': '{characters} 个角色 · {cg} 个 CG',
  'top.openRepository': '查看素材仓库',
  'top.openInspector': '打开控制面板',
  'library.title': '素材库',
  'library.close': '关闭素材库',
  'library.search': '搜索角色、CG 或编号…',
  'library.clearSearch': '清空搜索',
  'library.category': '素材分类',
  'library.results': 'RESULTS',
  'library.skin': '1 个皮肤',
  'library.skins': '{count} 个皮肤',
  'library.scene': '1 个画面',
  'library.scenes': '{count} 个画面',
  'library.empty': '没有匹配的资源',
  'stage.nowObserving': 'NOW OBSERVING',
  'stage.assembling': 'ASSEMBLING RIG',
  'stage.interrupted': 'LOAD INTERRUPTED',
  'stage.retry': '重试加载',
  'toolbar.play': '播放',
  'toolbar.pause': '暂停',
  'toolbar.reset': '重置视图',
  'toolbar.flip': '水平翻转',
  'toolbar.debug': '骨骼调试',
  'toolbar.copy': '复制当前视图链接',
  'toolbar.copied': '链接已复制',
  'toolbar.fullscreen': '全屏',
  'toolbar.hint': '拖拽移动 · 滚轮缩放',
  'inspector.controlTitle': '动画控制台',
  'inspector.layerTitle': '图层控制台',
  'inspector.close': '关闭控制面板',
  'inspector.mode': '控制台模式',
  'inspector.animations': '动画',
  'inspector.layers': '图层',
  'inspector.animationControl': '动画控制',
  'control.progress': '播放进度',
  'control.resume': '继续',
  'control.pause': '暂停',
  'control.loop': '循环',
  'control.animationsAndStates': '动画与状态',
  'control.stateSettings': '状态设置',
  'control.directSnapshot': '直接应用静态快照',
  'control.default': '默认',
  'control.stateAria': '{name} 状态',
  'control.stateTooltip': '取自动画 {animation} 在 {time} 秒附近的稳定视觉状态',
  'control.stateOption': '状态 {index}',
  'control.actionClips': '动作片段',
  'control.overlayPlaying': '叠加播放',
  'control.overlay': '叠加',
  'control.extractedState': '已从 1 段动画中提取稳定快照；渐变、全隐藏过渡与结尾复原帧不会作为状态。',
  'control.extractedStates': '已从 {count} 段动画中提取稳定快照；渐变、全隐藏过渡与结尾复原帧不会作为状态。',
  'control.overlayHint': '标记“叠加”的局部动作会保留 Idle 底层，避免未控制的骨骼静止或备用附件同时出现。',
  'control.variantHint': '已识别 {names} 共 {count} 套重叠人物形态；播放动作时自动隐藏非活动形态。',
  'control.characterSkins': '角色皮肤',
  'control.cgScenes': 'CG 画面',
  'control.mergedEffect': '已合并 1 个 Effect 背景层',
  'control.mergedEffects': '已合并 {count} 个 Effect 背景层',
  'control.skeletonSkin': '骨架内置皮肤',
  'control.speed': '播放速率',
  'control.openAssetFolder': '打开当前素材目录',
  'control.closePanel': '关闭面板',
  'layer.control': '图层控制',
  'layer.visible': ' / {count} 可见',
  'layer.animationLocked': '随动画锁定',
  'layer.search': '筛选 slot 或 attachment…',
  'layer.filter': '筛选图层',
  'layer.clearFilter': '清空图层筛选',
  'layer.showAll': '全部显示',
  'layer.hideAll': '全部隐藏',
  'layer.filterOne': '筛选到 1 个图层',
  'layer.filterCount': '筛选到 {count} 个图层',
  'layer.showGroup': '显示组',
  'layer.hideGroup': '隐藏组',
  'layer.loading': '正在读取当前动画图层…',
  'layer.noMatches': '没有匹配的图层',
  'layer.noLayers': '当前动画没有可切换图层',
  'layer.tryOther': '尝试其他 slot 或 attachment 名称',
  'layer.excluded': '裁剪蒙版和非渲染 slot 已自动排除',
  'layer.groupBack': '背景 Effect · {name}',
  'layer.groupFront': '前景 Effect · {name}',
  'layer.groupMain': '主骨架 · {name}',
  'load.missingSource': '缺少 {source} 素材地址',
  'load.combiningEffects': '正在组合角色与 {count} 个 Effect 图层…',
  'load.local': '正在从本地素材库读取骨架与纹理…',
  'load.remoteFallback': '本地素材不可用，正在切换远程备用源…',
  'load.noSource': '没有可用的素材源',
  'load.noMain': '角色主骨架未能加载',
  'load.failed': '模型加载失败。请检查本地素材或稍后重试。',
}

const dictionaries: Record<Locale, Record<MessageKey, string>> = { en, zh }
const storageKey = 'daiblos-spine-observatory.locale'

function initialLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(storageKey)
    if (stored === 'en' || stored === 'zh') return stored
  } catch {
    // Storage can be disabled in private or embedded browsing contexts.
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: Translator
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale)
  const t = useCallback<Translator>((key, values) => {
    const template = dictionaries[locale][key]
    if (!values) return template
    return template.replace(/\{(\w+)\}/g, (match, name: string) => (
      Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
    ))
  }, [locale])

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, locale)
    } catch {
      // The UI still works when storage is unavailable.
    }
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
    document.title = t('site.title')
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute('content', t('site.description'))
  }, [locale, t])

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used inside I18nProvider')
  return context
}

export function localizeVariantLabel(label: string, locale: Locale) {
  if (locale === 'zh') return label
  return label
    .replace(/^默认(?=\b|\s|·|$)/, 'Default')
    .replace(/^皮肤(?=\s|·|\d|$)/, 'Skin')
    .replace(/^突破(?=\s|·|\d|$)/, 'Breakthrough')
    .replace(/^半身(?=\s|·|\d|$)/, 'Half-body')
    .replace(/^同步形态(?=\s|·|\d|$)/, 'Synced Form')
    .replace(/^CG 主画面(?=\s|·|\d|$)/, 'CG Main Scene')
}
