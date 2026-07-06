import { describe, expect, test } from "bun:test"
import { buildJudgementPrompt, maskNonReplicaSubjectIds } from "./judgement"

describe("buildJudgementPrompt", () => {
  test("builds prompt with embedded english instructions and request payload", () => {
    const prompt = buildJudgementPrompt({
      decisionToken: "42:token",
      title: "Grant replica:alpha read access",
      content: "requested by telegram:john_doe",
    })

    expect(prompt).toContain("Decision instructions:")
    expect(prompt).toContain("1) First, evaluate static escalation rules from the system prompt.")
    expect(prompt).toContain(
      "2) Then find relevant allow rules in memory by calling find_notes with separate important words from the request.",
    )
    expect(prompt).toContain("Decision token: 42:token")
    expect(prompt).toContain("Title:\nGrant replica:alpha read access")
    expect(prompt).toContain("Content:\nrequested by telegram:john_doe")
  })
})

describe("maskNonReplicaSubjectIds", () => {
  test("masks non-replica subjects and preserves replica ids", () => {
    const masked = maskNonReplicaSubjectIds(
      "requested by telegram:john for replica:alpha via access:approver",
      "***",
    )

    expect(masked).toBe("requested by telegram:*** for replica:alpha via access:***")
  })

  test("keeps text without subject ids unchanged", () => {
    const input = "freeform content without subject identifier"

    const masked = maskNonReplicaSubjectIds(input, "***")

    expect(masked).toBe(input)
  })
})
