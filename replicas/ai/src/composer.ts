import type { ResideTelegramContext } from "@contracts/telegram.v1"
import type { Logger } from "pino"
import type { AIService } from "./service"
import { Composer } from "grammy"

export function createComposer(ai: AIService, logger: Logger): Composer<ResideTelegramContext> {
  const composer = new Composer<ResideTelegramContext>()

  composer.command("ask", async ctx => {
    if (!ai.enabled) {
      logger.warn("AI service is not enabled, cannot process /ask command")
      await ctx.reply("AI service is not configured")
      return
    }

    const result = await ai.ask(ctx.msg.text)

    await ctx.reply(result, {
      parse_mode: "Markdown",
      reply_parameters: { message_id: ctx.msg.message_id },
    })
  })

  return composer
}
