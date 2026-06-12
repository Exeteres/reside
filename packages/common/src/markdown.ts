import type { MessageElement } from "./telegram"
import { code, html, link, pre } from "./telegram"

const FENCED_CODE_BLOCK_PATTERN = /```(?:[^\n`]*)\n?([\s\S]*?)```/g
const LINK_PATTERN = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g
const INLINE_CODE_PATTERN = /`([^`\n]+)`/g
const BOLD_PATTERN = /\*\*([^*\n]+)\*\*/g
const ITALIC_PATTERN = /(?<!\*)\*([^*\n]+)\*(?!\*)/g
const STRIKETHROUGH_PATTERN = /~~([^~\n]+)~~/g

/**
 * Renders a Markdown subset as Telegram-compatible HTML.
 *
 * The renderer supports fenced code blocks, inline code, links, bold, italic,
 * and strikethrough markers while escaping all raw input text.
 * Unsupported Markdown is preserved as escaped text.
 *
 * @param markdown The Markdown text to render.
 * @returns Telegram-compatible HTML message content.
 */
export function renderMarkdownAsTelegramHtml(markdown: string): MessageElement {
  const rows: MessageElement[] = []
  let cursor = 0

  for (const match of markdown.matchAll(FENCED_CODE_BLOCK_PATTERN)) {
    const matchIndex = match.index ?? 0
    const before = markdown.slice(cursor, matchIndex)
    if (before.length > 0) {
      rows.push(renderInlineMarkdown(before))
    }

    rows.push(pre(match[1] ?? ""))
    cursor = matchIndex + match[0].length
  }

  const after = markdown.slice(cursor)
  if (after.length > 0 || rows.length === 0) {
    rows.push(renderInlineMarkdown(after))
  }

  return {
    html: rows.map(row => row.html).join(""),
  }
}

function renderInlineMarkdown(markdown: string): MessageElement {
  const placeholders: string[] = []
  let text = markdown

  text = replaceInlineTokens(
    text,
    LINK_PATTERN,
    placeholders,
    match => link(match[1] ?? "", match[2] ?? "").html,
  )
  text = replaceInlineTokens(
    text,
    INLINE_CODE_PATTERN,
    placeholders,
    match => code(match[1] ?? "").html,
  )
  text = replaceInlineTokens(
    text,
    BOLD_PATTERN,
    placeholders,
    match => `<b>${html(match[1] ?? "")}</b>`,
  )
  text = replaceInlineTokens(
    text,
    ITALIC_PATTERN,
    placeholders,
    match => `<i>${html(match[1] ?? "")}</i>`,
  )
  text = replaceInlineTokens(
    text,
    STRIKETHROUGH_PATTERN,
    placeholders,
    match => `<s>${html(match[1] ?? "")}</s>`,
  )

  let rendered = html(text)
  for (const [index, replacement] of placeholders.entries()) {
    rendered = rendered.replace(placeholder(index), replacement)
  }

  return { html: rendered }
}

function replaceInlineTokens(
  text: string,
  pattern: RegExp,
  placeholders: string[],
  render: (match: RegExpExecArray) => string,
): string {
  return text.replace(pattern, (...args) => {
    const match = args.slice(0, -2) as RegExpExecArray
    const index = placeholders.length
    placeholders.push(render(match))
    return placeholder(index)
  })
}

function placeholder(index: number): string {
  return `\u0000${index}\u0000`
}
