import type { Logger } from "pino"
import type { Contract } from "./contract"
import type { ReplicaProfile } from "./replica"
import { Account, co, z } from "jazz-tools"

export type ControlBlockPermission = co.loaded<typeof ControlBlockPermission>
export type ControlBlockPermissions = co.loaded<typeof ControlBlockPermissions>
export type PermissionState = z.infer<typeof PermissionState>

export const PermissionState = z.object({
  /**
   * Whether the permission is granted or not.
   */
  granted: z.boolean(),

  /**
   * The parameters associated with the permission.
   */
  params: z.record(z.string(), z.json()),
})

export const ControlBlockPermission = co.map({
  /**
   * The identity of the contract for which the permission is granted.
   */
  identity: z.string(),

  /**
   * The name of the permission within the contract.
   */
  name: z.string(),

  /**
   * The account for which the permission is granted.
   */
  account: Account,

  /**
   * The instance ID of the permission if applicable.
   */
  instanceId: z.string().optional(),

  /**
   * The expected state of the permission.
   */
  expected: PermissionState,

  /**
   * The current (applied) state of the permission.
   */
  current: PermissionState.optional(),
})

/**
 * The key is calculated as `${accountId}:${contract}:${permissionName}:${instanceId}` where `instanceId` is optional.
 */
export const ControlBlockPermissions = co.record(z.string(), ControlBlockPermission)

/**
 * Reconciles the permissions stored in the control block with the implementation by comparing
 * the expected and current states and executing the corresponding handlers when they differ.
 *
 * @param account The replica account executing the handlers.
 * @param permissions The collection of permissions to reconcile.
 * @param contractMap A map of contract identities to their corresponding Contract objects.
 * @param logger The logger to use for logging information and errors.
 */
export async function reconcileControlBlockPermissions<TContracts extends Record<string, Contract>>(
  account: Account,
  profile: ReplicaProfile<TContracts>,
  permissions: ControlBlockPermissions,
  contractMap: Map<string, Contract>,
  logger: Logger,
) {
  const permissionKeys = Object.keys(permissions)
  if (permissionKeys.length === 0) {
    return
  }

  logger.info(`reconciling %d permission(s)`, permissionKeys.length)

  const loadedPermissions = await permissions.$jazz.ensureLoaded({
    resolve: {
      $each: {
        account: {
          profile: true,
        },
      },
    },
  })

  const accountsToSync = new Map<string, Account>()

  for (const [permissionKey, loadedPermission] of Object.entries(loadedPermissions)) {
    const permissionRecord = loadedPermission
    if (!permissionRecord) {
      continue
    }

    const expectedState = permissionRecord.expected
    const currentState = permissionRecord.current

    if (statesEqual(expectedState, currentState)) {
      continue
    }

    const contract = contractMap.get(permissionRecord.identity)
    if (!contract) {
      logger.warn(
        `contract "%s" for permission "%s" not found among implemented contracts`,
        permissionRecord.identity,
        permissionKey,
      )
      continue
    }

    const permissionDefinition = contract.permissions[permissionRecord.name]
    if (!permissionDefinition) {
      logger.warn(
        `permission "%s" not found in the contract "%s"`,
        permissionRecord.name,
        permissionRecord.identity,
      )
      continue
    }

    const targetAccount = loadedPermission.account
    if (!targetAccount) {
      logger.warn(`permission "%s" is missing target account information`, permissionKey)
      continue
    }

    const desiredState = expectedState.granted
    const currentGranted = currentState?.granted ?? false
    const oldParams = (currentState?.params ?? {}) as typeof expectedState.params
    const paramsDiffer = JSON.stringify(oldParams) !== JSON.stringify(expectedState.params)

    const { onGranted, onRevoked, onUpdated } = permissionDefinition
    const contractData =
      // biome-ignore lint/suspicious/noExplicitAny: Contract data typing is complex here
      (account.profile as any).contracts[permissionRecord.identity]
    const accountName = targetAccount.profile?.name ?? targetAccount.$jazz.id ?? "unknown-account"

    type Action = "grant" | "revoke" | "update" | "align"
    let action: Action = "align"
    let handlerExecuted = false

    try {
      if (desiredState && !currentGranted) {
        action = "grant"
        if (onGranted) {
          await onGranted(
            contractData,
            targetAccount,
            expectedState.params as typeof expectedState.params,
          )
          handlerExecuted = true
        }
      } else if (!desiredState && currentGranted) {
        action = "revoke"
        if (onRevoked) {
          const paramsForRevocation = (currentState?.params ??
            expectedState.params) as typeof expectedState.params
          await onRevoked(contractData, targetAccount, paramsForRevocation)
          handlerExecuted = true
        }
      } else if (desiredState && currentGranted && paramsDiffer) {
        action = "update"
        if (onUpdated) {
          await onUpdated(
            contractData,
            targetAccount,
            expectedState.params as typeof expectedState.params,
            oldParams,
          )
          handlerExecuted = true
        }
      }
    } catch (err) {
      logger.error(
        { err },
        `error while handling %s of permission "%s" for account "%s"`,
        action,
        permissionRecord.name,
        accountName,
      )
      continue
    }

    permissionRecord.$jazz.set("current", expectedState)

    accountsToSync.set(targetAccount.$jazz.id, targetAccount)

    if (action === "grant") {
      if (handlerExecuted) {
        logger.info(`granted permission "%s" for account "%s"`, permissionRecord.name, accountName)
      } else {
        logger.info(
          `no onGranted handler defined for permission "%s"; marked as granted for account "%s"`,
          permissionRecord.name,
          accountName,
        )
      }
    } else if (action === "revoke") {
      if (handlerExecuted) {
        logger.info(`revoked permission "%s" for account "%s"`, permissionRecord.name, accountName)
      } else {
        logger.info(
          `no onRevoked handler defined for permission "%s"; marked as revoked for account "%s"`,
          permissionRecord.name,
          accountName,
        )
      }
    } else if (action === "update") {
      if (handlerExecuted) {
        logger.info(
          `updated permission "%s" params for account "%s"`,
          permissionRecord.name,
          accountName,
        )
      } else {
        logger.warn(
          `permission "%s" params changed but no onUpdated handler is defined; recorded new params for account "%s"`,
          permissionRecord.name,
          accountName,
        )
      }
    } else {
      logger.info(
        `synchronized permission "%s" for account "%s"`,
        permissionRecord.name,
        accountName,
      )
    }
  }

  for (const [accountId, targetAccount] of accountsToSync) {
    const grantedPermissions: GrantedPermissions = {}

    for (const permission of Object.values(loadedPermissions)) {
      if (!permission) {
        continue
      }

      if (permission.account?.$jazz.id !== accountId) {
        continue
      }

      const state = permission.current ?? permission.expected
      if (!state?.granted) {
        continue
      }

      let contractPermissions = grantedPermissions[permission.identity]

      if (!contractPermissions) {
        contractPermissions = {}
        grantedPermissions[permission.identity] = contractPermissions
      }

      if (permission.instanceId) {
        let permissionInstances = contractPermissions[permission.name]

        if (!permissionInstances) {
          permissionInstances = {}
          contractPermissions[permission.name] = permissionInstances
        }

        permissionInstances[permission.instanceId] = state.params as Record<string, unknown>
      } else {
        contractPermissions[permission.name] = {}
      }
    }

    await writeGrantedPermissions(profile, targetAccount, grantedPermissions)
  }
}

