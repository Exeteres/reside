import { describe, expect, test } from "bun:test"
import { renderMarkdownAsTelegramHtml } from "./markdown"

describe("renderMarkdownAsTelegramHtml", () => {
  test("renders common assistant markdown as telegram html", () => {
    expect(
      renderMarkdownAsTelegramHtml(
        "**Задача выполнена**\n\nPR #10 влит в `main`: https://github.com/Exeteres/reside/actions/runs/27440869236",
      ).html,
    ).toBe(
      "<b>Задача выполнена</b>\n\nPR #10 влит в <code>main</code>: https://github.com/Exeteres/reside/actions/runs/27440869236",
    )
  })

  test("escapes raw html while preserving supported markdown", () => {
    expect(renderMarkdownAsTelegramHtml("**<ok>** [link](https://example.com?a=1&b=2)").html).toBe(
      '<b>&lt;ok&gt;</b> <a href="https://example.com?a=1&amp;b=2">link</a>',
    )
  })

  test("renders fenced code blocks without inline markdown parsing", () => {
    expect(renderMarkdownAsTelegramHtml("before\n```ts\nconst x = `main`\n```\nafter").html).toBe(
      "before\n<pre>const x = `main`\n</pre>\nafter",
    )
  })
})
