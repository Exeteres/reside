import type { ResideTelegramContext } from "@contracts/telegram.v1"
import type { Logger } from "pino"
import { Composer } from "grammy"

export function createComposer(logger: Logger): Composer<ResideTelegramContext> {
  const composer = new Composer<ResideTelegramContext>()

  composer.on("message", async (ctx, next) => {
    if (ctx.message.text !== "/silly") {
      return await next()
    }

    const message = await ctx.reply("yes, im silly 🤪 1234567")

    logger.info("replied to silly command, message id: %s", message.message_id)
  })

  return composer
}
