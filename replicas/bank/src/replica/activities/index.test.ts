import { describe, expect, test } from "bun:test"
import { resolveTelegramRecipient } from "."

describe("resolveTelegramRecipient", () => {
  test("resolves text mention", () => {
    expect(resolveTelegramRecipient("[Пользователь](tg://user?id=123)")).toBe("telegram:123")
  })

  test("resolves username", () => {
    expect(resolveTelegramRecipient("@Some_User")).toBe("telegram:username:some_user")
  })

  test("rejects ambiguous recipient", () => {
    expect(() => resolveTelegramRecipient("??")).toThrow(
      "Recipient must be a Telegram username or mention",
    )
  })
})
