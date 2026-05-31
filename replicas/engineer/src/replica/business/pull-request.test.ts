import { describe, expect, test } from "bun:test"
import { hasIssueClosingTagAtBodyEnd, validatePullRequestTitle } from "./pull-request"

describe("hasIssueClosingTagAtBodyEnd", () => {
  test("returns true for closes tag on last non-empty line", () => {
    const body = "Implements task\n\nCloses #123"

    expect(hasIssueClosingTagAtBodyEnd(body)).toBeTrue()
    expect(hasIssueClosingTagAtBodyEnd(body, 123)).toBeTrue()
  })

  test("returns false for mismatched issue number", () => {
    const body = "Implements task\n\nCloses #123"

    expect(hasIssueClosingTagAtBodyEnd(body, 999)).toBeFalse()
  })

  test("returns false when last non-empty line is not closes tag", () => {
    const body = "Closes #123\n\nMore details"

    expect(hasIssueClosingTagAtBodyEnd(body)).toBeFalse()
  })
})

describe("validatePullRequestTitle", () => {
  test("accepts regular capitalized title", () => {
    expect(() => validatePullRequestTitle("Implement engineer planning session")).not.toThrow()
  })

  test("rejects empty title", () => {
    expect(() => validatePullRequestTitle("  ")).toThrow("Pull request title must not be empty")
  })

  test("rejects lowercase leading letter", () => {
    expect(() => validatePullRequestTitle("implement engineer planning session")).toThrow(
      "Pull request title must start with a capital letter",
    )
  })

  test("rejects conventional-commit styled lowercase title by first validation rule", () => {
    expect(() => validatePullRequestTitle("fix: engineer planning session")).toThrow(
      "Pull request title must start with a capital letter",
    )
  })
})
