import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"

export type ElementMovement = {
  deltaX?: number
  deltaY?: number
}

export function moveElements(
  elements: ExcalidrawElement[],
  { deltaX = 0, deltaY = 0 }: ElementMovement,
): ExcalidrawElement[] {
  return elements.map(element => ({
    ...element,
    x: element.x + deltaX,
    y: element.y + deltaY,
  }))
}
