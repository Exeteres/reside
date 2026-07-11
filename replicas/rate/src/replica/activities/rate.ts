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
      let title: string

      try {
        const result = await services.avatarService.getAvatarChatTitle({
          contextToken: input.contextToken,
        })
        title = result.title
      } catch {
        return {
          updated: false,
        }
      }

      const updatedTitle = replaceSingleRateInTitle(title, input.rate)

      if (updatedTitle === undefined || updatedTitle === title) {
        return {
          updated: false,
        }
      }

      try {
        await services.avatarService.updateAvatarChatTitle({
          contextToken: input.contextToken,
          title: updatedTitle,
        })
      } catch {
        return {
          updated: false,
        }
      }

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
