/** biome-ignore-all lint/suspicious/noExplicitAny: to simplify types */

import {
  type Account,
  type AnonymousJazzAgent,
  type BaseAccountShape,
  type CoValue,
  type CoValueClassOrSchema,
  co,
  type Group,
  type MaybeLoaded,
  type NotLoaded,
  z,
} from "jazz-tools"

/**
 * Creates a Jazz-compatible type for non-validated JSON data.
 */
export function typedJson<T>(): z.z.ZodCodec<z.z.ZodJSONSchema, z.z.ZodCustom<T>> {
  return z.codec(z.json(), z.z.custom<T>(), {
    encode: (data: T) => data as z.z.core.util.JSONType,
    decode: data => data as T,
  })
}

/**
 * The simple wrapper for covalues.
 * Used to separate the owner of the box + the owner of the value mostly for indexing purposes.
 *
 * @param schema The schema of the value to box.
 * @returns The boxed schema.
 */
export function box<T extends CoValueClassOrSchema>(schema: T) {
  return co.map({ value: schema })
}

/**
 * Adds the given value to the index list if not already present.
 *
 * @param schema The schema of the value.
 * @param value The value to add.
 * @param listId The unique ID of the index list.
 * @param listOwner The owner group of the index list.
 */
export async function addToIndexList<T extends BaseAccountShape["root"]>(
  schema: T,
  value: co.loaded<T>,
  listId: string,
  listOwner: Group,
): Promise<void> {
  const listSchema = co.list(schema)
  const existingList = await listSchema.loadUnique(listId, listOwner.$jazz.id, {
    loadAs: listOwner.$jazz.loadedAs,
    // @ts-expect-error too complex generic type
    resolve: { $each: true },
  })

  if (existingList.$jazz.loadingState === "unavailable") {
    // create new list with the value
    listSchema.create([value as any], { unique: listId, owner: listOwner })
    return
  }

  if (!existingList.$isLoaded) {
    throw new Error(
      `Unexpected loading state for index list "${listId}": ${existingList.$jazz.loadingState}`,
    )
  }

  const exists = existingList.some(item => item?.$jazz.id === value.$jazz.id)
  if (exists) {
    return
  }

  // add to existing list
  existingList.$jazz.push(value as any)
}

export async function loadBoxed<T extends CoValueClassOrSchema>(
  schema: T,
  boxId: string,
  boxOwnerId: string,
  loadAs: Account | AnonymousJazzAgent,
): Promise<co.loaded<T> | null> {
  const loadedBox = await box(schema).loadUnique(boxId, boxOwnerId, {
    loadAs,
    // @ts-expect-error too complex generic type
    resolve: { value: true },
  })

  return loadedBox.$isLoaded ? (loadedBox.value as co.loaded<T>) : null
}

/**
 * Asserts that the given value is loaded. Throws an error if not.
 *
 * @param value The value to check.
 */
export function assertLoaded<T extends CoValue>(
  value: MaybeLoaded<T>,
): asserts value is Exclude<T, NotLoaded<T> | undefined> {
  if (!value.$isLoaded) {
    throw new Error(`Unexpected unloaded value. The loading state is ${value.$jazz.loadingState}`)
  }
}
