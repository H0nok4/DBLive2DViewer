export const MIN_ZOOM = 0.2
export const MAX_ZOOM = 8

export function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}
