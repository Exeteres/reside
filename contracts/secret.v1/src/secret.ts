import type { SecretData } from "./contract"
import { box, LocalizedDisplayInfo, loadBoxed, typedJson } from "@reside/shared"
import { type Account, co, z } from "jazz-tools"

export type SecretDefinition = co.loaded<typeof SecretDefinition>
export type ManagedSecret = co.loaded<typeof ManagedSecret>
export type SecretValueBox<TValue = unknown> = co.loaded<ReturnType<typeof SecretValueBox<TValue>>>

export function SecretValueBox<TValue>() {
  return co.map({
    /**
     * The value of the secret.
     */
    value: typedJson<TValue>(),
  })
}

export const SecretDefinition = co.map({
  /**
   * The display information for the secret.
   */
  displayInfo: LocalizedDisplayInfo.optional(),

  /**
   * The JSON schema of the secret's value.
   *
   * Must be an object schema.
   */
  schema: typedJson<z.z.core.JSONSchema.ObjectSchema>().optional(),
})

export const ManagedSecret = co.map({
  /**
   * The unique sequential ID of this secret.
   */
  id: z.number(),

  /**
   * The unique name of this secret within the Secret Replica.
   */
  name: z.string(),

  /**
   * The definition of this secret writable by accounts with `definition:manage` permission.
   */
  definition: SecretDefinition,

  /**
   * The value box of this secret.
   */
  value: SecretValueBox(),

  /**
   * The owner account of this secret.
   *
   * Sets to the account first creating the secret.
   */
  owner: co.account(),
})

/**
 * Returns the managed secret with the given name, creating it if it does not exist.
 *
 * @param data The secret contract data.
 * @param name The name of the secret to retrieve or create.
 * @param owner The owner account for the new managed secret.
 */
export async function getOrCreateManagedSecret(
  data: SecretData,
  name: string,
  owner: Account,
): Promise<ManagedSecret> {
  const secret = await getManagedSecretByName(data, name)
  if (secret) {
    return secret
  }

  const loadedData = await data.$jazz.ensureLoaded({
    resolve: { secrets: true, allValueGroup: true },
  })

  const newSecret = ManagedSecret.create({
    id: loadedData.secrets.length + 1,
    name,
    definition: SecretDefinition.create({}),
    value: SecretValueBox().create({ value: {} }),
    owner,
  })

  // create index to lookup by name
  box(ManagedSecret).create(
    { value: newSecret },
    {
      owner: data.$jazz.owner,
      unique: `secret.by-name.${name}`,
    },
  )

  // create index to lookup by id
  box(ManagedSecret).create(
    { value: newSecret },
    {
      owner: data.$jazz.owner,
      unique: `secret.by-id.${newSecret.id}`,
    },
  )

  // allow accounts with "definition:read:all" permission to read the secret and its definition
  newSecret.definition.$jazz.owner.addMember(loadedData.secrets.$jazz.owner, "reader")

  // inherit permissions for value group ("value:read:all" and "value:write:all")
  newSecret.value.$jazz.owner.addMember(loadedData.allValueGroup) // may be both: reader and writer

  // inherit read access from definition and value to the secret itself
  newSecret.$jazz.owner.addMember(newSecret.definition.$jazz.owner, "reader")
  newSecret.$jazz.owner.addMember(newSecret.value.$jazz.owner, "reader")

  // add to the list of secrets
  loadedData.secrets.$jazz.push(newSecret)

  return newSecret
}

/**
 * Returns the managed secret with the given name, or null if not found.
 *
 * @param data The secret contract data.
 * @param name The name of the managed secret to retrieve.
 */
export async function getManagedSecretByName(
  data: SecretData,
  name: string,
): Promise<ManagedSecret | null> {
  return await loadBoxed(
    ManagedSecret,
    `secret.by-name.${name}`,
    data.$jazz.owner.$jazz.id,
    data.$jazz.loadedAs,
  )
}

/**
 * Returns the managed secret with the given ID, or null if not found.
 *
 * @param data The secret contract data.
 * @param id The ID of the managed secret to retrieve.
 */
export async function getManagedSecretById(
  data: SecretData,
  id: number,
): Promise<ManagedSecret | null> {
  return await loadBoxed(
    ManagedSecret,
    `secret.by-id.${id}`,
    data.$jazz.owner.$jazz.id,
    data.$jazz.loadedAs,
  )
}
