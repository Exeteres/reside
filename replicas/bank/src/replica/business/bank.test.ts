import { describe, expect, test } from "bun:test"
import { resolveRecipientSubjectId } from "./bank"

describe("resolveRecipientSubjectId", () => {
  test("resolves username", () => {
    expect(resolveRecipientSubjectId("@SomeUser")).toBe("telegram:someuser")
  })

  test("resolves mention", () => {
    expect(resolveRecipientSubjectId("tg:user:12345")).toBe("telegram:12345")
  })

  test("rejects invalid recipient", () => {
    expect(() => resolveRecipientSubjectId("not valid")).toThrow()
  })
})
