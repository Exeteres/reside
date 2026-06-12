import { describe, expect, test } from "bun:test"
import { extractFailureMessageFromLog, extractWorkflowRunId } from "./workflow-log"

describe("extractWorkflowRunId", () => {
  test("extracts run id from github actions url", () => {
    expect(extractWorkflowRunId("https://github.com/org/repo/actions/runs/123456/jobs/1")).toBe(
      123456,
    )
  })

  test("returns undefined for invalid url", () => {
    expect(extractWorkflowRunId("https://example.com/no-run")).toBeUndefined()
  })
})

describe("extractFailureMessageFromLog", () => {
  test("returns matching failure line from tail", () => {
    const log = [
      "step 1 ok",
      "step 2 ok",
      "TypeScript error TS2304: cannot find name x",
      "build finished",
    ].join("\n")

    expect(extractFailureMessageFromLog(log)).toContain("TypeScript error")
  })

  test("falls back to last non-empty line when no known markers", () => {
    const log = ["step 1 ok", "step 2 ok", "final status unknown"].join("\n")

    expect(extractFailureMessageFromLog(log)).toBe("final status unknown")
  })

  test("prefers specific compiler failure over generic runner failure", () => {
    const log = [
      "2026-06-12T22:15:06.000Z src/workflows/bank.ts:20:53 - error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.",
      "2026-06-12T22:15:07.1575736Z ##[error]Process completed with exit code 1.",
    ].join("\n")

    expect(extractFailureMessageFromLog(log)).toContain("error TS2345")
  })
})
