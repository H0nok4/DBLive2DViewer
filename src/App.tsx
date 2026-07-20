import { useEffect, useMemo, useRef, useState } from 'react'
import manifestJson from './data/assets.generated.json'
import { Icon } from './components/Icon'
import { LayerPanel } from './components/LayerPanel'
import { SpineStage } from './components/SpineStage'
import { formatBytes } from './lib/asset-url'
import type {
  AssetManifest,
  AssetSource,
  LibraryCategory,
  LibraryEntry,
  LoadState,
  SpineLayerInfo,
  SpineMetadata,
  SpineVariant,
} from './types'

const manifest = manifestJson as AssetManifest
const categoryLabels: Record<LibraryCategory, string> = {
  character: '角色',
  cg: 'CG',
}

const stageBackgrounds = [
  { id: 'grid', label: '网格' },
  { id: 'dusk', label: '暮色' },
  { id: 'paper', label: '明亮' },
] as const

const sourceLabels: Record<AssetSource, string> = {
  checking: 'CHECKING',
  local: 'LOCAL DISK',
  remote: 'REMOTE',
}

function firstVariant(entry: LibraryEntry) {
  return entry.variants[0]
}

function readInitialSelection() {
  const requested = new URLSearchParams(window.location.search).get('model')
  for (const entry of manifest.entries) {
    const variant = entry.variants.find((item) => item.main.id === requested || item.effects.some((effect) => effect.asset.id === requested))
    if (variant) return { entry, variant }
  }

  const fallbackEntry = manifest.entries.find((entry) => entry.id === 'character:alps') ?? manifest.entries[0]
  return { entry: fallbackEntry, variant: firstVariant(fallbackEntry) }
}

const initialSelection = readInitialSelection()

function formatTime(value: number) {
  if (!Number.isFinite(value)) return '0:00.0'
  const minutes = Math.floor(value / 60)
  return `${minutes}:${(value % 60).toFixed(1).padStart(4, '0')}`
}

function variantOptionLabel(variant: SpineVariant) {
  const effectLabel = variant.effects.length ? ` · ${variant.effects.length} 个效果层` : ''
  return `${variant.label}${effectLabel}`
}

function isIdleAnimation(name: string) {
  return /(^|_)idle(?:_?\d+)?($|_)/i.test(name)
}

