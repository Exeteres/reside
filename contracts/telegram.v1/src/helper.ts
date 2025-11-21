import type { TelegramHandlerContract } from "@contracts/telegram-handler.v1"
import type { Update } from "grammy/types"
import type { z } from "jazz-tools"
import type { Logger } from "pino"
import type { TelegramContract } from "./contract"
import { Readable } from "node:stream"
import {
  createSubstitutor,
  errorToString,
  type Implementation,
  type LocalizedDisplayInfo,
  type PermissionRequirement,
  type Requirement,
} from "@reside/shared"
import { Api, type Composer } from "grammy"
import { ResideTelegramContext } from "./context"
import { getManagedHandlerByName } from "./handler"

export type HandlerOptions = {
  /**
   * The name pattern of the handler.
   *
   * Can contain "{replica.name}" placeholder which will be replaced with replica name.
   *
   * If not provided, defaults to "{replica.name}".
   */
  name?: string

  /**
   * The list of update types this handler is interested in.
   *
   * If empty, no events will be sent to this handler.
   */
  allowedUpdates: Exclude<keyof Update, "update_id">[]

  /**
   * The display information for the handler.
   *
   * The key is BCP 47 language tag (e.g., "en", "fr", "de") and the value is the display information in that language.
   */
  displayInfo: LocalizedDisplayInfo
}

export type HandlerFunction<TAllowedUpdate extends z.z.ZodType> = (
  update: z.infer<TAllowedUpdate>,
) => Promise<void>

export type HandlerContext = {
  /**
   * The method to update the handler definition based on the options provided.
   * Also starts the handler processing loop using the provided composer.
   *
   * Must be called once at the replica startup.
   *
   * @param telegram The Telegram requirement instance to register the handler with.
   * @param telegramHandler The Telegram handler implementation instance.
   * @param replicaName The name of the current replica.
   * @param composer The composer instance to use for handling updates.
   * @param logger The logger instance to use for logging.
   */
  init(
    telegram: Requirement<TelegramContract>,
    telegramHandler: Implementation<TelegramHandlerContract>,
    replicaName: string,
    composer: Composer<ResideTelegramContext>,
    logger: Logger,
  ): Promise<void>

  /**
   * The static permission requirement for setting up the handler.
   */
  permission: PermissionRequirement<TelegramContract, "handler:setup">
}

/**
 * Defines a handler to interact with Telegram bot via Telegram Replica.
 *
 * @param options The options for the handler.
 * @returns The handler context.
 */
export function defineHandler(options: HandlerOptions): HandlerContext {
  const handlerNamePattern = options.name ?? "{replica.name}"

  return {
    init: async (telegram, telegramHandler, replicaName, composer, logger) => {
      // create proxy for api calls
      const api = new Api("", {
        // @ts-expect-error: maybe fix later
        fetch: async (url, init) => {
          const parsedUrl = new URL(url as string)
          const methodName = parsedUrl.pathname.split("/").pop()

          if (!methodName) {
            throw new Error(`Invalid URL for Telegram Bot API: ${url}`)
          }

          let body: string | undefined
          let bodyType: "json" | "base64"

          if (init!.body instanceof Readable) {
            const chunks: Uint8Array[] = []
            for await (const chunk of init!.body) {
              chunks.push(chunk)
            }

            body = Buffer.concat(chunks).toString("base64")
            bodyType = "base64"
          } else if (typeof init!.body === "string") {
            body = init!.body
            bodyType = "json"
          } else {
            throw new Error("Unsupported body type for Telegram Bot API request")
          }

          const response = await telegram.callBotApi({
            methodName,
            headers: init!.headers as Record<string, string>,
            bodyType,
            body,
          })

          return {
            json: () => response.result,
          }
        },
      })

      const middleware = composer.middleware()

      const substitutor = createSubstitutor({
        "replica.name": replicaName,
      })

      const handlerName = substitutor(handlerNamePattern)

      // setup the handler
      telegramHandler.handleHandleUpdate(async ({ update, user }, madeBy) => {
        if (madeBy.$jazz.id !== telegram.accountId) {
          throw new Error("Unathorized: update request made by unknown account")
        }

        if (!telegram.data.me) {
          throw new Error("Telegram bot is not initialized: bot info is missing")
        }

        const context = new ResideTelegramContext(update, api, telegram.data.me, user)

        try {
          let next = false

          await middleware(context, () => {
            next = true
            return Promise.resolve()
          })

          return { handled: !next }
        } catch (err) {
          logger.error({ err }, "failed to process update %d", update.update_id)

          throw new Error(`Failed to process update: ${errorToString(err)}`)
        }
      })

      // update the handler
      const handler = await getManagedHandlerByName(telegram.data, handlerName)
      if (!handler) {
        throw new Error(`Failed to find managed handler with name "${handlerName}"`)
      }

      const loadedHandler = await handler.$jazz.ensureLoaded({
        resolve: { definition: true },
      })

      if (
        JSON.stringify(loadedHandler.definition.allowedUpdates) !==
        JSON.stringify(options.allowedUpdates)
      ) {
        loadedHandler.definition.$jazz.set("allowedUpdates", options.allowedUpdates)
      }

      if (
        JSON.stringify(loadedHandler.definition.displayInfo) !== JSON.stringify(options.displayInfo)
      ) {
        loadedHandler.definition.$jazz.set("displayInfo", options.displayInfo)
      }

      // mark handler as ready to receive updates
      if (!loadedHandler.definition.enabled) {
        loadedHandler.definition.$jazz.set("enabled", true)
      }

      process.on("beforeExit", () => {
        // disable the handler on replica shutdown
        // this will not always be called (e.g., in case of crash), but it's better than nothing
        // Telegram Replica will also disable handlers that do not respond for a while
        if (loadedHandler.definition.enabled) {
          loadedHandler.definition.$jazz.set("enabled", false)
        }
      })

      logger.info(`telegram handler "%s" initialized`, handlerName)
    },

    permission: {
      name: "handler:setup",
      params: { name: handlerNamePattern },
    },
  }
}
