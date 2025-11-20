declare namespace JSX {
  interface IntrinsicElements {
    // virtual elements
    div: unknown
    span: unknown
    br: unknown

    // real Telegram message elements
    code: unknown
    pre: unknown
    b: unknown
    strong: unknown
    i: unknown
    em: unknown
    u: unknown
    ins: unknown
    s: unknown
    strike: unknown
    del: unknown
    "tg-spoiler": unknown
    a: {
      href: string
    }
    "tg-emoji": {
      "emoji-id": string
    }
    blockquote: {
      expandable?: boolean
    }
  }
}
