import { useMemo, useState } from 'react'
import { Icon } from './Icon'
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

  return (
    <div className="layer-panel" role="tabpanel" aria-label="图层控制">
      <div className="layer-summary">
        <div>
          <span className="eyebrow">LIVE SLOT STACK</span>
          <strong>{visibleCount}<small> / {layers.length} 可见</small></strong>
        </div>
        <span className="layer-live-indicator"><i />随动画锁定</span>
      </div>

      <div className="layer-tools">
        <label className="search-field layer-search">
          <Icon name="search" size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="筛选 slot 或 attachment…"
            aria-label="筛选图层"
          />
          {query && <button onClick={() => setQuery('')} aria-label="清空图层筛选"><Icon name="close" size={13} /></button>}
        </label>
        <div className="layer-bulk-actions">
          <button disabled={!filteredIds.length} onClick={() => onSetVisibility(filteredIds, true)}>全部显示</button>
          <button disabled={!filteredIds.length} onClick={() => onSetVisibility(filteredIds, false)}>全部隐藏</button>
        </div>
        {normalizedQuery && <div className="layer-filter-caption">筛选到 {filteredLayers.length} 个图层</div>}
      </div>

      <div className="layer-groups">
        {groups.map((group) => {
          const groupIds = group.layers.map((layer) => layer.id)
          const groupVisible = group.layers.filter((layer) => !hiddenLayerIds.has(layer.id)).length
          const shouldShow = groupVisible < group.layers.length

          return (
            <section className={`layer-group layer-group-${group.kind}`} key={group.id}>
              <div className="layer-group-heading">
                <div><i /><strong>{group.label}</strong><span>{groupVisible}/{group.layers.length}</span></div>
                <button onClick={() => onSetVisibility(groupIds, shouldShow)}>{shouldShow ? '显示组' : '隐藏组'}</button>
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

        {!groups.length && loading && <div className="layer-empty"><div className="loader-orbit"><i/><i/><i/></div><span>正在读取当前动画图层…</span></div>}
        {!groups.length && !loading && (
          <div className="layer-empty">
            <Icon name="layers" size={28} />
            <strong>{normalizedQuery ? '没有匹配的图层' : '当前动画没有可切换图层'}</strong>
            <span>{normalizedQuery ? '尝试其他 slot 或 attachment 名称' : '裁剪蒙版和非渲染 slot 已自动排除'}</span>
          </div>
        )}
      </div>
    </div>
  )
}
