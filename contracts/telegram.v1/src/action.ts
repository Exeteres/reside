import type { Composer } from "grammy"
import type { InlineKeyboardButton } from "grammy/types"
import type { Logger } from "pino"
import type { ResideTelegramContext } from "./context"
import type { HandlerContext } from "./helper"
import { type CoValueClassOrSchema, co, z } from "jazz-tools"

export function ActionInstance<TPayloadSchema extends CoValueClassOrSchema>(
  payload: TPayloadSchema,
) {
  return co.map({
    handlerId: z.string(),
    payload,
  })
}

export type ActionInstance<TPayloadSchema extends CoValueClassOrSchema> = co.loaded<
  ReturnType<typeof ActionInstance<TPayloadSchema>>
>

export type ActionDefinition<TPayloadSchema extends CoValueClassOrSchema> = {
  register: (composer: Composer<ResideTelegramContext>, logger: Logger) => void

  createButton: (
    handler: HandlerContext,
    payload: z.infer<TPayloadSchema>,
    text?: string | Record<string, string>,
    locale?: string,
  ) => InlineKeyboardButton
}

export type ActionHandler<TPayloadSchema extends CoValueClassOrSchema> = (
  payload: co.loaded<TPayloadSchema>,
) => Promise<void>

export type ActionOptions<TPayloadSchema extends CoValueClassOrSchema> = {
  payload: TPayloadSchema
  handler: ActionHandler<TPayloadSchema>

  getButtonText?: (payload: z.infer<TPayloadSchema>) => Record<string, string>
}

export function defineAction<TPayloadSchema extends CoValueClassOrSchema>(
  options: ActionOptions<TPayloadSchema>,
): ActionDefinition<TPayloadSchema> {
  const actionType = ActionInstance(options.payload)

  return {
    register: (composer, logger) => {
      composer.use(async (ctx, next) => {
        if (!ctx.callbackQuery?.data || !ctx.callbackQuery.data.startsWith("co_z")) {
          return await next()
        }

        const instance = await actionType.load(ctx.callbackQuery.data, {
          // @ts-expect-error jazz moment
          resolve: { payload: true },
        })

        if (!instance.$isLoaded) {
          logger.warn(
            `failed to load action instance with ID "%s": %s`,
            ctx.callbackQuery.data,
            instance.$jazz.loadingState,
          )

          return await next()
        }

        try {
          await options.handler(instance.payload as co.loaded<TPayloadSchema>)
        } catch (err) {
          logger.error({ err }, `error handling action with ID "%s"`, ctx.callbackQuery.data)
        }
      })
    },

    createButton: (handler, payload, text, locale) => {
      const instance = actionType.create({
        handlerId: handler.id,
        // @ts-expect-error jazz moment
        payload,
      })

      // share action with Telegram Replica
      instance.$jazz.owner.addMember(handler.telegramReplicaAccount, "reader")

      const textProvider = text ?? options.getButtonText?.(payload)
      if (!textProvider) {
        throw new Error("Button text is not provided nor getButtonText function is not defined")
      }

      const resolvedLocale = locale ?? "en"

      const resolvedText =
        typeof textProvider === "string"
          ? textProvider
          : (textProvider[resolvedLocale] ?? textProvider.en)

      if (!resolvedText) {
        throw new Error(`Button text is not available for locale "${resolvedLocale}" or "en"`)
      }

      return {
        text: resolvedText,
        callback_data: instance.$jazz.id,
      }
    },
  }
}
