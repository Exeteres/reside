import { describe, expect, test } from "bun:test"
import { testCrypto } from "@reside/common/testing"
import { z } from "zod"
import { CasinoValidationError } from "../../definitions"
import {
  assertSufficientBalance,
  DEFAULT_BET_SIDES,
  DICE_EMOJI,
  parseBet,
  parseEncryptedBet,
} from "./casino"

test("exports casino dice defaults", () => {
  expect(DEFAULT_BET_SIDES).toBe("1-3")
  expect(DICE_EMOJI).toBe("🎲")
})

describe("parseBet", () => {
  test("uses default sides", () => {
    expect(parseBet("10")).toEqual({
      amount: "10",
      sides: [1, 2, 3],
      selectedSideCount: 3,
      payoutAmount: "20",
      multiplierLabel: "x2",
    })
  })

  test("parses mixed ranges and deduplicates sides", () => {
    expect(parseBet("10", "1,2-4,4,6").sides).toEqual([1, 2, 3, 4, 6])
  })

  test("parses all sides as even payout with x1 multiplier", () => {
    expect(parseBet("10", "1-6")).toEqual({
      amount: "10",
      sides: [1, 2, 3, 4, 5, 6],
      selectedSideCount: 6,
      payoutAmount: "10",
      multiplierLabel: "x1",
    })
  })

  test("parses two sides as x3 multiplier", () => {
    expect(parseBet("10", "2,5")).toEqual({
      amount: "10",
      sides: [2, 5],
      selectedSideCount: 2,
      payoutAmount: "30",
      multiplierLabel: "x3",
    })
  })

  test("trims empty separators around sides", () => {
    expect(parseBet("10", " 1, , 3 ").sides).toEqual([1, 3])
  })

  test("rejects non-positive and malformed amounts", () => {
    expect(() => parseBet("0")).toThrow(CasinoValidationError)
    expect(() => parseBet("-1")).toThrow(CasinoValidationError)
    expect(() => parseBet("1.5")).toThrow(CasinoValidationError)
  })

  test("rejects invalid sides", () => {
    expect(() => parseBet("10", "1-7")).toThrow(CasinoValidationError)
    expect(() => parseBet("10", "4-2")).toThrow(CasinoValidationError)
    expect(() => parseBet("10", "1,a")).toThrow(CasinoValidationError)
    expect(() => parseBet("10", "0")).toThrow(CasinoValidationError)
  })

  test("rejects empty sides", () => {
    expect(() => parseBet("10", ", ,")).toThrow(CasinoValidationError)
  })

  test("rejects fractional payouts", () => {
    expect(() => parseBet("11", "1-5")).toThrow(CasinoValidationError)
  })
})

describe("assertSufficientBalance", () => {
  test("accepts balance that covers payout", () => {
    expect(() => assertSufficientBalance("20", "20")).not.toThrow()
  })

  test("rejects balance below payout", () => {
    expect(() => assertSufficientBalance("19", "20")).toThrow(CasinoValidationError)
  })

  test("accepts positive payout when balance is larger", () => {
    expect(() => assertSufficientBalance("21", "20")).not.toThrow()
  })

  test("rejects malformed balance and payout", () => {
    expect(() => assertSufficientBalance("oops", "20")).toThrow(CasinoValidationError)
    expect(() => assertSufficientBalance("20", "0")).toThrow(CasinoValidationError)
  })
})

describe("parseEncryptedBet", () => {
  test("returns ECIDs instead of plaintext amount values", async () => {
    const parsed = await parseEncryptedBet(testCrypto, "10", "1-3")

    expect(parsed).toMatchObject({
      sides: [1, 2, 3],
      selectedSideCount: 3,
      multiplierLabel: "x2",
    })
    expect(parsed.amountEcid).toStartWith("enc:")
    expect(parsed.payoutAmountEcid).toStartWith("enc:")
    expect(parsed.amountEcid).not.toBe("10")
    expect(parsed.payoutAmountEcid).not.toBe("20")
    expect(await testCrypto.decrypt(z.string(), parsed.amountEcid)).toBe("10")
    expect(await testCrypto.decrypt(z.string(), parsed.payoutAmountEcid)).toBe("20")
  })
})
