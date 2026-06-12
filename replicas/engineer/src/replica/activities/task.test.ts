import { describe, expect, test } from "bun:test"
import { parseGeneratedTaskPreviewTitle } from "./task"

describe("parseGeneratedTaskPreviewTitle", () => {
  test("parses valid title json", () => {
    expect(parseGeneratedTaskPreviewTitle('{"title":"Очистка контекста"}')).toEqual({
      title: "Очистка контекста",
    })
  })

  test("rejects plain text", () => {
    expect(() => parseGeneratedTaskPreviewTitle("Очистка контекста")).toThrow(
      "OpenAI title response is not valid JSON",
    )
  })

  test("rejects json without object shape", () => {
    expect(() => parseGeneratedTaskPreviewTitle('"Очистка контекста"')).toThrow()
  })
})
