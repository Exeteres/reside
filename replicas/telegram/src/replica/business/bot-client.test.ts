import { describe, expect, mock, test } from "bun:test"

const botConstructor = mock((token: string) => ({
  token,
  api: {
    config: {
      use: mock((_middleware: unknown) => {}),
    },
    sendMessage: mock(() => {}),
  },
}))

mock.module("grammy", () => ({
  Bot: botConstructor,
}))

const { createTelegramBotClient } = await import("./bot-client")

describe("createTelegramBotClient", () => {
  test("creates telegram bot client via mocked grammy constructor", () => {
    const bot = createTelegramBotClient("123:abc", {
      role: "test",
    })

    expect(botConstructor).toHaveBeenCalledTimes(1)
    expect(botConstructor).toHaveBeenCalledWith("123:abc")
    expect(typeof bot.api.sendMessage).toBe("function")
    expect(bot.api.config.use).toHaveBeenCalledTimes(1)
  })
})
