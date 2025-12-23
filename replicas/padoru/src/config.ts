import { LiveMessage } from "@contracts/telegram.v1"
import { co, z } from "jazz-tools"

export type PadoruCelebrant = z.infer<typeof PadoruCelebrant>
export type PadoruConfig = co.loaded<typeof PadoruConfig>
export type PadoruRoot = co.loaded<typeof PadoruRoot>

export const PadoruCelebrant = z.object({
  /**
   * The offset hours from UTC for the celebrant's timezone.
   */
  offsetHours: z.number(),
})

export const PadoruConfig = co
  .map({
    /**
     * The template message for Padoru event.
     *
     * Must contain `{remaining}` placeholder which will be replaced with due date and time.
     */
    template: z.string(),

    /**
     * The ID of the chat where the Padoru event is announced.
     */
    chatId: z.number(),

    /**
     * The message announcing the Padoru event in the chat.
     */
    message: LiveMessage.optional(),

    /**
     * The default offset hours from UTC for celebrants without a specified timezone.
     */
    defaultOffsetHours: z.number(),

    /**
     * The map of celebrants for Padoru event.
     *
     * The username is the key, and the celebrant details is the value.
     */
    celebrants: z.record(z.string(), PadoruCelebrant),
  })
  .resolved({ message: true })

export const PadoruRoot = co.map({
  configs: co.record(z.string(), PadoruConfig).optional(),
})

/**
 * Retrieves the Padoru configuration for a specific chat.
 * If no configuration exists, a new one with default values is created.
 *
 * @param root The private data of the Padoru Replica.
 * @param chatId The Telegram chat ID.
 * @returns The existing or newly created Padoru configuration.
 */
export async function getOrCreatePadoruConfig(
  root: PadoruRoot,
  chatId: number,
): Promise<PadoruConfig> {
  const loadedRoot = await root.$jazz.ensureLoaded({
    resolve: { configs: { $each: { message: true } } },
  })

  if (!loadedRoot.configs) {
    loadedRoot.$jazz.set("configs", {})
  }

  const config = loadedRoot.configs![chatId.toString()]
  if (config) {
    return config
  }

  // create new config with default values
  loadedRoot.configs!.$jazz.set(chatId.toString(), {
    template: "Padoru in {remaining}!",
    chatId,
    defaultOffsetHours: 0,
    celebrants: {},
  })

  return loadedRoot.configs![chatId.toString()]!
}

/**
 * Retrieves all Padoru configurations stored in the root.
 *
 * @param root The private data of the Padoru Replica.
 * @returns A record mapping chat IDs to their respective Padoru configurations.
 */
export async function getAllPadoruConfigs(root: PadoruRoot): Promise<Record<string, PadoruConfig>> {
  const loadedRoot = await root.$jazz.ensureLoaded({
    resolve: { configs: { $each: { message: true } } },
  })

  return loadedRoot.configs ?? {}
}
