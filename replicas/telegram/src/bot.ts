import type { TelegramData } from "@contracts/telegram.v1"
import type { Logger } from "pino"
import { TelegramHandlerContract, type TelegramUser } from "@contracts/telegram-handler.v1"
import { createRequirement } from "@reside/shared"
import { Bot } from "grammy"
import { getOrCreateTelegramUser } from "./user"

export async function setupTelegramBot(
  telegramData: TelegramData,
  botToken: string,
  logger: Logger,
): Promise<Bot> {
  const bot = new Bot(botToken)

  await bot.init()

  telegramData.$jazz.set("me", bot.botInfo)

  logger.info(`initialized Telegram bot @%s (id: %d)`, bot.botInfo.username, bot.botInfo.id)

  const loadedTelegramData = await telegramData.$jazz.ensureLoaded({
    resolve: {
      handlers: { $each: { definition: true, owner: true } },
    },
  })

  let handlers = loadedTelegramData.handlers.filter(handler => handler.definition.enabled)

  loadedTelegramData.handlers.$jazz.subscribe(newHandlers => {
    handlers = newHandlers.filter(handler => handler.definition.enabled)

    logger.info("updated Telegram handlers, %d enabled", handlers.length)
  })

  bot.use(async (ctx, next) => {
    let user: TelegramUser | undefined

    if (ctx.from) {
      user = await getOrCreateTelegramUser(telegramData, ctx.from)
    }

    try {
      for (const handler of handlers) {
        if (!handler.definition.endpoint) {
          logger.warn('skipping handler "%s" as it does not have an endpoint defined', handler.name)
          continue
        }

        // TODO: in the future such undeclared communication will be forbidden by network policies
        const requirement = await createRequirement(
          TelegramHandlerContract,
          handler.owner.$jazz.id,
          handler.definition.endpoint,
        )

        if (user && !user.$jazz.owner.getRoleOf(handler.owner.$jazz.id)) {
          // ensure that handler owner can read the particular user
          // this way we lazyly grant access only to handlers that actually process updates from the user
          user.$jazz.owner.addMember(handler.owner, "reader")
        }

        try {
          const { handled } = await requirement.handleUpdate({ update: ctx.update, user })

          if (handled) {
            logger.debug(
              'update handled by handler "%s", stopping further processing',
              handler.name,
            )
            return
          }
        } catch (err) {
          logger.error(
            { err },
            'error invoking handler "%s" for update, continuing to next handler',
            handler.name,
          )
        }
      }
    } finally {
      await next()
    }
  })

  bot.start().catch(err => {
    logger.error({ err }, "bot polling failed")
    throw err
  })

  return bot
}
