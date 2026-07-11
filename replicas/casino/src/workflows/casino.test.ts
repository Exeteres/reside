import { describe, expect, test } from "bun:test"
import { CasinoValidationError } from "../definitions"
import { strings } from "../locale"
import { formatRejectionReason } from "./casino"

describe("formatRejectionReason", () => {
  test("unwraps direct casino validation errors", () => {
    expect(formatRejectionReason(new CasinoValidationError(strings.errors.invalidSides))).toBe(
      strings.errors.invalidSides,
    )
  })

  test("unwraps temporal activity failures with serialized casino validation causes", () => {
    const error = new Error("Activity task failed", {
      cause: {
        type: CasinoValidationError.name,
        message: strings.errors.insufficientCasinoFunds,
      },
    })

    expect(formatRejectionReason(error)).toBe(strings.errors.insufficientCasinoFunds)
  })

  test("hides unexpected errors before payment", () => {
    expect(formatRejectionReason(new Error("Activity task failed"))).toBe(
      strings.notifications.bet.failed.beforePayment,
    )
  })
})
