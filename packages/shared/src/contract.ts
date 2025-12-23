/** biome-ignore-all lint/suspicious/noExplicitAny: to simplify types */

import type { SetOptional } from "type-fest"
import type { MethodHandler, RpcMethod } from "./rpc"
import { type Account, type CoValueClassOrSchema, type co, z } from "jazz-tools"

export type DisplayInfo = z.infer<typeof DisplayInfo>
export type LocalizedDisplayInfo = z.infer<typeof LocalizedDisplayInfo>
export type SerializedPermission = z.infer<typeof SerializedPermission>
export type SerializedContract = z.infer<typeof SerializedContract>
export type SerializedMethod = z.infer<typeof SerializedMethod>

export const DisplayInfo = z.object({
  /**
   * The human-readable title of the object.
   */
  title: z.string(),

  /**
   * The human-readable description of the object.
   */
  description: z.string(),
})

export const LocalizedDisplayInfo = z.record(z.string(), DisplayInfo)

export const SerializedPermission = z.object({
  /**
   * The display information for the permission.
   */
  displayInfo: LocalizedDisplayInfo,

  /**
   * The list of keys in the params that uniquely identify the permission instance.
   *
   * Will be undefined if the permission does not support multiple instances.
   */
  instanceKeys: z.string().array().optional(),

  /**
   * The JSON schema of the params of this permission.
   *
   * Will be undefined if the permission does not accept any parameters.
   */
  params: z.json().optional(),
})

export const SerializedMethod = z.object({
  /**
   * The display information for the method.
   */
  displayInfo: LocalizedDisplayInfo,
})

export const SerializedContract = z.object({
  /**
   * The identity of the contract.
   */
  identity: z.string(),

  /**
   * The display information for the contract.
   */
  displayInfo: LocalizedDisplayInfo,

  /**
   * The list of permissions defined by the contract.
   */
  permissions: z.z.record(z.string(), SerializedPermission),

  /**
   * The list of methods defined by the contract.
   */
  methods: z.z.record(z.string(), SerializedMethod),
})

export type Permission<
  TData extends CoValueClassOrSchema = CoValueClassOrSchema,
  TParams extends z.z.ZodObject = z.z.ZodObject,
> = {
  /**
   * The schema of the parameters that must be provided when requesting the permission.
   */
  params: TParams

  /**
   * The display information for the permission.
   *
   * The key is BCP 47 language tag (e.g., "en", "fr", "de") and the value is the display information in that language.
   */
  displayInfo: LocalizedDisplayInfo

  /**
   * Gets the list of keys in the params that uniquely identify the permission instance.
   *
   * If not provided, the permission will not support multiple instances.
   */
  instanceKeys?: readonly (keyof z.infer<TParams> & string)[]

  /**
   * The handler to be invoked when the permission is granted for an account.
   * Must not conflict with other permission handlers.
   *
   * @param data The data managed by the contract.
   * @param account The account that this permission is granted to.
   * @param params The parameters provided when requesting the permission.
   */
  onGranted?: (
    data: co.loaded<TData>,
    account: Account,
    params: z.infer<TParams>,
  ) => void | Promise<void>

  /**
   * The handler to be invoked when the permission params is updated for an account.
   * Must not conflict with other permission handlers.
   *
   * @param data The data managed by the contract.
   * @param account The account that this permission is updated for.
   * @param params The parameters provided when requesting the permission.
   * @param oldParams The previous parameters before the update.
   */
  onUpdated?: (
    data: co.loaded<TData>,
    account: Account,
    params: z.infer<TParams>,
    oldParams: z.infer<TParams>,
  ) => void | Promise<void>

  /**
   * The handler to be invoked when the permission is revoked for an account.
   * Must not conflict with other permission handlers.
   *
   * @param data The data managed by the contract.
   * @param account The account that this permission is revoked from.
   * @param params The parameters provided when requesting the permission.
   */
  onRevoked?: (
    data: co.loaded<TData>,
    account: Account,
    params: z.infer<TParams>,
  ) => void | Promise<void>
}

