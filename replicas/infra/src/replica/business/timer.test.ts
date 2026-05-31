import { describe, expect, test } from "bun:test"
import { parseTimerDelayMs } from "./timer"

describe("parseTimerDelayMs", () => {
  test("parses valid positive delay", () => {
    const value = parseTimerDelayMs({ delayMs: "1500" } as never)

    expect(value).toBe(1500)
  })

  test("throws for non-integer input", () => {
    expect(() => parseTimerDelayMs({ delayMs: "abc" } as never)).toThrow(
      "delayMs must be a valid integer",
    )
  })

  test("throws for non-positive input", () => {
    expect(() => parseTimerDelayMs({ delayMs: "0" } as never)).toThrow(
      "delayMs must be greater than zero",
    )
  })

  test("throws when value exceeds safe range", () => {
    const tooLarge = (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString()

    expect(() => parseTimerDelayMs({ delayMs: tooLarge } as never)).toThrow(
      "delayMs exceeds supported range",
    )
  })
})
