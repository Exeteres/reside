import { describe, expect, it, mock } from "bun:test"

const sendNotification = mock(async () => {
  return {
    notificationId: "notification-id",
  }
})

const fetchKeyRate = mock(async () => 21)

mock.module("@reside/common/workflow", () => {
  return {
    defineCommand: <T>(definition: T) => definition,
    defineCommandHandler: <T>(definition: T) => definition,
    sendNotification,
  }
})

mock.module("@temporalio/workflow", () => {
  return {
    proxyActivities: () => ({
      fetchKeyRate,
    }),
  }
})

describe("rateCommandHandler", () => {
  it("sends notification with current key rate", async () => {
    const { rateCommandHandler } = await import("./rate")

    await rateCommandHandler.handler({
      definition: rateCommandHandler.command,
      invocation: {
        invocationId: "id",
        subjectId: "subject",
        parameters: {},
      },
      params: {},
    })

    expect(fetchKeyRate).toHaveBeenCalledTimes(1)
    expect(sendNotification).toHaveBeenCalledTimes(1)
    expect(sendNotification).toHaveBeenCalledWith({
      channel: "rate:rate",
      title: "Ключевая ставка ЦБ РФ: 21%",
    })
  })

  it("sends failure notification when key rate cannot be fetched", async () => {
    fetchKeyRate.mockImplementationOnce(async () => {
      throw new Error("boom")
    })

    const { rateCommandHandler } = await import("./rate")

    await rateCommandHandler.handler({
      definition: rateCommandHandler.command,
      invocation: {
        invocationId: "id-2",
        subjectId: "subject",
        parameters: {},
      },
      params: {},
    })

    expect(sendNotification).toHaveBeenCalledWith({
      channel: "rate:rate",
      title: "Не удалось получить ключевую ставку",
    })
  })
})
