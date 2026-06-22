import type { RateActivities } from "../../definitions"
import { fetchKeyRate, replaceSingleRateInTitle } from "../business"

export function createRateActivities(services: {
  avatarService: RateActivitiesAvatarService
}): RateActivities {
  return {
    async fetchKeyRate() {
      return {
        rate: await fetchKeyRate({
          fetchFn: fetch,
        }),
      }
    },

    async updateChatTitleRate(input) {
      const { title } = await services.avatarService.getAvatarChatTitle({
        contextToken: input.contextToken,
      })
      const updatedTitle = replaceSingleRateInTitle(title, input.rate)

      if (updatedTitle === undefined || updatedTitle === title) {
        return {
          updated: false,
        }
      }

      await services.avatarService.updateAvatarChatTitle({
        contextToken: input.contextToken,
        title: updatedTitle,
      })

      return {
        updated: true,
      }
    },
  }
}

type RateActivitiesAvatarService = {
  getAvatarChatTitle(input: { contextToken: string }): Promise<{ title: string }>
  updateAvatarChatTitle(input: { contextToken: string; title: string }): Promise<unknown>
}
