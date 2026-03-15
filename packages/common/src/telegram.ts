export type MessageElement = {
  html: string
}

export type MessageContent = string | MessageElement
export type ContainerContent = MessageContent | MessageContent[]

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

export function html(content: MessageContent): string {
  if (typeof content === "string") {
    return escapeHtml(content)
  }

  return content.html
}

export const EMPTY_LINE: MessageElement = {
  html: "\n",
}

export const SPACE: MessageElement = {
  html: " ",
}

export function block(...rows: ContainerContent[]): MessageElement {
  return {
    html: rows.flat().map(html).join("\n"),
  }
}

export function inline(...elements: ContainerContent[]): MessageElement {
  return {
    html: elements.flat().map(html).join(""),
  }
}

export function bold(text: MessageContent): MessageElement {
  return {
    html: `<b>${html(text)}</b>`,
  }
}

export function italic(text: MessageContent): MessageElement {
  return {
    html: `<i>${html(text)}</i>`,
  }
}

export function underline(text: MessageContent): MessageElement {
  return {
    html: `<u>${html(text)}</u>`,
  }
}

export function strikethrough(text: MessageContent): MessageElement {
  return {
    html: `<s>${html(text)}</s>`,
  }
}

export function code(text: MessageContent): MessageElement {
  return {
    html: `<code>${html(text)}</code>`,
  }
}

export function pre(text: MessageContent): MessageElement {
  return {
    html: `<pre>${html(text)}</pre>`,
  }
}

export function link(text: MessageContent, url: string): MessageElement {
  return {
    html: `<a href="${escapeHtml(url)}">${html(text)}</a>`,
  }
}

export function customEmoji(emojiId: string, placeholder = "⭐️"): MessageElement {
  return {
    html: `<tg-emoji emoji-id="${escapeHtml(emojiId)}">${escapeHtml(placeholder)}</tg-emoji>`,
  }
}
