import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import { convertToExcalidrawElements } from "@excalidraw/excalidraw"
import { Component } from "./ui"
import { nanoid } from "nanoid"

export type StatusFieldColor = "success" | "warning" | "danger" | "info"

const fontSize = 16
const fontSymbolWidth = fontSize * 0.6

const strokeColorByFieldColor: Record<StatusFieldColor, string> = {
  success: "#28a745",
  warning: "#ffc107",
  danger: "#dc3545",
  info: "#17a2b8",
}

export type StatusFieldProps = {
  name: string
  value: string
  color?: StatusFieldColor
}

export class StatusField extends Component {
  constructor(private readonly props: StatusFieldProps) {
    super()
  }

  get width(): number {
    return (this.props.name.length + 1 + this.props.value.length) * fontSymbolWidth
  }

  get height(): number {
    return fontSize * 1.2
  }

  render(x: number, y: number, parentWidth: number): ExcalidrawElement[] {
    const nameWidth = (this.props.name.length + 1) * fontSymbolWidth
    const valueWidth = this.props.value.length * fontSymbolWidth
    const valueOffset = parentWidth - valueWidth
    const groupId = nanoid()

    const elements = convertToExcalidrawElements([
      {
        type: "text",
        x,
        y,
        text: `${this.props.name}:`,
        fontSize,
        textAlign: "left",
        groupIds: [groupId],
      },
      {
        type: "text",
        x: x + valueOffset,
        y,
        text: this.props.value,
        fontSize,
        strokeColor: this.props.color ? strokeColorByFieldColor[this.props.color] : undefined,
        textAlign: "left",
        groupIds: [groupId],
      },
    ])

    return [
      {
        ...elements[0],
        width: nameWidth,
        height: this.height,
      },
      {
        ...elements[1],
        width: valueWidth,
        height: this.height,
      },
    ]
  }
}
