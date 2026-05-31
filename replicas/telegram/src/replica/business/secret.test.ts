import type { CoreV1Api } from "@kubernetes/client-node"
import { describe, expect, test } from "bun:test"
import { mockDeepFn } from "@reside/common/testing"
import { loadTelegramSecretState, TELEGRAM_SECRET_NAME } from "./secret"

describe("loadTelegramSecretState", () => {
  test("loads and decodes bot token", async () => {
    const coreApi = mockDeepFn<CoreV1Api>()
    coreApi.readNamespacedSecret.mockResolvedValue({
      metadata: {
        resourceVersion: "1",
      },
      data: {
        bot_token: Buffer.from("my-token", "utf-8").toString("base64"),
      },
    } as never)

    const state = await loadTelegramSecretState(coreApi, "ns")

    expect(state).toEqual({
      resourceVersion: "1",
      botToken: "my-token",
    })

    expect(coreApi.readNamespacedSecret.spy()).toHaveBeenCalledWith({
      name: TELEGRAM_SECRET_NAME,
      namespace: "ns",
    })
  })

  test("returns empty state for missing secret", async () => {
    const coreApi = mockDeepFn<CoreV1Api>()
    coreApi.readNamespacedSecret.mockRejectedValue({
      code: 404,
    })

    const state = await loadTelegramSecretState(coreApi, "ns")

    expect(state).toEqual({
      resourceVersion: undefined,
      botToken: undefined,
    })
  })

  test("rethrows unknown API errors", () => {
    const coreApi = mockDeepFn<CoreV1Api>()
    coreApi.readNamespacedSecret.mockRejectedValue(new Error("boom"))

    expect(loadTelegramSecretState(coreApi, "ns")).rejects.toThrow("boom")
  })
})
