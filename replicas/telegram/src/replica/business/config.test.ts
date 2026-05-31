import type { CoreV1Api } from "@kubernetes/client-node"
import { describe, expect, test } from "bun:test"
import { mockDeepFn } from "@reside/common/testing"
import {
  loadTelegramConfigState,
  TELEGRAM_CONFIG_MAP_NAME,
  TELEGRAM_SUPER_ADMIN_USER_ID_KEY,
  TELEGRAM_SYSTEM_CHAT_ID_KEY,
} from "./config"

describe("loadTelegramConfigState", () => {
  test("loads and trims config values", async () => {
    const coreApi = mockDeepFn<CoreV1Api>()
    coreApi.readNamespacedConfigMap.mockResolvedValue({
      metadata: {
        resourceVersion: "123",
      },
      data: {
        [TELEGRAM_SYSTEM_CHAT_ID_KEY]: "  chat-1  ",
        [TELEGRAM_SUPER_ADMIN_USER_ID_KEY]: "  42  ",
      },
    } as never)

    const state = await loadTelegramConfigState(coreApi, "ns")

    expect(state).toEqual({
      resourceVersion: "123",
      systemChatId: "chat-1",
      superAdminUserId: "42",
    })

    expect(coreApi.readNamespacedConfigMap.spy()).toHaveBeenCalledWith({
      name: TELEGRAM_CONFIG_MAP_NAME,
      namespace: "ns",
    })
  })

  test("returns empty state for missing config map", async () => {
    const coreApi = mockDeepFn<CoreV1Api>()
    coreApi.readNamespacedConfigMap.mockRejectedValue({
      statusCode: 404,
    })

    const state = await loadTelegramConfigState(coreApi, "ns")

    expect(state).toEqual({
      resourceVersion: undefined,
      systemChatId: undefined,
      superAdminUserId: undefined,
    })
  })

  test("rethrows unknown API errors", () => {
    const coreApi = mockDeepFn<CoreV1Api>()
    coreApi.readNamespacedConfigMap.mockRejectedValue(new Error("boom"))

    expect(loadTelegramConfigState(coreApi, "ns")).rejects.toThrow("boom")
  })
})
