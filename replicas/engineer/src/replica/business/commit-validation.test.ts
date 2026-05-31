import { describe, expect, test } from "bun:test"
import {
  CommitValidationError,
  isConventionalCommitTitle,
  parseCommitLogOutput,
  validateBranchCommitLogOutput,
} from "./commit-validation"

describe("isConventionalCommitTitle", () => {
  test("accepts reported false-positive subject", () => {
    expect(isConventionalCommitTitle("fix: rate deploy runbook")).toBe(true)
  })

  test("accepts non-breaking space after colon", () => {
    expect(isConventionalCommitTitle("fix:\u00a0rate deploy runbook")).toBe(true)
  })

  test("rejects non-conventional subject", () => {
    expect(isConventionalCommitTitle("rate deploy runbook")).toBe(false)
  })
})

describe("parseCommitLogOutput", () => {
  test("parses multiple commit records from nul-delimited git log output", () => {
    const output =
      "b721ab8e11111111\0fix: rate deploy runbook\0\0" +
      "c123456789abcdef\0chore(engineer): update prompt\0\0"

    expect(parseCommitLogOutput(output)).toEqual([
      {
        hash: "b721ab8e11111111",
        subject: "fix: rate deploy runbook",
        body: "",
      },
      {
        hash: "c123456789abcdef",
        subject: "chore(engineer): update prompt",
        body: "",
      },
    ])
  })
})

describe("validateBranchCommitLogOutput", () => {
  test("accepts valid commits with empty bodies", () => {
    const output =
      "b721ab8e11111111\0fix: rate deploy runbook\0\0" +
      "c123456789abcdef\0docs: update deploy guide\0\0"

    expect(() => validateBranchCommitLogOutput(output)).not.toThrow()
  })

  test("rejects uppercase subjects", () => {
    const output = "b721ab8e11111111\0Fix: rate deploy runbook\0\0"

    expect(() => validateBranchCommitLogOutput(output)).toThrow(CommitValidationError)
    expect(() => validateBranchCommitLogOutput(output)).toThrow("must be lowercase")
  })

  test("rejects commit body content", () => {
    const output = "b721ab8e11111111\0fix: rate deploy runbook\0details\0"

    expect(() => validateBranchCommitLogOutput(output)).toThrow("must not contain commit body")
  })
})
