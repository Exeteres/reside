import type { Logger } from "pino"
import {
  type ResideTelegramContext,
  recreateLiveMessage,
  sendLiveMessage,
} from "@contracts/telegram.v1"
import { Composer } from "grammy"
import { getOrCreatePadoruConfig, type PadoruRoot } from "./config"
import { renderPadoruMessage } from "./ui"
import { stickers } from "./stickers"

export function createComposer(root: PadoruRoot, logger: Logger): Composer<ResideTelegramContext> {
  const composer = new Composer<ResideTelegramContext>()

  composer.command("padoru", async ctx => {
    const config = await getOrCreatePadoruConfig(root, ctx.chat.id)
    const padoruMessage = renderPadoruMessage(config)

    const newTemplate = ctx.message?.text?.split(" ").slice(1).join(" ")
    if (newTemplate) {
      logger.info("updating padoru template for chat %s", ctx.chat.id)

      config.$jazz.set("template", newTemplate)
    }

    if (config.message) {
      logger.info("recreating live message for chat %s", ctx.chat.id)

      await recreateLiveMessage(config.message, padoruMessage, ctx.api, logger)
    } else {
      logger.info("sending new live message for chat %s", ctx.chat.id)

      const message = await sendLiveMessage(ctx.chat.id, padoruMessage, ctx.api)
      config.$jazz.set("message", message)
    }

    // pin the message
    try {
      await ctx.api.pinChatMessage(ctx.chat.id, config.message!.message.message_id)
    } catch (err) {
      logger.error({ err }, "failed to pin message in chat %s", ctx.chat.id)

      await ctx.reply(
        "Failed to pin the message. Please make sure I have the permission to pin messages.",
      )
    }

    if (newTemplate) {
      await ctx.reply("Padoru template updated!")
    } else {
      await ctx.reply("Padoru is ACTIVE!")
    }

    await ctx.replyWithSticker(stickers.soon)
  })

  composer.command("padoru_update_celebrant", async ctx => {
    const args = ctx.message?.text?.split(" ").slice(1)
    if (!args || args.length !== 2) {
      await ctx.reply("Usage: /padoru_update_celebrant <name> <tz offset in hours>")
      return
    }

    const [name, tzOffsetStr] = args as [string, string]
    const tzOffset = parseInt(tzOffsetStr, 10)
    if (Number.isNaN(tzOffset) || tzOffset < -12 || tzOffset > 14) {
      await ctx.reply("Invalid timezone offset. It should be a number between -12 and 14.")
      return
    }

    const config = await getOrCreatePadoruConfig(root, ctx.chat.id)
    config.$jazz.set("celebrants", {
      ...config.celebrants,
      [name]: { offsetHours: tzOffset },
    })

    await ctx.reply(`Updated celebrant "${name}" with timezone offset ${tzOffset}.`)
  })

  composer.command("padoru_update_default_offset", async ctx => {
    const args = ctx.message?.text?.split(" ").slice(1)
    if (!args || args.length !== 1) {
      await ctx.reply("Usage: /padoru_update_default_offset <tz offset in hours>")
      return
    }

    const tzOffsetStr = args[0] as string
    const tzOffset = parseInt(tzOffsetStr, 10)
    if (Number.isNaN(tzOffset) || tzOffset < -12 || tzOffset > 14) {
      await ctx.reply("Invalid timezone offset. It should be a number between -12 and 14.")
      return
    }

    const config = await getOrCreatePadoruConfig(root, ctx.chat.id)
    config.$jazz.set("defaultOffsetHours", tzOffset)

    await ctx.reply(`Updated default timezone offset to ${tzOffset}.`)
  })

  return composer
}
