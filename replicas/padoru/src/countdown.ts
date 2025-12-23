import type { Api } from "grammy"
import type { Logger } from "pino"
import type { PadoruRoot } from "./config"
import { updateLiveMessage } from "@contracts/telegram.v1"
import { stickers } from "./stickers"
import { hoursInMs, renderPadoruMessage } from "./ui"

export async function startCountdown(root: PadoruRoot, api: Api, logger: Logger): Promise<void> {
  const loadedRoot = await root.$jazz.ensureLoaded({
    resolve: { configs: { $each: { message: true } } },
  })

  let currentConfigs = loadedRoot.configs
  loadedRoot.$jazz.subscribe(root => {
    currentConfigs = root.configs
  })

  setInterval(async () => {
    // only run handler for every zero second of each minute
    const now = new Date()
    if (now.getSeconds() !== 0) {
      return
    }

    const newYearDate = new Date(new Date().getFullYear(), 0, 1)

    for (const [chatId, config] of Object.entries(currentConfigs ?? {})) {
      if (!config.message) {
        logger.warn(`no live message for chat %s`, chatId)
        continue
      }

      logger.debug(`updating live message for chat %s`, chatId)

      const padoruMessage = renderPadoruMessage(config)
      updateLiveMessage(config.message, padoruMessage, api, logger)

      // send boom for all celebrants at new year with matching timezone
      const matchingCelebrants = Object.entries(config.celebrants).filter(([, celebrant]) => {
        const celebrantOffsetMs = celebrant.offsetHours
          ? celebrant.offsetHours * hoursInMs
          : config.defaultOffsetHours * hoursInMs

        const celebrantNow = new Date(now.getTime() + celebrantOffsetMs)
        return (
          celebrantNow.getMonth() === newYearDate.getMonth() &&
          celebrantNow.getDate() === newYearDate.getDate() &&
          celebrantNow.getHours() === 0 &&
          celebrantNow.getMinutes() === 0
        )
      })

      if (!matchingCelebrants.length) {
        continue
      }

      logger.info(`sending boom for ${matchingCelebrants.length} celebrants in chat %s`, chatId)

      // send message and stickers
      let message = matchingCelebrants.map(([username]) => username).join(", ")
      message += " IT'S PADORU TIME! 🎉🎉🎉"

      await api.sendMessage(Number(chatId), message)

      for (const stickerId of stickers.boom) {
        await api.sendSticker(Number(chatId), stickerId)
      }
    }
  }, 1000)
}
