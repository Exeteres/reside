import { describe, expect, test } from "bun:test"
import { buildSecuritySystemPrompt } from "./rules"

describe("buildSecuritySystemPrompt", () => {
  test("instructs judge to search memory with separate words", () => {
    const prompt = buildSecuritySystemPrompt()

    expect(prompt).toContain(
      "- when calling reside_find_notes, pass separate important words, not a full sentence or query syntax.",
    )
    expect(prompt).toContain(
      "- include words for permission, scope, requester/target replica, action, and reason when available.",
    )
  })
})
