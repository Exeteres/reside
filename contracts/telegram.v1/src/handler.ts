import type { TelegramData } from "./contract"
import { box, LocalizedDisplayInfo, loadBoxed } from "@reside/shared"
import { type Account, co, z } from "jazz-tools"

export type HandlerDefinition = co.loaded<typeof HandlerDefinition>
export type ManagedHandler = co.loaded<typeof ManagedHandler>

export const HandlerDefinition = co.map({
  /**
   * Whether this handler is enabled.
   */
  enabled: z.boolean(),

  /**
   * The display information about this handler.
   */
  displayInfo: LocalizedDisplayInfo.optional(),

  /**
   * The list of update types this handler is interested in.
   *
   * If empty, no events will be sent to this handler.
   */
  allowedUpdates: z.string().array(),

  /**
   * The URL of the handler endpoint.
   */
  endpoint: z.string().optional(),
})

export const ManagedHandler = co.map({
  /**
   * The unique sequential ID of this handler.
   */
  id: z.number(),

  /**
   * The unique name of this handler within the Telegram Replica.
   */
  name: z.string(),

  /**
   * The definition of this handler writable by the handler owner.
   */
  definition: HandlerDefinition,

  /**
   * The owner account of this handler.
   */
  owner: co.account(),
})

/**
 * Gets the managed handler with the given name, or creates it if it does not exist.
 *
 * @param data The telegram contract data.
 * @param name The name of the managed handler to get or create.
 * @returns The existing or newly created managed handler.
 */
export async function getOrCreateManagedHandler(
  data: TelegramData,
  name: string,
  owner: Account,
): Promise<ManagedHandler> {
  const existing = await getManagedHandlerByName(data, name)

  if (existing) {
    return existing
  }

  const loadedData = await data.$jazz.ensureLoaded({ resolve: { handlers: true } })

  const newHandler = ManagedHandler.create({
    id: loadedData.handlers.length + 1,
    name,
    definition: HandlerDefinition.create({
      enabled: false,
      allowedUpdates: [],
    }),
    owner,
  })

  // create index to lookup by id
  box(ManagedHandler).create(
    { value: newHandler },
    {
      unique: `handler.by-id.${newHandler.id}`,
      owner: data.$jazz.owner,
    },
  )

  // create index to lookup by name
  box(ManagedHandler).create(
    { value: newHandler },
    {
      unique: `handler.by-name.${name}`,
      owner: data.$jazz.owner,
    },
  )

  // allow accounts with "handler:read:all" permission to read the definition
  newHandler.definition.$jazz.owner.addMember(loadedData.handlers.$jazz.owner, "reader")

  // inherit read access from definition
  newHandler.$jazz.owner.addMember(newHandler.definition.$jazz.owner, "reader")

  // add to telegram data handlers list
  loadedData.handlers.$jazz.push(newHandler)

  return newHandler
}

/**
 * Gets the managed handler with the given name.
 *
 * @param data The telegram contract data.
 * @param name The name of the managed handler to get.
 * @returns The managed handler with the given name, or null if it does not exist.
 */
export async function getManagedHandlerByName(
  data: TelegramData,
  name: string,
): Promise<ManagedHandler | null> {
  return await loadBoxed(
    ManagedHandler,
    `handler.by-name.${name}`,
    data.$jazz.owner.$jazz.id,
    data.$jazz.loadedAs,
  )
}

/**
 * Gets the managed handler with the given ID.
 *
 * @param data The telegram contract data.
 * @param id The ID of the managed handler to get.
 * @returns The managed handler with the given ID, or null if it does not exist.
 */
export async function getManagedHandlerById(
  data: TelegramData,
  id: number,
): Promise<ManagedHandler | null> {
  return await loadBoxed(
    ManagedHandler,
    `handler.by-id.${id}`,
    data.$jazz.owner.$jazz.id,
    data.$jazz.loadedAs,
  )
}
