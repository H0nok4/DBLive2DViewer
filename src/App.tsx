import { useEffect, useMemo, useRef, useState } from 'react'
import manifestJson from './data/assets.generated.json'
import { Icon } from './components/Icon'
import { LayerPanel } from './components/LayerPanel'
import { SpineStage } from './components/SpineStage'
import { localizeVariantLabel, useI18n, type Locale, type Translator } from './i18n'
import { formatBytes } from './lib/asset-url'
import { MAX_ZOOM, MIN_ZOOM } from './lib/view-settings'
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
const stageBackgroundIds = ['grid', 'dusk', 'paper'] as const

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

function variantOptionLabel(variant: SpineVariant, locale: Locale, t: Translator) {
  const effectLabel = variant.effects.length
    ? ` · ${t(variant.effects.length === 1 ? 'common.effectLayer' : 'common.effectLayers', { count: variant.effects.length })}`
    : ''
  return `${localizeVariantLabel(variant.label, locale)}${effectLabel}`
}

function isIdleAnimation(name: string) {
  return /(^|_)idle(?:_?\d+)?($|_)/i.test(name)
}

function App() {
  const { locale, setLocale, t } = useI18n()
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
  const [metadata, setMetadata] = useState<SpineMetadata>({ animations: [], stateAnimations: [], stateGroups: [], overlayAnimations: [], variantGroups: [], skins: [], slots: 0, bones: 0 })
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'idle' })
  const [assetSource, setAssetSource] = useState<AssetSource>('checking')
  const [paused, setPaused] = useState(false)
  const [loop, setLoop] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [flipped, setFlipped] = useState(false)
  const [debug, setDebug] = useState(false)
  const [background, setBackground] = useState<(typeof stageBackgroundIds)[number]>('grid')
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
  const motionAnimations = useMemo(
    () => metadata.animations.filter((name) => !metadata.stateAnimations.includes(name)),
    [metadata.animations, metadata.stateAnimations],
  )
  const categoryLabels: Record<LibraryCategory, string> = {
    character: t('category.character'),
    cg: t('category.cg'),
  }
  const stageBackgrounds = stageBackgroundIds.map((id) => ({ id, label: t(`background.${id}`) }))

  const filteredEntries = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return manifest.entries.filter((entry) => {
      if (entry.category !== category) return false
      const variantText = entry.variants.map((variant) => `${variant.label} ${localizeVariantLabel(variant.label, 'en')} ${variant.main.title} ${variant.main.folder}`).join(' ')
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

  useEffect(() => {
    if (!animation || !metadata.stateAnimations.includes(animation)) return
    const group = metadata.stateGroups.find((candidate) => candidate.id === animation)
    const stateId = group?.options[0]?.id
    setPersistentAnimations((current) => {
      if (!stateId || current.has(stateId)) return current
      const next = new Set(current)
      next.add(stateId)
      return next
    })
    setAnimation(
      motionAnimations.find(isIdleAnimation)
      ?? motionAnimations[0]
      ?? '',
    )
    setPaused(false)
  }, [animation, metadata.stateAnimations, metadata.stateGroups, motionAnimations])

  const resetPlayback = () => {
    setAnimation('')
    setMetadata({ animations: [], stateAnimations: [], stateGroups: [], overlayAnimations: [], variantGroups: [], skins: [], slots: 0, bones: 0 })
    setPersistentAnimations(new Set())
    setSkeletonSkin('default')
    setPaused(false)
    setProgress({ current: 0, duration: 0 })
    setLayers([])
    setHiddenLayerIds(new Set())
  }

  const handleMetadata = (next: SpineMetadata) => {
    setMetadata(next)
    setPersistentAnimations((current) => {
      const selected = new Set<string>()
      const selectedGroups = new Set<string>()
      for (const group of next.stateGroups) {
        const option = group.options.find((candidate) => current.has(candidate.id))
          ?? (current.has(group.id) ? group.options[0] : undefined)
        if (!option || group.conflicts.some((id) => selectedGroups.has(id))) continue
        selected.add(option.id)
        selectedGroups.add(group.id)
      }
      return selected
    })
    setAnimation((current) => {
      if (current && next.animations.includes(current)) return current
      return next.animations.find(isIdleAnimation) ?? next.animations[0] ?? ''
    })
    setSkeletonSkin((current) => next.skins.includes(current) ? current : next.skins[0] ?? 'default')
  }

  const playAnimation = (name: string) => {
    setAnimation(name)
    setPaused(false)
  }

  const selectVisualState = (groupId: string, stateId?: string) => {
    const group = metadata.stateGroups.find((candidate) => candidate.id === groupId)
    if (!group) return
    setPersistentAnimations((current) => {
      const next = new Set(current)
      for (const option of group.options) next.delete(option.id)
      for (const conflictId of group.conflicts) {
        const conflict = metadata.stateGroups.find((candidate) => candidate.id === conflictId)
        for (const option of conflict?.options ?? []) next.delete(option.id)
      }
      if (stateId) next.add(stateId)
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
          <button className="mobile-icon" onClick={() => setLibraryOpen(true)} aria-label={t('top.openLibrary')}>
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
          <span className="asset-count">{t('top.assetCount', { characters: characterCount, cg: cgCount })}</span>
          <div className="language-switch" role="group" aria-label={t('language.selector')}>
            <button className={locale === 'en' ? 'active' : ''} aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>EN</button>
            <button className={locale === 'zh' ? 'active' : ''} aria-pressed={locale === 'zh'} onClick={() => setLocale('zh')}>中文</button>
          </div>
          <a className="icon-button source-link" href={manifest.source} target="_blank" rel="noreferrer" aria-label={t('top.openRepository')}>
            <Icon name="github" />
          </a>
          <button className="mobile-icon" onClick={() => setInspectorOpen(true)} aria-label={t('top.openInspector')}>
            <Icon name="layers" />
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className={`library-panel ${libraryOpen ? 'is-open' : ''}`}>
          <div className="panel-heading mobile-panel-heading">
            <div><span className="eyebrow">ARCHIVE</span><h2>{t('library.title')}</h2></div>
            <button className="icon-button" onClick={() => setLibraryOpen(false)} aria-label={t('library.close')}><Icon name="close" /></button>
          </div>

          <div className="library-controls">
            <label className="search-field">
              <Icon name="search" size={17} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('library.search')} />
              {query && <button onClick={() => setQuery('')} aria-label={t('library.clearSearch')}><Icon name="close" size={14} /></button>}
            </label>
            <div className="category-tabs" aria-label={t('library.category')}>
              {(['character', 'cg'] as const).map((item) => (
                <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>
                  {categoryLabels[item]}
                </button>
              ))}
            </div>
          </div>

          <div className="result-caption">
            <span>{filteredEntries.length.toString().padStart(3, '0')} {t('library.results')}</span>
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
                  <small>{entry.category === 'character'
                    ? `${entry.characterIds.join(' / ') || 'NO ID'} · ${t(entry.variants.length === 1 ? 'library.skin' : 'library.skins', { count: entry.variants.length })}`
                    : t(entry.variants.length === 1 ? 'library.scene' : 'library.scenes', { count: entry.variants.length })}</small>
                </span>
                <span className={`type-mark type-${entry.category}`}>{categoryLabels[entry.category]}</span>
                <Icon name="chevron" size={15} />
              </button>
            ))}
            {!filteredEntries.length && (
              <div className="empty-state"><span>∅</span><p>{t('library.empty')}</p><button onClick={() => setQuery('')}>{t('library.clearSearch')}</button></div>
            )}
          </div>
        </aside>

        <section ref={stageRef} className={`stage background-${background}`}>
          <div className="stage-grid" />
          <div className="stage-glow" />
          <div className="stage-heading">
            <div>
              <span className="eyebrow">{t('stage.nowObserving')}</span>
              <h2>{selectedEntry.title}</h2>
              <p>{localizeVariantLabel(selectedVariant.label, locale)} · {selectedVariant.main.folder}</p>
            </div>
            <div className="stage-utilities">
              <div className="stage-badges">
                <span>{formatBytes(selectedVariant.bytes)}</span>
                {selectedVariant.effects.length > 0 && <span>{t(selectedVariant.effects.length === 1 ? 'common.effectLayer' : 'common.effectLayers', { count: selectedVariant.effects.length }).toUpperCase()}</span>}
                <span>{metadata.bones || '—'} {t('common.bones')}</span>
                <span>{metadata.slots || '—'} {t('common.slots')}</span>
              </div>
              <div className="background-tabs" aria-label={t('background.label')}>
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
            detectCharacterVariants={selectedEntry.category === 'character'}
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
              <strong>{t('stage.assembling')}</strong>
              <span>{loadState.message}</span>
            </div>
          )}
          {loadState.kind === 'error' && (
            <div className="load-overlay error-overlay">
              <b>!</b><strong>{t('stage.interrupted')}</strong>
              <span>{loadState.message.split('\n')[0]}</span>
              <button onClick={() => setRetryKey((key) => key + 1)}><Icon name="refresh" size={16}/> {t('stage.retry')}</button>
            </div>
          )}

          <div className="stage-toolbar">
            <button className="primary-play" onClick={() => setPaused((value) => !value)} aria-label={paused ? t('toolbar.play') : t('toolbar.pause')}>
              <Icon name={paused ? 'play' : 'pause'} />
            </button>
            <button onClick={resetView} title={t('toolbar.reset')}><Icon name="refresh" /></button>
            <button className={flipped ? 'active' : ''} onClick={() => setFlipped((value) => !value)} title={t('toolbar.flip')}><Icon name="flip" /></button>
            <button className={debug ? 'active' : ''} onClick={() => setDebug((value) => !value)} title={t('toolbar.debug')}><Icon name="layers" /></button>
            <span className="toolbar-separator" />
            <label className="zoom-control">
              <span>ZOOM</span>
              <input type="range" min={MIN_ZOOM} max={MAX_ZOOM} step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
              <output>{Math.round(zoom * 100)}%</output>
            </label>
            <span className="toolbar-separator" />
            <button onClick={copyLink} title={copied ? t('toolbar.copied') : t('toolbar.copy')}><Icon name={copied ? 'check' : 'copy'} /></button>
            <button onClick={toggleFullscreen} title={t('toolbar.fullscreen')}><Icon name="maximize" /></button>
          </div>

          <div className="stage-hint">{t('toolbar.hint')}</div>
        </section>

        <aside className={`inspector-panel ${inspectorOpen ? 'is-open' : ''}`}>
          <div className="panel-heading">
            <div><span className="eyebrow">CONTROL DECK</span><h2>{inspectorTab === 'controls' ? t('inspector.controlTitle') : t('inspector.layerTitle')}</h2></div>
            <button className="icon-button mobile-close" onClick={() => setInspectorOpen(false)} aria-label={t('inspector.close')}><Icon name="close" /></button>
          </div>

          <div className="inspector-tabs" role="tablist" aria-label={t('inspector.mode')}>
            <button role="tab" aria-selected={inspectorTab === 'controls'} className={inspectorTab === 'controls' ? 'active' : ''} onClick={() => setInspectorTab('controls')}>
              <Icon name="play" size={13} />{t('inspector.animations')}
            </button>
            <button role="tab" aria-selected={inspectorTab === 'layers'} className={inspectorTab === 'layers' ? 'active' : ''} onClick={() => setInspectorTab('layers')}>
              <Icon name="layers" size={14} />{t('inspector.layers')}<span>{layers.length}</span>
            </button>
          </div>

          {inspectorTab === 'controls' && (
            <div className="inspector-scroll" role="tabpanel" aria-label={t('inspector.animationControl')}>
              <section className="control-section timeline-section">
                <div className="section-title"><span>01</span><h3>{t('control.progress')}</h3><output>{formatTime(progress.current)} / {formatTime(progress.duration)}</output></div>
                <div className="timeline-track"><i style={{ width: `${progressPercent}%` }} /><b style={{ left: `${progressPercent}%` }} /></div>
                <div className="transport-row">
                  <button onClick={() => setPaused((value) => !value)}><Icon name={paused ? 'play' : 'pause'} /> {paused ? t('control.resume') : t('control.pause')}</button>
                  <label className="switch-label">{t('control.loop')} <input type="checkbox" checked={loop} onChange={(event) => setLoop(event.target.checked)} /><span /></label>
                </div>
              </section>

              <section className="control-section">
                <div className="section-title"><span>02</span><h3>{t('control.animationsAndStates')}</h3><output>{metadata.animations.length}</output></div>
                {metadata.stateGroups.length > 0 && (
                  <div className="state-groups">
                    <div className="control-subtitle"><span>{t('control.stateSettings')}</span><small>{t('control.directSnapshot')}</small></div>
                    {metadata.stateGroups.map((group) => {
                      const selectedState = group.options.find((option) => persistentAnimations.has(option.id))
                      const index = metadata.animations.indexOf(group.id)
                      return (
                        <div className="state-group" key={group.id}>
                          <div className="state-group-heading">
                            <span>{String(index + 1).padStart(2, '0')}</span>
                            <strong>{group.label}</strong>
                            <small>{group.affectedSlots} SLOTS</small>
                          </div>
                          <div className="state-options" role="radiogroup" aria-label={t('control.stateAria', { name: group.label })}>
                            <button
                              role="radio"
                              aria-checked={!selectedState}
                              className={!selectedState ? 'active' : ''}
                              onClick={() => selectVisualState(group.id)}
                            >
                              {t('control.default')}
                            </button>
                            {group.options.map((option, optionIndex) => (
                              <button
                                key={option.id}
                                role="radio"
                                aria-checked={selectedState?.id === option.id}
                                className={selectedState?.id === option.id ? 'active' : ''}
                                title={t('control.stateTooltip', { animation: group.label, time: option.time.toFixed(2) })}
                                onClick={() => selectVisualState(group.id, option.id)}
                              >
                                {option.previewColor && <i style={{ backgroundColor: option.previewColor }} />}
                                {t('control.stateOption', { index: optionIndex + 1 })}
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
                <div className="control-subtitle animation-subtitle"><span>{t('control.actionClips')}</span><small>{motionAnimations.length}</small></div>
                <div className="animation-list">
                  {motionAnimations.map((name) => {
                    const index = metadata.animations.indexOf(name)
                    const isOverlay = metadata.overlayAnimations.includes(name)
                    return (
                      <div key={name} className={`animation-row ${animation === name ? 'selected' : ''} ${isOverlay ? 'overlay' : ''}`}>
                        <button className="animation-play" onClick={() => playAnimation(name)}>
                          <span>{String(index + 1).padStart(2, '0')}</span><strong>{name}</strong>
                          {(animation === name || isOverlay) && (
                            <i>{isOverlay ? (animation === name ? t('control.overlayPlaying') : t('control.overlay')) : 'PLAYING'}</i>
                          )}
                        </button>
                      </div>
                    )
                  })}
                  {loadState.kind === 'loading' && <div className="control-skeleton"><i/><i/><i/></div>}
                </div>
                {metadata.stateGroups.length > 0 && (
                  <p className="state-animation-hint"><i />{t(metadata.stateGroups.length === 1 ? 'control.extractedState' : 'control.extractedStates', { count: metadata.stateGroups.length })}</p>
                )}
                {metadata.overlayAnimations.some((name) => motionAnimations.includes(name)) && (
                  <p className="state-animation-hint overlay-animation-hint"><i />{t('control.overlayHint')}</p>
                )}
                {metadata.variantGroups.length > 1 && (
                  <p className="state-animation-hint"><i />{t('control.variantHint', { names: metadata.variantGroups.join(' / '), count: metadata.variantGroups.length })}</p>
                )}
              </section>

              <section className="control-section variant-section">
                <div className="section-title"><span>03</span><h3>{selectedEntry.category === 'character' ? t('control.characterSkins') : t('control.cgScenes')}</h3><output>{selectedEntry.variants.length}</output></div>
                <select value={selectedVariant.id} onChange={(event) => selectVariant(event.target.value)}>
                  {selectedEntry.variants.map((variant) => <option key={variant.id} value={variant.id}>{variantOptionLabel(variant, locale, t)}</option>)}
                </select>
                {selectedVariant.effects.length > 0 && (
                  <p className="variant-meta"><i />{t(selectedVariant.effects.length === 1 ? 'control.mergedEffect' : 'control.mergedEffects', { count: selectedVariant.effects.length })}</p>
                )}
                {metadata.skins.length > 1 && (
                  <label className="skeleton-skin-field">
                    <span>{t('control.skeletonSkin')}</span>
                    <select value={skeletonSkin} onChange={(event) => setSkeletonSkin(event.target.value)}>
                      {metadata.skins.map((name) => <option key={name}>{name}</option>)}
                    </select>
                  </label>
                )}
              </section>

              <section className="control-section speed-section">
                <div className="section-title"><span>04</span><h3>{t('control.speed')}</h3><output>{speed.toFixed(2)}×</output></div>
                <input type="range" min="0.1" max="2" step="0.05" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} />
                <div className="speed-presets">
                  {[0.5, 1, 1.5, 2].map((value) => <button key={value} className={speed === value ? 'active' : ''} onClick={() => setSpeed(value)}>{value}×</button>)}
                </div>
              </section>

              <section className="source-card">
                <div><span>ORIGIN</span><strong>DaiblosCoreAssets</strong><small>@ {manifest.revision.slice(0, 7)}</small></div>
                <a href={`${manifest.source}/tree/main/spine/${selectedVariant.main.folder}`} target="_blank" rel="noreferrer" aria-label={t('control.openAssetFolder')}><Icon name="external" /></a>
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

      {(libraryOpen || inspectorOpen) && <button className="mobile-scrim" onClick={() => { setLibraryOpen(false); setInspectorOpen(false) }} aria-label={t('control.closePanel')} />}
    </div>
  )
}

export default App
