import type { Logger } from "pino"
import { AlphaContract, getReplicaById } from "@contracts/alpha.v1"
import { type ResideTelegramContext, TelegramRealm } from "@contracts/telegram.v1"
import { createRequirement } from "@reside/shared"
import { Composer, InlineKeyboard } from "grammy"
import { drawReplicaGraph } from "./graph"
import { renderReplica, renderReplicaListKeyboard } from "./replica-ui"

export function createComposer(alphaAccountId: string, _logger: Logger) {
  const composer = new Composer<ResideTelegramContext>()

  composer.command("replicas", async ctx => {
    const loadedUser = await ctx.user!.$jazz.ensureLoaded({ resolve: { user: true } })

    await TelegramRealm.impersonate(loadedUser.user, async account => {
      const alpha = await createRequirement(AlphaContract, alphaAccountId, account)

      const loadedAlpha = await alpha.data.$jazz.ensureLoaded({
        resolve: {
          replicas: { $onError: "catch" },
        },
      })

      if (!loadedAlpha.replicas.$isLoaded) {
        await ctx.reply("У вас нету доступа к списку реплик.")
        return
      }

      const keyboard = await renderReplicaListKeyboard(alpha.data, ctx.from?.language_code)
      const graph = await drawReplicaGraph(alpha.data, ctx.from?.language_code)

      await ctx.replyWithPhoto(graph, {
        reply_markup: keyboard,
        caption: "📚 Список реплик",
        show_caption_above_media: true,
      })
    })
  })

  composer.callbackQuery(/^alpha:replica:(\d+)$/, async ctx => {
    const loadedUser = await ctx.user!.$jazz.ensureLoaded({ resolve: { user: true } })

    await TelegramRealm.impersonate(loadedUser.user, async account => {
      const alpha = await createRequirement(AlphaContract, alphaAccountId, account)

      const replicaId = Number(ctx.match[1])
      const replica = await getReplicaById(alpha.data, replicaId)

      if (!replica) {
        await ctx.answerCallbackQuery({ text: "Реплика не найдена!", show_alert: true })
        return
      }

      const inlineKeyboard = new InlineKeyboard()
        //
        .text("Назад", "alpha:replicas")

      const rendered = await renderReplica(replica, ctx.from.language_code)

      await ctx.editMessageMedia({
        type: "photo",
        media: `https://github.com/exeteres/reside/raw/main/replicas/${replica.info.name}/REPLICA.png`,
        caption: rendered.value,
        parse_mode: "HTML",
      })

      await ctx.editMessageReplyMarkup({ reply_markup: inlineKeyboard })
    })
  })

  composer.callbackQuery("alpha:replicas", async ctx => {
    const loadedUser = await ctx.user!.$jazz.ensureLoaded({ resolve: { user: true } })

    await TelegramRealm.impersonate(loadedUser.user, async account => {
      const alpha = await createRequirement(AlphaContract, alphaAccountId, account)

      const keyboard = await renderReplicaListKeyboard(alpha.data, ctx.from?.language_code)
      const graph = await drawReplicaGraph(alpha.data, ctx.from?.language_code)

      await ctx.editMessageMedia({
        type: "photo",
        media: graph,
        caption: "📚 Список реплик",
        parse_mode: "HTML",
        show_caption_above_media: true,
      })

      await ctx.editMessageReplyMarkup({ reply_markup: keyboard })
    })
  })

  return composer
}
