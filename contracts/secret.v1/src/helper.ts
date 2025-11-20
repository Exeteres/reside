import type { Logger } from "pino"
import type { SecretConract, SecretData } from "./contract"
import { ok } from "node:assert"
import {
  createSubstitutor,
  type LocalizedDisplayInfo,
  type PermissionRequirement,
} from "@reside/shared"
import { z } from "jazz-tools"
import { getManagedSecretByName, type SecretValueBox } from "./secret"

export type SecretOptions<TSchema extends z.z.ZodObject> = {
  /**
   * The name pattern of the secret.
   *
   * Can contain "{replica.name}" placeholder which will be replaced with replica name.
   */
  name: string

  /**
   * The Zod schema of the secret's value.
   */
  schema: TSchema

  /**
   * The display information for the secret.
   *
   * The key is BCP 47 language tag (e.g., "en", "fr", "de") and the value is the display information in that language.
   */
  displayInfo: LocalizedDisplayInfo
}

export type SecretContext<TSchema extends z.z.ZodType> = {
  /**
   * The method to update the secret definition based on the options provided.
   *
   * Must be called once at the replica startup.
   *
   * @param secretData The data of the secret contract.
   * @param replicaName The name of the current replica.
   * @param logger The logger instance to use for logging.
   */
  init(secretData: SecretData, replicaName: string, logger: Logger): Promise<void>

  /**
   * The method to get the current value of the secret.
   *
   * If the secret is not set or access is denied, returns null.
   */
  get(): Promise<z.infer<TSchema> | null>

  /**
   * The method to get the value box of the secret.
   *
   * Can be used to subscribe to secret value changes.
   *
   * Returns null if the secret was not properly initialized or value is invalid.
   */
  getBox(): Promise<SecretValueBox<z.infer<TSchema>> | null>

  /**
   * The method to set the value of the secret.
   *
   * @param value The new value of the secret.
   */
  set(value: z.infer<TSchema>): Promise<void>

  /**
   * The static permission requirements that must be passed to secret contract requirement.
   */
  permissions: {
    /**
     * The permission to allow all secret operations (init, set).
     */
    all: [
      SecretContext<TSchema>["permissions"]["init"],
      SecretContext<TSchema>["permissions"]["readWrite"],
    ]

    /**
     * The permission to manage the secret metadata (definition).
     */
    init: PermissionRequirement<SecretConract, "definition:manage">

    /**
     * The permission to read the secret value.
     */
    read: PermissionRequirement<SecretConract, "value:read">

    /**
     * The permission to read and write the secret value.
     */
    readWrite: PermissionRequirement<SecretConract, "value:read-write">
  }
}

/**
 * Defines a secret with the given options.
 *
 * @param options The secret options.
 */
export function defineSecret<TSchema extends z.z.ZodObject>(
  options: SecretOptions<TSchema>,
): SecretContext<TSchema> {
  const permissions: Omit<SecretContext<TSchema>["permissions"], "all"> = {
    read: {
      name: "value:read",
      params: {
        name: options.name,
      },
    },
    readWrite: {
      name: "value:read-write",
      params: {
        name: options.name,
      },
    },
    init: {
      name: "definition:manage",
      params: {
        name: options.name,
      },
    },
  }

  let _secretData: SecretData | undefined
  let _logger: Logger | undefined
  let _secretName: string | undefined

  return {
    permissions: {
      ...permissions,
      all: [permissions.init, permissions.readWrite],
    },
    async init(secretData, replicaName, logger) {
      _secretData = secretData
      _logger = logger

      const substitutor = createSubstitutor({
        "replica.name": replicaName,
      })

      _secretName = substitutor(options.name)

      const secret = await getManagedSecretByName(secretData, _secretName)
      if (!secret) {
        throw new Error(`Secret definition with name "${_secretName}" not found`)
      }

      // update secret definition
      const loadedSecret = await secret.$jazz.ensureLoaded({ resolve: { definition: true } })

      loadedSecret.definition.$jazz.set("displayInfo", options.displayInfo)

      loadedSecret.definition.$jazz.set(
        "schema",
        z.z.core.toJSONSchema(options.schema) as z.z.core.JSONSchema.ObjectSchema,
      )

      logger.info(`secret "%s" initialized`, _secretName)
    },
    async getBox() {
      if (!_secretData) {
        throw new Error("SecretContext not initialized. Call init() before using other methods.")
      }

      ok(_secretName)
      ok(_logger)

      const secret = await getManagedSecretByName(_secretData, _secretName)
      if (!secret) {
        return null
      }

      const loadedSecret = await secret.$jazz.ensureLoaded({ resolve: { value: true } })
      const parsedValue = options.schema.safeParse(loadedSecret.value.value)

      if (!parsedValue.success) {
        _logger.warn(
          `secret "%s" value does not conform to schema:\n%s`,
          _secretName,
          z.z.prettifyError(parsedValue.error),
        )

        return null
      }

      return loadedSecret.value as SecretValueBox<z.infer<TSchema>>
    },
    async get() {
      const box = await this.getBox()
      if (!box) {
        return null
      }

      return box.value
    },
    async set(value) {
      if (!_secretData) {
        throw new Error("SecretContext not initialized. Call init() before using other methods.")
      }

      ok(_secretName)
      ok(_logger)

      const secret = await getManagedSecretByName(_secretData, _secretName)
      if (!secret) {
        throw new Error(`Secret definition with name "${options.name}" not found`)
      }

      const loadedSecret = await secret.$jazz.ensureLoaded({ resolve: { value: true } })

      loadedSecret.value.$jazz.set("value", value)

      _logger.info(`secret "%s" value updated`, _secretName)
    },
  }
}