export type Contract<
  TIdentity extends string = string,
  TData extends CoValueClassOrSchema = any,
  TPermissions extends Record<string, z.z.ZodObject> = Record<string, z.z.ZodObject>,
  TMethods extends Record<string, RpcMethod> = Record<string, RpcMethod>,
> = {
  /**
   * The identity of the contract.
   *
   * Must be fully qualified image name without tag similar to replica identity.
   *
   * The data of the contract will be prefixed with this identity.
   */
  identity: TIdentity

  /**
   * The CoMap schema defining the data managed by the contract.
   */
  data: TData

  /**
   * Runs migration logic on the loaded data managed by the contract.
   *
   * @param data The loaded data managed by the contract.
   * @param owner The owner account of the data.
   */
  migration?: (data: co.loaded<TData>, owner: co.loaded<TData>) => void | Promise<void>

  /**
   * The display information for the contract.
   *
   * The key is BCP 47 language tag (e.g., "en", "fr", "de") and the value is the display information in that language.
   */
  displayInfo: LocalizedDisplayInfo

  /**
   * The list of permissions defined by the contract.
   */
  permissions: { [K in keyof TPermissions]: Permission<TData, TPermissions[K]> }

  /**
   * The list of RPC methods exposed by the contract.
   */
  methods: TMethods
}

export type Requirement<TContract extends Contract> = {
  /**
   * The contract being required.
   */
  contract: TContract

  /**
   * The ID of the replica implementing the requirement.
   */
  replicaId: number

  /**
   * The account of the replica implementing the requirement.
   */
  account: Account

  /**
   * The data managed by the contract.
   */
  data: co.loaded<TContract["data"]>

  /**
   * Checks whether the permission is granted for the current account.
   */
  checkMyPermission(
    permissionKey: keyof TContract["permissions"] & string,
    instanceId?: string,
  ): Promise<boolean>

  /**
   * Get the record of all granted permission instances for the given permission key.
   *
   * The key of the returned record is the instance ID and the value is params of that instance.
   */
  getPermissionInstances<TPermissionKey extends keyof TContract["permissions"] & string>(
    permissionKey: TPermissionKey,
  ): Promise<Record<string, z.infer<TContract["permissions"][TPermissionKey]["params"]>>>
} & {
  [M in keyof TContract["methods"] & string]: ReturnType<
    TContract["methods"][M]["definition"]
  >["send"]
}

export type Implementation<TContract extends Contract> = Requirement<TContract> & {
  checkPermission(
    account: Account,
    permissionKey: keyof TContract["permissions"] & string,
    instanceId?: string,
  ): boolean
} & {
  [M in keyof TContract["methods"] & string as `handle${Capitalize<M>}`]: (
    handler: MethodHandler<TContract["methods"][M]>,
  ) => void
}

export function defineContract<
  TIdentity extends string,
  TData extends CoValueClassOrSchema,
  TPermissions extends { [key: string]: z.z.ZodObject },
  TMethods extends Record<string, RpcMethod>,
>(
  contract: SetOptional<
    Contract<TIdentity, TData, TPermissions, TMethods>,
    "methods" | "permissions"
  >,
): Contract<TIdentity, TData, TPermissions, TMethods> {
  return {
    ...contract,
    methods: contract.methods ?? ({} as any),
    permissions: contract.permissions ?? ({} as any),
  }
}

export function resolveDisplayInfo(
  info: LocalizedDisplayInfo | undefined | null,
  locale?: string,
): DisplayInfo | undefined {
  if (!info) return undefined

  if (locale && info[locale]) {
    return info[locale]
  }

  const [firstKey] = Object.keys(info)
  if (firstKey) {
    return info[firstKey]
  }

  return undefined
}
