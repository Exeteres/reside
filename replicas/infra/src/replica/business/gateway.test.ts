import { describe, expect, test } from "bun:test"
import { assertValidGatewayRequest } from "./gateway"

describe("assertValidGatewayRequest", () => {
  test("accepts valid request", () => {
    expect(() =>
      assertValidGatewayRequest({
        name: "gateway-main",
        title: "Main Gateway",
      } as never),
    ).not.toThrow()
  })

  test("rejects invalid gateway name", () => {
    expect(() =>
      assertValidGatewayRequest({
        name: "Invalid_Name",
        title: "Main Gateway",
      } as never),
    ).toThrow("Gateway name must be a valid DNS label in lowercase")
  })

  test("rejects empty gateway title", () => {
    expect(() =>
      assertValidGatewayRequest({
        name: "gateway-main",
        title: "   ",
      } as never),
    ).toThrow("Gateway title is required")
  })
})
