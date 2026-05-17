import { describe, expect, it, mock } from "bun:test"

const sendNotification = mock(async () => {
  return {
    notificationId: "notification-id",
  }
})

mock.module("@reside/common/workflow", () => {
  return {
    defineCommand: <T>(definition: T) => definition,
    defineCommandHandler: <T>(definition: T) => definition,
    sendNotification,
  }
})

describe("helloCommandHandler", () => {
  it("sends deterministic hi response", async () => {
    const { helloCommandHandler } = await import("./hello")

    await helloCommandHandler.handler({
      definition: helloCommandHandler.command,
      invocation: {
        invocationId: "id",
        subjectId: "subject",
        parameters: {},
      },
      params: {},
    })

    expect(sendNotification).toHaveBeenCalledTimes(1)
    expect(sendNotification).toHaveBeenCalledWith({
      title: "hi",
      channel: "hello:hello",
    })
  })
})
