import { describe, expect, test } from "bun:test"
import { TELEGRAM_WEBHOOK_PATH } from "../../definitions"
import { createWebhookUrl } from "./bot-runtime"

describe("createWebhookUrl", () => {
  test("throws when endpoint is empty", () => {
    expect(() => createWebhookUrl("   ")).toThrow(
      "Telegram gateway endpoint is required for webhooks",
    )
  })

  test("builds webhook URL from endpoint", () => {
    const webhookUrl = createWebhookUrl("telegram.example.local")

    expect(webhookUrl).toBe(`https://telegram.example.local${TELEGRAM_WEBHOOK_PATH}`)
  })
})
