/** biome-ignore-all lint/suspicious/noExplicitAny: for complex types */

import type { Account } from "jazz-tools"
import type { Contract, Requirement } from "./contract"
import { mapValues } from "remeda"
import { getGrantedPermissions } from "./permissions"
import { ReplicaAccount } from "./replica"

/**
 * Creates a requirement object for the given contract and account ID.
 * This object can be used to interact with the requirement's methods and data.
 *
 * @param contract The contract definition.
 * @param accountId The account ID of the requirement.
 * @param loadAs Optional account to load the requirement as.
 */
export async function createRequirement<TContract extends Contract>(
  contract: TContract,
  accountId: string,
  loadAs?: Account,
): Promise<Requirement<TContract>> {
  // lookup contract data from account
  const account = await ReplicaAccount(undefined, { [contract.identity]: contract }).load(
    accountId,
    {
      loadAs,
      resolve: {
        profile: {
          contracts: {
            [contract.identity]: {
              $onError: "catch",
            },
            $onError: "catch",
          },
          $onError: "catch",
        },
      } as any,
    },
  )

  if (!account.$isLoaded) {
    throw new Error(
      `Account with ID "${accountId}" could not be loaded: ${account.$jazz.loadingState}`,
    )
  }

  if (!account.profile.$isLoaded) {
    throw new Error(`Account profile for account ID "${accountId}" is not loaded`)
  }

  // allow data to be undefined for seed replica to bootstrap correctly
  // TODO: handle this case better
  const data = (account.profile.contracts as any)?.[contract.identity]

  const context = process.env.RESIDE_ACCESS_CONTEXT === "external" ? "external" : "internal"

  // the endpoint may change over time, all replicas should be ready to handle that
  let endpoint: string | undefined = account.profile.endpoints?.[context]
  account.profile.$jazz.subscribe(profile => {
    endpoint = profile.endpoints?.[context]
  })

  const replicaName = account.profile.name

  const methods = mapValues(contract.methods, (method, methodName) => {
    const send: ReturnType<typeof method.definition>["send"] = async (requestData, options) => {
      if (!endpoint) {
        throw new Error(
          `No ${context} endpoint defined for replica "${replicaName}" (account ID: ${accountId})`,
        )
      }

      // create "send" method on each request to always use the latest endpoint
      const fullUrl = `${endpoint}/replicas/${replicaName}/rpc/${contract.identity}/${methodName}`
      const definition = method.definition(fullUrl, accountId)

      return await definition.send(requestData, options)
    }

    return send
  })

  const checkPermission = async (permissionKey: string, instanceId?: string): Promise<boolean> => {
    const permissions = await getGrantedPermissions(account.profile as any)

    const permissionMap = permissions[contract.identity]
    if (!instanceId) {
      return !!permissionMap?.[permissionKey]
    }

    return !!permissionMap?.[permissionKey]?.[instanceId]
  }

  const getPermissionInstances = async (permissionKey: string) => {
    const permissions = await getGrantedPermissions(account.profile as any)

    return permissions[contract.identity]?.[permissionKey] ?? {}
  }

  return {
    data,
    replicaId: account.profile.replicaId,
    accountId: account.$jazz.id,
    ...methods,
    checkPermission,
    getPermissionInstances,
  } as Requirement<TContract>
}
