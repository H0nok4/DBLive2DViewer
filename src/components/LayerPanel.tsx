import { useMemo, useState } from 'react'
import { Icon } from './Icon'
import { useI18n } from '../i18n'
import type { SpineLayerInfo } from '../types'

interface LayerPanelProps {
  layers: SpineLayerInfo[]
  hiddenLayerIds: ReadonlySet<string>
  loading: boolean
  onToggle: (id: string) => void
  onSetVisibility: (ids: string[], visible: boolean) => void
}

interface LayerGroup {
  id: string
  label: string
  kind: SpineLayerInfo['groupKind']
  layers: SpineLayerInfo[]
}

export function LayerPanel({ layers, hiddenLayerIds, loading, onToggle, onSetVisibility }: LayerPanelProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const filteredLayers = useMemo(() => {
    if (!normalizedQuery) return layers
    return layers.filter((layer) => `${layer.name} ${layer.attachment} ${layer.groupLabel}`.toLowerCase().includes(normalizedQuery))
  }, [layers, normalizedQuery])

  const groups = useMemo(() => {
    const grouped = new Map<string, LayerGroup>()
    for (const layer of filteredLayers) {
      const group = grouped.get(layer.groupId) ?? {
        id: layer.groupId,
        label: layer.groupLabel,
        kind: layer.groupKind,
        layers: [],
      }
      group.layers.push(layer)
      grouped.set(layer.groupId, group)
    }
    return [...grouped.values()]
  }, [filteredLayers])

  const visibleCount = layers.reduce((count, layer) => count + (hiddenLayerIds.has(layer.id) ? 0 : 1), 0)
  const filteredIds = filteredLayers.map((layer) => layer.id)
  const groupLabel = (group: LayerGroup) => t(
    group.kind === 'back' ? 'layer.groupBack' : group.kind === 'front' ? 'layer.groupFront' : 'layer.groupMain',
    { name: group.label },
  )

  return (
    <div className="layer-panel" role="tabpanel" aria-label={t('layer.control')}>
      <div className="layer-summary">
        <div>
          <span className="eyebrow">LIVE SLOT STACK</span>
          <strong>{visibleCount}<small>{t('layer.visible', { count: layers.length })}</small></strong>
        </div>
        <span className="layer-live-indicator"><i />{t('layer.animationLocked')}</span>
      </div>

      <div className="layer-tools">
        <label className="search-field layer-search">
          <Icon name="search" size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('layer.search')}
            aria-label={t('layer.filter')}
          />
          {query && <button onClick={() => setQuery('')} aria-label={t('layer.clearFilter')}><Icon name="close" size={13} /></button>}
        </label>
        <div className="layer-bulk-actions">
          <button disabled={!filteredIds.length} onClick={() => onSetVisibility(filteredIds, true)}>{t('layer.showAll')}</button>
          <button disabled={!filteredIds.length} onClick={() => onSetVisibility(filteredIds, false)}>{t('layer.hideAll')}</button>
        </div>
        {normalizedQuery && <div className="layer-filter-caption">{t(filteredLayers.length === 1 ? 'layer.filterOne' : 'layer.filterCount', { count: filteredLayers.length })}</div>}
      </div>

      <div className="layer-groups">
        {groups.map((group) => {
          const groupIds = group.layers.map((layer) => layer.id)
          const groupVisible = group.layers.filter((layer) => !hiddenLayerIds.has(layer.id)).length
          const shouldShow = groupVisible < group.layers.length

          return (
            <section className={`layer-group layer-group-${group.kind}`} key={group.id}>
              <div className="layer-group-heading">
                <div><i /><strong>{groupLabel(group)}</strong><span>{groupVisible}/{group.layers.length}</span></div>
                <button onClick={() => onSetVisibility(groupIds, shouldShow)}>{shouldShow ? t('layer.showGroup') : t('layer.hideGroup')}</button>
              </div>
              <div className="layer-list">
                {group.layers.map((layer) => {
                  const visible = !hiddenLayerIds.has(layer.id)
                  return (
                    <label className={`layer-row ${visible ? '' : 'is-hidden'}`} key={layer.id}>
                      <input type="checkbox" checked={visible} onChange={() => onToggle(layer.id)} />
                      <span className="layer-checkbox"><Icon name="check" size={11} /></span>
                      <span className="layer-name">
                        <strong>{layer.name}</strong>
                        {layer.attachment && layer.attachment !== layer.name && <small>{layer.attachment}</small>}
                      </span>
                      <span className="layer-index">S{String(layer.slotIndex).padStart(3, '0')}</span>
                    </label>
                  )
                })}
              </div>
            </section>
          )
        })}

        {!groups.length && loading && <div className="layer-empty"><div className="loader-orbit"><i/><i/><i/></div><span>{t('layer.loading')}</span></div>}
        {!groups.length && !loading && (
          <div className="layer-empty">
            <Icon name="layers" size={28} />
            <strong>{normalizedQuery ? t('layer.noMatches') : t('layer.noLayers')}</strong>
            <span>{normalizedQuery ? t('layer.tryOther') : t('layer.excluded')}</span>
          </div>
        )}
      </div>
    </div>
  )
}
