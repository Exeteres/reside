import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import { Component } from "./ui"
import { graphlib, layout } from "dagre"
import type { BinaryFileData } from "@excalidraw/excalidraw/types"
import { convertToExcalidrawElements } from "@excalidraw/excalidraw"

export class GraphLayout extends Component {
  private readonly positions: Map<Component, { x: number; y: number }> = new Map()

  constructor(
    private readonly props: {
      nodes: Component[]
      edges: { from: Component; to: Component }[]
    },
  ) {
    super()

    const nodeIds = new Map<Component, string>()
    for (const node of this.props.nodes) {
      nodeIds.set(node, `node-${nodeIds.size + 1}`)
    }

    const graph = new graphlib.Graph({ directed: true })
    graph.setGraph({ rankdir: "RL", nodesep: 50, ranksep: 50 })
    graph.setDefaultEdgeLabel(() => ({}))

    for (const node of this.props.nodes) {
      graph.setNode(nodeIds.get(node)!, { width: node.width, height: node.height })
    }

    for (const edge of this.props.edges) {
      graph.setEdge(nodeIds.get(edge.from)!, nodeIds.get(edge.to)!)
    }

    layout(graph)

    for (const node of this.props.nodes) {
      const nodeId = nodeIds.get(node)!
      const graphNode = graph.node(nodeId)!

      this.positions.set(node, {
        x: graphNode.x - node.width / 2,
        y: graphNode.y - node.height / 2,
      })
    }
  }

  get width(): number {
    let maxX = 0

    for (const [node, pos] of this.positions) {
      const nodeMaxX = pos.x + node.width
      if (nodeMaxX > maxX) {
        maxX = nodeMaxX
      }
    }

    return maxX
  }

  get height(): number {
    let maxY = 0

    for (const [node, pos] of this.positions) {
      const nodeMaxY = pos.y + node.height
      if (nodeMaxY > maxY) {
        maxY = nodeMaxY
      }
    }

    return maxY
  }

  render(x: number, y: number): ExcalidrawElement[] {
    const elementMap: Map<Component, ExcalidrawElement[]> = new Map()
    const elements: ExcalidrawElement[] = []

    for (const node of this.props.nodes) {
      const pos = this.positions.get(node)!
      const nodeElements = node.render(x + pos.x, y + pos.y, node.width, node.height)

      elementMap.set(node, nodeElements)
      elements.push(...nodeElements)
    }

    for (const edge of this.props.edges) {
      const startBox = getBoundingBox(elementMap.get(edge.from)!)
      const endBox = getBoundingBox(elementMap.get(edge.to)!)

      const startCenter = getBoxCenter(startBox)
      const endCenter = getBoxCenter(endBox)

      const startAnchor = getBoxAnchor(startBox, endCenter)
      const endAnchor = getBoxAnchor(endBox, startCenter)

      const arrows = convertToExcalidrawElements([
        {
          type: "arrow",
          x: startAnchor.x,
          y: startAnchor.y,
          width: endAnchor.x - startAnchor.x,
          height: endAnchor.y - startAnchor.y,
        },
      ])

      elements.push(...arrows)
    }

    return elements
  }

  getFiles(): BinaryFileData[] {
    return this.props.nodes.flatMap(node => node.getFiles())
  }
}

function getBoundingBox(elements: ExcalidrawElement[]): {
  x: number
  y: number
  width: number
  height: number
} {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const element of elements) {
    if (element.x < minX) {
      minX = element.x
    }
    if (element.y < minY) {
      minY = element.y
    }
    if (element.x + element.width > maxX) {
      maxX = element.x + element.width
    }
    if (element.y + element.height > maxY) {
      maxY = element.y + element.height
    }
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

function getBoxCenter(box: { x: number; y: number; width: number; height: number }): {
  x: number
  y: number
} {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  }
}

function getBoxAnchor(
  box: { x: number; y: number; width: number; height: number },
  target: { x: number; y: number },
): { x: number; y: number } {
  const center = getBoxCenter(box)
  const deltaX = target.x - center.x
  const deltaY = target.y - center.y

  if (deltaX === 0 && deltaY === 0) {
    return center
  }

  const halfWidth = box.width / 2
  const halfHeight = box.height / 2

  const scaleX = deltaX !== 0 ? halfWidth / Math.abs(deltaX) : Number.POSITIVE_INFINITY
  const scaleY = deltaY !== 0 ? halfHeight / Math.abs(deltaY) : Number.POSITIVE_INFINITY
  const scale = Math.min(scaleX, scaleY)

  return {
    x: center.x + deltaX * scale,
    y: center.y + deltaY * scale,
  }
}
