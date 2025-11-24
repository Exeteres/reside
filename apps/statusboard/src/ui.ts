import type { ExcalidrawElement, FileId } from "@excalidraw/excalidraw/element/types"
import { convertToExcalidrawElements } from "@excalidraw/excalidraw"
import type { BinaryFileData, DataURL, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types"
import { nanoid } from "nanoid"

export abstract class Component {
  /**
   * The estimated width of the component in pixels.
   */
  abstract width: number

  /**
   * The estimated height of the component in pixels.
   */
  abstract height: number

  /**
   * Produces the Excalidraw elements representing this object.
   * They have static positions and dimensions and ready to be placed on the canvas.
   *
   * @param x The x coordinate where to render the object.
   * @param y The y coordinate where to render the object.
   * @param parentWidth The estimated width of the parent container.
   * @param parentHeight The estimated height of the parent container.
   */
  abstract render(
    x: number,
    y: number,
    parentWidth: number,
    parentHeight: number,
  ): ExcalidrawElement[]

  /**
   * Returns the binary files required by this component, if any.
   */
  getFiles(): BinaryFileData[] {
    return []
  }
}

function addGroupIdToElements(elements: ExcalidrawElement[], groupId: string): ExcalidrawElement[] {
  return elements.map(element => ({
    ...element,
    groupIds: [...(element.groupIds ?? []), groupId],
  }))
}

export class Row extends Component {
  constructor(
    private readonly props: {
      /**
       * The child components to render in a row.
       */
      children: readonly Component[]

      /**
       * The offset between rows in pixels.
       */
      offset?: number

      /**
       * The alignment of the row contents.
       */
      align?: "top" | "middle" | "bottom"
    },
  ) {
    super()
  }

  get width(): number {
    const offset = this.props.offset ?? 0

    return (
      this.props.children.reduce((sum, child) => sum + child.width, 0) +
      offset * (this.props.children.length - 1)
    )
  }

  get height(): number {
    return Math.max(...this.props.children.map(child => child.height))
  }

  render(x: number, y: number): ExcalidrawElement[] {
    const offset = this.props.offset ?? 0
    const result: ExcalidrawElement[] = []
    const groupId = nanoid()

    const align = this.props.align ?? "top"
    const width = this.width
    const height = this.height

    for (const child of this.props.children) {
      let childY = y

      if (align === "middle") {
        childY += (this.height - child.height) / 2
      } else if (align === "bottom") {
        childY += this.height - child.height
      }

      result.push(...addGroupIdToElements(child.render(x, childY, width, height), groupId))
      x += child.width + offset
    }

    return result
  }

  getFiles(): BinaryFileData[] {
    return this.props.children.flatMap(child => child.getFiles())
  }
}

export class Column extends Component {
  constructor(
    private readonly props: {
      /**
       * The child components to render in a column.
       */
      children: readonly Component[]

      /**
       * The offset between columns in pixels.
       */
      offset?: number

      /**
       * The alignment of the column contents.
       */
      align?: "left" | "center" | "right"
    },
  ) {
    super()
  }

  get width(): number {
    return Math.max(...this.props.children.map(child => child.width))
  }

  get height(): number {
    const offset = this.props.offset ?? 0

    return (
      this.props.children.reduce((sum, child) => sum + child.height, 0) +
      offset * (this.props.children.length - 1)
    )
  }

  render(x: number, y: number): ExcalidrawElement[] {
    const offset = this.props.offset ?? 0
    const result: ExcalidrawElement[] = []
    const groupId = nanoid()

    const align = this.props.align ?? "left"
    const width = this.width
    const height = this.height

    for (const child of this.props.children) {
      let childX = x

      if (align === "center") {
        childX += (this.width - child.width) / 2
      } else if (align === "right") {
        childX += this.width - child.width
      }

      result.push(...addGroupIdToElements(child.render(childX, y, width, height), groupId))
      y += child.height + offset
    }

    return result
  }

  getFiles(): BinaryFileData[] {
    return this.props.children.flatMap(child => child.getFiles())
  }
}

export class Text extends Component {
  constructor(
    private readonly props: {
      /**
       * The text content.
       */
      text: string

      /**
       * The font size in pixels.
       */
      fontSize?: number

      /**
       * The color of the text.
       */
      strokeColor?: string
    },
  ) {
    super()
  }

  get width(): number {
    const fontSize = this.props.fontSize ?? 16
    const averageCharWidth = fontSize * 0.6

    return this.props.text.length * averageCharWidth
  }

  get height(): number {
    const fontSize = this.props.fontSize ?? 16

    return fontSize * 1.2
  }

  render(x: number, y: number): ExcalidrawElement[] {
    const elements = convertToExcalidrawElements([
      {
        type: "text",
        x,
        y,
        text: this.props.text,
        fontSize: this.props.fontSize ?? 16,
        strokeColor: this.props.strokeColor,
      },
    ])

    return [
      {
        ...elements[0],
        width: this.width,
        height: this.height,
      },
    ]
  }
}

export class Image extends Component {
  constructor(
    private readonly props: {
      /**
       * The url of the image.
       */
      url: string

      /**
       * The width of the image.
       */
      width: number

      /**
       * The height of the image.
       */
      height: number
    },
  ) {
    super()
  }

  get width(): number {
    return this.props.width
  }

  get height(): number {
    return this.props.height
  }

  render(x: number, y: number): ExcalidrawElement[] {
    return convertToExcalidrawElements([
      {
        type: "image",
        fileId: this.props.url as FileId,
        x,
        y,
        width: this.props.width,
        height: this.props.height,
      },
    ])
  }

  getFiles(): BinaryFileData[] {
    return [
      {
        id: this.props.url as FileId,
        dataURL: this.props.url as DataURL,
        created: Date.now(),
        mimeType: "image/png",
      },
    ]
  }
}

export function renderComponent(component: Component): ExcalidrawElement[] {
  return component.render(0, 0, component.width, component.height)
}

export function updateCanvas(
  api: ExcalidrawImperativeAPI,
  component: Component,
): ExcalidrawElement[] {
  const elements = renderComponent(component)
  const files = component.getFiles()

  const existingFiles = api.getFiles()
  const newFiles = files.filter(file => !existingFiles[file.id])

  if (newFiles.length > 0) {
    api.addFiles(newFiles)
    console.log("adding canvas files", newFiles)
  }

  console.log("updating canvas elements", elements)
  api.updateScene({ elements })

  return elements
}
