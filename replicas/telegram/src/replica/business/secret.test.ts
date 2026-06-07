import type { ResideCrypto } from "@reside/common/encryption"
import { describe, expect, test } from "bun:test"
import { mockDeepFn } from "@reside/common/testing"
import { loadTelegramSecretState, TELEGRAM_BOT_TOKEN_SECRET_KEY } from "./secret"

describe("loadTelegramSecretState", () => {
  test("loads bot token", async () => {
    const crypto = mockDeepFn<ResideCrypto>()
    crypto.getSecret.mockResolvedValue("my-token")

    const state = await loadTelegramSecretState(crypto)

    expect(state).toEqual({
      botToken: "my-token",
    })

    expect(crypto.getSecret.spy()).toHaveBeenCalledWith(TELEGRAM_BOT_TOKEN_SECRET_KEY)
  })

  test("rethrows secret loading errors", () => {
    const crypto = mockDeepFn<ResideCrypto>()
    crypto.getSecret.mockRejectedValue(new Error("boom"))

    expect(loadTelegramSecretState(crypto)).rejects.toThrow("boom")
  })
})
