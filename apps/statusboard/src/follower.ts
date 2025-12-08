import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import type {
  ExcalidrawImperativeAPI,
  Offsets,
  PointerCoords,
  Zoom,
} from "@excalidraw/excalidraw/types"

const SPEED = 1 // pixels per tick
const PROXIMITY_DISTANCE_FLOOR = 24
const PROXIMITY_BIAS_EXPONENT = 1.4
const SELF_RESELECTION_FACTOR = 0.2
const RECENT_SELECTION_MAX_PENALTY = 0.8
const RECENT_SELECTION_DECAY = 0.02
const RECENT_SELECTION_MIN_FACTOR = 0.05
const MIN_TARGET_WEIGHT = 1e-6

export class CameraFollower {
  private target: ExcalidrawElement | null = null
  private intervalId: number | null = null
  private tick = 0
  private readonly lastSelectedAt = new Map<string, number>()
  private readonly distanceCache = new Map<string, number>()

  constructor(
    private readonly api: ExcalidrawImperativeAPI,
    private readonly elements: ExcalidrawElement[],
  ) {
    this.intervalId = window.setInterval(() => this.followTarget(), 50)
    this.updateTarget()
  }

  updateTarget(): void {
    const nextTarget = this.selectTarget(this.target)

    if (!nextTarget) {
      this.target = null
      return
    }

    this.target = nextTarget
    this.lastSelectedAt.set(nextTarget.id, this.tick)
  }

  private followTarget(): void {
    this.tick += 1

    if (!this.target) {
      return
    }

    const appState = this.api.getAppState()

    const sceneTargetCenterX = this.target.x + this.target.width / 2
    const sceneTargetCenterY = this.target.y + this.target.height / 2

    const targetCenterViewport = centerScrollOn({
      scenePoint: { x: sceneTargetCenterX, y: sceneTargetCenterY },
      viewportDimensions: { width: appState.width, height: appState.height },
      zoom: appState.zoom,
    })

    const targetCenterX = targetCenterViewport.scrollX
    const targetCenterY = targetCenterViewport.scrollY

    const deltaX = targetCenterX - appState.scrollX
    const deltaY = targetCenterY - appState.scrollY
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)

    if (distance < SPEED) {
      // already there
      this.updateTarget()
      return
    }

    const moveX = (deltaX / distance) * SPEED
    const moveY = (deltaY / distance) * SPEED

    this.api.updateScene({
      appState: {
        scrollX: appState.scrollX + moveX,
        scrollY: appState.scrollY + moveY,
      },
    })
  }

  stop(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  private selectTarget(previousTarget: ExcalidrawElement | null): ExcalidrawElement | null {
    if (this.elements.length === 0) {
      return null
    }

    let totalWeight = 0
    const weighted = this.elements.map(candidate => {
      const weight = this.getTargetWeight(candidate, previousTarget)
      totalWeight += weight
      return { candidate, weight }
    })

    if (totalWeight <= 0) {
      return weighted[0]?.candidate ?? null
    }

    let threshold = Math.random() * totalWeight

    for (const { candidate, weight } of weighted) {
      threshold -= weight
      if (threshold <= 0) {
        return candidate
      }
    }

    return weighted[weighted.length - 1]?.candidate ?? null
  }

  private getTargetWeight(
    candidate: ExcalidrawElement,
    previousTarget: ExcalidrawElement | null,
  ): number {
    let weight = 1

    if (previousTarget) {
      if (candidate.id === previousTarget.id) {
        weight *= SELF_RESELECTION_FACTOR
      } else {
        const distance = this.getDistance(previousTarget, candidate)
        const biasedDistance = Math.max(distance, PROXIMITY_DISTANCE_FLOOR)
        weight *= 1 / biasedDistance ** PROXIMITY_BIAS_EXPONENT
      }
    }

    weight *= this.getRecencyFactor(candidate)

    return Math.max(weight, MIN_TARGET_WEIGHT)
  }

  private getRecencyFactor(candidate: ExcalidrawElement): number {
    const lastTick = this.lastSelectedAt.get(candidate.id)

    if (lastTick === undefined) {
      return 1
    }

    const ticksSince = this.tick - lastTick

    if (ticksSince <= 0) {
      return RECENT_SELECTION_MIN_FACTOR
    }

    const penalty = RECENT_SELECTION_MAX_PENALTY * Math.exp(-ticksSince * RECENT_SELECTION_DECAY)

    return Math.max(1 - penalty, RECENT_SELECTION_MIN_FACTOR)
  }

  private getDistance(a: ExcalidrawElement, b: ExcalidrawElement): number {
    if (a.id === b.id) {
      return 0
    }

    const key = this.getDistanceCacheKey(a.id, b.id)
    const cached = this.distanceCache.get(key)

    if (cached !== undefined) {
      return cached
    }

    const ax = a.x + a.width / 2
    const ay = a.y + a.height / 2
    const bx = b.x + b.width / 2
    const by = b.y + b.height / 2

    const distance = Math.hypot(ax - bx, ay - by)

    this.distanceCache.set(key, distance)

    return distance
  }

  private getDistanceCacheKey(aId: string, bId: string): string {
    return aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`
  }
}

export const centerScrollOn = ({
  scenePoint,
  viewportDimensions,
  zoom,
  offsets,
}: {
  scenePoint: PointerCoords
  viewportDimensions: { height: number; width: number }
  zoom: Zoom
  offsets?: Offsets
}) => {
  let scrollX = (viewportDimensions.width - (offsets?.right ?? 0)) / 2 / zoom.value - scenePoint.x

  scrollX += (offsets?.left ?? 0) / 2 / zoom.value

  let scrollY = (viewportDimensions.height - (offsets?.bottom ?? 0)) / 2 / zoom.value - scenePoint.y

  scrollY += (offsets?.top ?? 0) / 2 / zoom.value

  return {
    scrollX,
    scrollY,
  }
}