function App() {
  const initialParams = new URLSearchParams(window.location.search)
  const [selectedEntryId, setSelectedEntryId] = useState(initialSelection.entry.id)
  const [selectedVariantId, setSelectedVariantId] = useState(initialSelection.variant.id)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<LibraryCategory>(initialSelection.entry.category)
  const [animation, setAnimation] = useState(initialParams.get('animation') ?? '')
  const [persistentAnimations, setPersistentAnimations] = useState<Set<string>>(
    () => new Set((initialParams.get('states') ?? '').split(',').filter(Boolean)),
  )
  const [skeletonSkin, setSkeletonSkin] = useState('default')
  const [metadata, setMetadata] = useState<SpineMetadata>({ animations: [], stateAnimations: [], skins: [], slots: 0, bones: 0 })
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'idle' })
  const [assetSource, setAssetSource] = useState<AssetSource>('checking')
  const [paused, setPaused] = useState(false)
  const [loop, setLoop] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [flipped, setFlipped] = useState(false)
  const [debug, setDebug] = useState(false)
  const [background, setBackground] = useState<(typeof stageBackgrounds)[number]['id']>('grid')
  const [progress, setProgress] = useState({ current: 0, duration: 0 })
  const [retryKey, setRetryKey] = useState(0)
  const [resetViewKey, setResetViewKey] = useState(0)
  const [copied, setCopied] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<'controls' | 'layers'>('controls')
  const [layers, setLayers] = useState<SpineLayerInfo[]>([])
  const [hiddenLayerIds, setHiddenLayerIds] = useState<Set<string>>(() => new Set())
  const stageRef = useRef<HTMLElement>(null)

  const selectedEntry = manifest.entries.find((entry) => entry.id === selectedEntryId) ?? manifest.entries[0]
  const selectedVariant = selectedEntry.variants.find((variant) => variant.id === selectedVariantId) ?? firstVariant(selectedEntry)
  const persistentAnimationList = useMemo(() => [...persistentAnimations].sort(), [persistentAnimations])
  const persistentAnimationKey = persistentAnimationList.join(',')

  const filteredEntries = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return manifest.entries.filter((entry) => {
      if (entry.category !== category) return false
      const variantText = entry.variants.map((variant) => `${variant.label} ${variant.main.title} ${variant.main.folder}`).join(' ')
      const haystack = `${entry.title} ${entry.characterIds.join(' ')} ${variantText}`.toLowerCase().replaceAll('_', ' ')
      return terms.every((term) => haystack.includes(term))
    })
  }, [category, query])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    params.set('model', selectedVariant.main.id)
    if (animation) params.set('animation', animation)
    else params.delete('animation')
    if (persistentAnimationKey) params.set('states', persistentAnimationKey)
    else params.delete('states')
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)
  }, [selectedVariant.main.id, animation, persistentAnimationKey])

  const resetPlayback = () => {
    setAnimation('')
    setMetadata({ animations: [], stateAnimations: [], skins: [], slots: 0, bones: 0 })
    setPersistentAnimations(new Set())
    setSkeletonSkin('default')
    setPaused(false)
    setProgress({ current: 0, duration: 0 })
    setLayers([])
    setHiddenLayerIds(new Set())
  }

  const handleMetadata = (next: SpineMetadata) => {
    setMetadata(next)
    setPersistentAnimations((current) => new Set([...current].filter((name) => next.stateAnimations.includes(name))))
    setAnimation((current) => {
      if (current && next.animations.includes(current)) return current
      return next.animations.find(isIdleAnimation) ?? next.animations[0] ?? ''
    })
    setSkeletonSkin((current) => next.skins.includes(current) ? current : next.skins[0] ?? 'default')
  }

  const playAnimation = (name: string) => {
    setAnimation(name)
    setPaused(false)
    if (!metadata.stateAnimations.includes(name)) return
    setPersistentAnimations((current) => {
      if (current.has(name)) return current
      const next = new Set(current)
      next.add(name)
      return next
    })
  }

  const togglePersistentAnimation = (name: string) => {
    const removing = persistentAnimations.has(name)
    if (removing && animation === name) {
      const fallback = metadata.animations.find((candidate) =>
        !metadata.stateAnimations.includes(candidate) && isIdleAnimation(candidate),
      ) ?? metadata.animations.find((candidate) => !metadata.stateAnimations.includes(candidate)) ?? ''
      setAnimation(fallback)
      setPaused(false)
    }
    setPersistentAnimations((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const selectEntry = (entry: LibraryEntry) => {
    setSelectedEntryId(entry.id)
    setSelectedVariantId(firstVariant(entry).id)
    resetPlayback()
    setLibraryOpen(false)
  }

  const selectVariant = (variantId: string) => {
    setSelectedVariantId(variantId)
    resetPlayback()
  }

  const resetView = () => {
    setZoom(1)
    setFlipped(false)
    setResetViewKey((key) => key + 1)
  }

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await stageRef.current?.requestFullscreen()
  }

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  const toggleLayer = (id: string) => {
    setHiddenLayerIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const setLayerVisibility = (ids: string[], visible: boolean) => {
    setHiddenLayerIds((current) => {
      const next = new Set(current)
      for (const id of ids) {
        if (visible) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  const progressPercent = progress.duration > 0 ? (progress.current / progress.duration) * 100 : 0
  const hiddenLayerIdList = useMemo(() => [...hiddenLayerIds], [hiddenLayerIds])
  const characterCount = manifest.entries.filter((entry) => entry.category === 'character').length
  const cgCount = manifest.entries.filter((entry) => entry.category === 'cg').length

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <button className="mobile-icon" onClick={() => setLibraryOpen(true)} aria-label="打开素材库">
            <Icon name="menu" />
          </button>
          <div className="brand-mark" aria-hidden="true"><span/><span/><span/><span/></div>
          <div>
            <div className="brand-kicker">DAIBLOS CORE · ASSET LAB</div>
            <h1>Spine Observatory</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="runtime-pill"><i /> Spine 3.8.99</span>
          <span className={`source-status source-${assetSource}`}><i />{sourceLabels[assetSource]}</span>
          <span className="asset-count">{characterCount} 个角色 · {cgCount} 个 CG</span>
          <a className="icon-button source-link" href={manifest.source} target="_blank" rel="noreferrer" aria-label="查看素材仓库">
            <Icon name="github" />
          </a>
          <button className="mobile-icon" onClick={() => setInspectorOpen(true)} aria-label="打开控制面板">
            <Icon name="layers" />
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className={`library-panel ${libraryOpen ? 'is-open' : ''}`}>
          <div className="panel-heading mobile-panel-heading">
            <div><span className="eyebrow">ARCHIVE</span><h2>素材库</h2></div>
            <button className="icon-button" onClick={() => setLibraryOpen(false)} aria-label="关闭素材库"><Icon name="close" /></button>
          </div>

          <div className="library-controls">
            <label className="search-field">
              <Icon name="search" size={17} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索角色、CG 或编号…" />
              {query && <button onClick={() => setQuery('')} aria-label="清空搜索"><Icon name="close" size={14} /></button>}
            </label>
            <div className="category-tabs" aria-label="素材分类">
              {(['character', 'cg'] as const).map((item) => (
                <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>
                  {categoryLabels[item]}
                </button>
              ))}
            </div>
          </div>

          <div className="result-caption">
            <span>{filteredEntries.length.toString().padStart(3, '0')} RESULTS</span>
            <span>{categoryLabels[category]}</span>
          </div>

          <div className="asset-list">
            {filteredEntries.map((entry, index) => (
              <button
                key={entry.id}
                className={`asset-row ${selectedEntry.id === entry.id ? 'selected' : ''}`}
                onClick={() => selectEntry(entry)}
              >
                <span className="asset-index">{String(index + 1).padStart(3, '0')}</span>
                <span className="asset-main">
                  <strong>{entry.title}</strong>
                  <small>{entry.category === 'character' ? `${entry.characterIds.join(' / ') || 'NO ID'} · ${entry.variants.length} 个皮肤` : `${entry.variants.length} 个画面`}</small>
                </span>
                <span className={`type-mark type-${entry.category}`}>{categoryLabels[entry.category]}</span>
                <Icon name="chevron" size={15} />
              </button>
            ))}
            {!filteredEntries.length && (
              <div className="empty-state"><span>∅</span><p>没有匹配的资源</p><button onClick={() => setQuery('')}>清除搜索</button></div>
            )}
          </div>
        </aside>

        <section ref={stageRef} className={`stage background-${background}`}>
          <div className="stage-grid" />
          <div className="stage-glow" />
          <div className="stage-heading">
            <div>
              <span className="eyebrow">NOW OBSERVING</span>
              <h2>{selectedEntry.title}</h2>
              <p>{selectedVariant.label} · {selectedVariant.main.folder}</p>
            </div>
            <div className="stage-utilities">
              <div className="stage-badges">
                <span>{formatBytes(selectedVariant.bytes)}</span>
                {selectedVariant.effects.length > 0 && <span>{selectedVariant.effects.length} EFFECT LAYERS</span>}
                <span>{metadata.bones || '—'} BONES</span>
                <span>{metadata.slots || '—'} SLOTS</span>
              </div>
              <div className="background-tabs" aria-label="舞台背景">
                {stageBackgrounds.map((item) => (
                  <button key={item.id} className={background === item.id ? 'active' : ''} onClick={() => setBackground(item.id)}>{item.label}</button>
                ))}
              </div>
            </div>
          </div>

          <SpineStage
            asset={selectedVariant.main}
            effects={selectedVariant.effects}
            animation={animation}
            persistentAnimations={persistentAnimationList}
            skin={skeletonSkin}
            loop={loop}
            paused={paused}
            speed={speed}
            zoom={zoom}
            flipped={flipped}
            debug={debug}
            retryKey={retryKey}
            resetViewKey={resetViewKey}
            hiddenLayerIds={hiddenLayerIdList}
            onLoadState={setLoadState}
            onSourceChange={setAssetSource}
            onMetadata={handleMetadata}
            onLayers={setLayers}
            onProgress={(current, duration) => setProgress({ current, duration })}
            onZoomChange={setZoom}
          />

          {loadState.kind === 'loading' && (
            <div className="load-overlay">
              <div className="loader-orbit"><i/><i/><i/></div>
              <strong>ASSEMBLING RIG</strong>
              <span>{loadState.message}</span>
            </div>
          )}
          {loadState.kind === 'error' && (
            <div className="load-overlay error-overlay">
              <b>!</b><strong>LOAD INTERRUPTED</strong>
              <span>{loadState.message.split('\n')[0]}</span>
              <button onClick={() => setRetryKey((key) => key + 1)}><Icon name="refresh" size={16}/> 重试加载</button>
            </div>
          )}

          <div className="stage-toolbar">
            <button className="primary-play" onClick={() => setPaused((value) => !value)} aria-label={paused ? '播放' : '暂停'}>
              <Icon name={paused ? 'play' : 'pause'} />
            </button>
            <button onClick={resetView} title="重置视图"><Icon name="refresh" /></button>
            <button className={flipped ? 'active' : ''} onClick={() => setFlipped((value) => !value)} title="水平翻转"><Icon name="flip" /></button>
            <button className={debug ? 'active' : ''} onClick={() => setDebug((value) => !value)} title="骨骼调试"><Icon name="layers" /></button>
            <span className="toolbar-separator" />
            <label className="zoom-control">
              <span>ZOOM</span>
              <input type="range" min="0.2" max="2.4" step="0.02" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
              <output>{Math.round(zoom * 100)}%</output>
            </label>
            <span className="toolbar-separator" />
            <button onClick={copyLink} title="复制当前视图链接"><Icon name={copied ? 'check' : 'copy'} /></button>
            <button onClick={toggleFullscreen} title="全屏"><Icon name="maximize" /></button>
          </div>

          <div className="stage-hint">拖拽移动 · 滚轮缩放</div>
        </section>

        <aside className={`inspector-panel ${inspectorOpen ? 'is-open' : ''}`}>
          <div className="panel-heading">
            <div><span className="eyebrow">CONTROL DECK</span><h2>{inspectorTab === 'controls' ? '动画控制台' : '图层控制台'}</h2></div>
            <button className="icon-button mobile-close" onClick={() => setInspectorOpen(false)} aria-label="关闭控制面板"><Icon name="close" /></button>
          </div>

          <div className="inspector-tabs" role="tablist" aria-label="控制台模式">
            <button role="tab" aria-selected={inspectorTab === 'controls'} className={inspectorTab === 'controls' ? 'active' : ''} onClick={() => setInspectorTab('controls')}>
              <Icon name="play" size={13} />动画
            </button>
            <button role="tab" aria-selected={inspectorTab === 'layers'} className={inspectorTab === 'layers' ? 'active' : ''} onClick={() => setInspectorTab('layers')}>
              <Icon name="layers" size={14} />图层<span>{layers.length}</span>
            </button>
          </div>

          {inspectorTab === 'controls' && (
            <div className="inspector-scroll" role="tabpanel" aria-label="动画控制">
              <section className="control-section timeline-section">
                <div className="section-title"><span>01</span><h3>播放进度</h3><output>{formatTime(progress.current)} / {formatTime(progress.duration)}</output></div>
                <div className="timeline-track"><i style={{ width: `${progressPercent}%` }} /><b style={{ left: `${progressPercent}%` }} /></div>
                <div className="transport-row">
                  <button onClick={() => setPaused((value) => !value)}><Icon name={paused ? 'play' : 'pause'} /> {paused ? '继续' : '暂停'}</button>
                  <label className="switch-label">循环 <input type="checkbox" checked={loop} onChange={(event) => setLoop(event.target.checked)} /><span /></label>
                </div>
              </section>

              <section className="control-section">
                <div className="section-title"><span>02</span><h3>动画片段</h3><output>{metadata.animations.length}</output></div>
                <div className="animation-list">
                  {metadata.animations.map((name, index) => {
                    const isStateAnimation = metadata.stateAnimations.includes(name)
                    const isPersistent = persistentAnimations.has(name)
                    return (
                      <div key={name} className={`animation-row ${animation === name ? 'selected' : ''} ${isPersistent ? 'is-persistent' : ''}`}>
                        <button className="animation-play" onClick={() => playAnimation(name)}>
                          <span>{String(index + 1).padStart(2, '0')}</span><strong>{name}</strong>
                          {animation === name && <i>PLAYING</i>}
                        </button>
                        {isStateAnimation && (
                          <button
                            className="state-toggle"
                            aria-pressed={isPersistent}
                            title={isPersistent ? '取消状态叠加并恢复原始形态' : '保持这个服装或颜色状态，并叠加到其他动画'}
                            onClick={() => togglePersistentAnimation(name)}
                          >
                            {isPersistent ? '已保持' : '保持'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                  {loadState.kind === 'loading' && <div className="control-skeleton"><i/><i/><i/></div>}
                </div>
                {metadata.stateAnimations.length > 0 && (
                  <p className="state-animation-hint"><i />检测到 {metadata.stateAnimations.length} 个服装/颜色状态；点击动画会自动保持，可继续叠加其他动作。</p>
                )}
              </section>

              <section className="control-section variant-section">
                <div className="section-title"><span>03</span><h3>{selectedEntry.category === 'character' ? '角色皮肤' : 'CG 画面'}</h3><output>{selectedEntry.variants.length}</output></div>
                <select value={selectedVariant.id} onChange={(event) => selectVariant(event.target.value)}>
                  {selectedEntry.variants.map((variant) => <option key={variant.id} value={variant.id}>{variantOptionLabel(variant)}</option>)}
                </select>
                {selectedVariant.effects.length > 0 && (
                  <p className="variant-meta"><i />已合并 {selectedVariant.effects.length} 个 Effect 背景层</p>
                )}
                {metadata.skins.length > 1 && (
                  <label className="skeleton-skin-field">
                    <span>骨架内置皮肤</span>
                    <select value={skeletonSkin} onChange={(event) => setSkeletonSkin(event.target.value)}>
                      {metadata.skins.map((name) => <option key={name}>{name}</option>)}
                    </select>
                  </label>
                )}
              </section>

              <section className="control-section speed-section">
                <div className="section-title"><span>04</span><h3>播放速率</h3><output>{speed.toFixed(2)}×</output></div>
                <input type="range" min="0.1" max="2" step="0.05" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} />
                <div className="speed-presets">
                  {[0.5, 1, 1.5, 2].map((value) => <button key={value} className={speed === value ? 'active' : ''} onClick={() => setSpeed(value)}>{value}×</button>)}
                </div>
              </section>

              <section className="source-card">
                <div><span>ORIGIN</span><strong>DaiblosCoreAssets</strong><small>@ {manifest.revision.slice(0, 7)}</small></div>
                <a href={`${manifest.source}/tree/main/spine/${selectedVariant.main.folder}`} target="_blank" rel="noreferrer" aria-label="打开当前素材目录"><Icon name="external" /></a>
              </section>
            </div>
          )}

          {inspectorTab === 'layers' && (
            <LayerPanel
              layers={layers}
              hiddenLayerIds={hiddenLayerIds}
              loading={loadState.kind === 'loading'}
              onToggle={toggleLayer}
              onSetVisibility={setLayerVisibility}
            />
          )}
        </aside>
      </main>

      {(libraryOpen || inspectorOpen) && <button className="mobile-scrim" onClick={() => { setLibraryOpen(false); setInspectorOpen(false) }} aria-label="关闭面板" />}
    </div>
  )
}

export default App
