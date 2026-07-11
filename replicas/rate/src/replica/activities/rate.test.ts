import { describe, expect, it } from "bun:test"
import { createRateActivities } from "./rate"

describe("createRateActivities", () => {
  it("returns false when chat title update fails", async () => {
    const activities = createRateActivities({
      avatarService: {
        async getAvatarChatTitle() {
          return {
            title: "Ключевая ставка 13%",
          }
        },
        async updateAvatarChatTitle() {
          throw new Error("telegram unavailable")
        },
      },
    })

    const result = await activities.updateChatTitleRate({
      contextToken: "token",
      rate: 14.25,
    })

    expect(result.updated).toBe(false)
  })
})
