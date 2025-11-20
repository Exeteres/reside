import { escapeHTML } from "bun"

export type MessageElement = {
  __jsx: true
  display: "block" | "inline"
  value: string
}

export function Fragment(props: MessageComponentProps): MessageElement {
  return {
    __jsx: true,
    display: "block",
    value: renderChildren(normalizeElementChild(props.children)),
  }
}

export function isMessageElement(value: unknown): value is MessageElement {
  return typeof value === "object" && value !== null && "__jsx" in value
}

export type MessageElementChild = MessageElement | string

export function normalizeElementChild(child: unknown): MessageElement[] {
  if (!child) {
    return []
  }

  if (isMessageElement(child)) {
    return [child]
  }

  if (Array.isArray(child)) {
    return child.flatMap(normalizeElementChild).filter(Boolean)
  }

  return [
    {
      __jsx: true,
      display: "inline",
      value: escapeHTML(String(child)),
    },
  ]
}

export function renderChildren(children: MessageElement[]): string {
  let result = ""

  for (let i = 0; i < children.length; i++) {
    result += children[i]?.value

    if (children[i]?.display === "block" && i < children.length - 1) {
      result += "\n"
    }
  }

  return result
}

export type MessageComponentProps = {
  children?: MessageElementChild | MessageElementChild[]
  [key: string]: unknown
}

export type MessageComponent = (props: Record<string, unknown>) => MessageElement

export function jsxDEV(
  element: string | MessageComponent,
  props: MessageComponentProps,
): MessageElement {
  if (typeof element === "function") {
    return element(props)
  }

  // virtual element
  if (element === "br") {
    return {
      __jsx: true,
      display: "block",
      value: "",
    }
  }

  const children = normalizeElementChild(props.children)

  // virtual element
  if (element === "div") {
    return {
      __jsx: true,
      display: "block",
      value: renderChildren(children).trim(),
    }
  }

  // virtual element
  if (element === "span") {
    return {
      __jsx: true,
      display: "inline",
      value: typeof props.children === "string" ? props.children : renderChildren(children).trim(),
    }
  }

  // real telegram markup elements

  const attrs = Object.keys(props)
    .filter(key => key !== "children")
    .map(key => ` ${key}="${props[key]}"`)
    .join("")

  if (children.length === 0) {
    return {
      __jsx: true,
      display: "inline",
      value: `<${element}${attrs}/>`,
    }
  }

  return {
    __jsx: true,
    display: "inline",
    value: `<${element}${attrs}>${renderChildren(children)}</${element}>`,
  }
}