function statesEqual(
  a: { granted: boolean; params: Record<string, unknown> } | undefined,
  b: { granted: boolean; params: Record<string, unknown> } | undefined,
): boolean {
  if (!a || !b) {
    return a === b
  }

  if (a.granted !== b.granted) {
    return false
  }

  return JSON.stringify(a.params) === JSON.stringify(b.params)
}

export type GrantedPermissions = z.infer<typeof GrantedPermissionContainer.shape.permissions>

export const GrantedPermissionContainer = co.map({
  /**
   * The record of granted permissions.
   *
   * The key is the contract identity, the value is a record of permission names to their instances.
   *
   * If permission is not instance-based, the value is empty object.
   *
   * If permission is instance-based, the value contains the object which key is instanceId and value is instance params.
   */
  permissions: z.record(z.string(), z.record(z.string(), z.record(z.string(), z.z.unknown()))),
})

export async function getGrantedPermissions<TContracts extends Record<string, Contract>>(
  profile: ReplicaProfile<TContracts>,
): Promise<GrantedPermissions> {
  const container = await GrantedPermissionContainer.loadUnique(
    `granted-permissions:for-account:${(profile.$jazz.loadedAs as Account).$jazz.id}`,
    profile.$jazz.owner.$jazz.id,
    { loadAs: profile.$jazz.loadedAs },
  )

  return container.$isLoaded ? container.permissions : {}
}

async function writeGrantedPermissions<TContracts extends Record<string, Contract>>(
  profile: ReplicaProfile<TContracts>,
  account: Account,
  permissions: GrantedPermissions,
) {
  const existing = await GrantedPermissionContainer.loadUnique(
    `granted-permissions:for-account:${account.$jazz.id}`,
    profile.$jazz.owner.$jazz.id,
    { loadAs: profile.$jazz.loadedAs },
  )

  if (existing.$isLoaded) {
    existing.$jazz.set("permissions", permissions as typeof existing.permissions)
    return
  }

  const grantedPermissions = GrantedPermissionContainer.create(
    // biome-ignore lint/suspicious/noExplicitAny: because jazz does not support "unknown" type
    { permissions: permissions as any },
    {
      unique: `granted-permissions:for-account:${account.$jazz.id}`,
      owner: profile.$jazz.owner,
    },
  )

  // ensure account can read its granted permissions
  grantedPermissions.$jazz.owner.addMember(account, "reader")
}

export function getPermissionInstanceId(
  params: Record<string, unknown>,
  instanceKeys: string[],
): string {
  return instanceKeys
    .map(key => {
      if (!(key in params)) {
        throw new Error(`Permission parameter "${key}" is required to determine instance ID`)
      }

      const value = params[key]

      if (value === null || value === undefined) {
        throw new Error(
          `Permission parameter "${key}" must not be null or undefined to determine instance ID`,
        )
      }

      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return String(value)
      }

      throw new Error(
        `Permission parameter "${key}" must be a string, number, or boolean to determine instance ID`,
      )
    })
    .join(".")
}
