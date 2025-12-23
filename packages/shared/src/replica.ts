/** biome-ignore-all lint/suspicious/noExplicitAny: for complex types */

import type { Contract } from "./contract"
import type { ReplicaDefinition } from "./replica-definition"
import { type BaseAccountShape, co } from "jazz-tools"
import { z } from "zod"
import { assert } from "./utils"

export const CommonReplicaConfig = z.object({
  RESIDE_CONTROL_BLOCK_ID: z.string(),
  RESIDE_ACCOUNT_ID: z.string(),
  RESIDE_AGENT_SECRET: z.string(),
  RESIDE_SYNC_SERVER_URL: z.string(),
  RESIDE_INTERNAL_ENDPOINT: z.string().optional(),
  RESIDE_EXTERNAL_ENDPOINT: z.string().optional(),

  /**
   * Whether this replica is running in an internal or external context.
   *
   * In an internal context, the replica will use internal endpoints to communicate with other replicas.
   * In an external context, the replica (or any other process) will use external endpoints.
   */
  RESIDE_ACCESS_CONTEXT: z.enum(["internal", "external"]).default("internal"),
  RESIDE_ETCD_HOSTS: z.string().optional(),
  RESIDE_LISTEN_PORT: z.string().optional(),
})

export type ReplicaProfile<TImplementations extends Record<string, Contract>> = co.loaded<
  ReturnType<typeof ReplicaProfile<TImplementations>>
>

export type ReplicaAccount<
  TPrivateData extends BaseAccountShape["root"],
  TImplementations extends Record<string, Contract>,
> = co.loaded<ReturnType<typeof ReplicaAccount<TPrivateData, TImplementations>>>

export function ReplicaProfile<TImplementations extends Record<string, Contract>>(
  implementations: TImplementations,
) {
  type ContractFields = {
    [K in keyof TImplementations as TImplementations[K]["identity"]]: TImplementations[K]["data"]
  }

  return co.map({
    name: z.string(),
    replicaId: z.number(),
    endpoints: z
      .object({
        internal: z.string().optional(),
        external: z.string().optional(),
      })
      .optional(),
    contracts: co.map(
      Object.fromEntries(
        Object.values(implementations).map(contract => [contract.identity, contract.data]),
      ) as ContractFields,
    ),
  })
}

export function ReplicaAccount<
  TPrivateData extends BaseAccountShape["root"],
  TImplementations extends Record<string, Contract>,
>(privateData?: TPrivateData, implementations?: TImplementations) {
  privateData ??= co.map({}) as unknown as TPrivateData
  implementations ??= {} as TImplementations

  return co.account({
    root: privateData,
    profile: ReplicaProfile(implementations),
  })
}

export async function populateReplicaAccount<
  TPrivateData extends BaseAccountShape["root"],
  TImplementations extends Record<string, Contract>,
>(
  account: ReplicaAccount<TPrivateData, TImplementations>,
  replicaDef: ReplicaDefinition<TPrivateData, TImplementations, any>,
  replicaId: number,
  replicaName: string,
) {
  const loadedAccount = await account.$jazz.ensureLoaded({
    resolve: {
      profile: {
        contracts: {
          ...Object.fromEntries(
            Object.values(replicaDef.implementations ?? {}).map(contract => [
              contract.identity,
              { $onError: "catch" },
            ]),
          ),
          $onError: "catch",
        },
        $onError: "catch",
      },
    } as any,
  })

  assert(
    loadedAccount.$isLoaded,
    `unexpected replica account state: ${loadedAccount.$jazz.loadingState}`,
  )

  if (
    replicaDef.privateData &&
    (!loadedAccount.root || loadedAccount.root.$jazz.loadingState === "unavailable")
  ) {
    loadedAccount.$jazz.set("root", {} as any)
  }

  if (loadedAccount.profile.$jazz.loadingState === "unavailable") {
    loadedAccount.$jazz.set("profile", {
      name: replicaName,
      replicaId,
      contracts: {},
    } as any)

    assert(loadedAccount.profile.$isLoaded)

    // make profile public to allow lookups of contracts
    loadedAccount.profile.$jazz.owner.makePublic()
  }

  assert(loadedAccount.profile.$isLoaded)

  // update endpoints so consumers can reach this replica
  const externalEndpoint = process.env.RESIDE_EXTERNAL_ENDPOINT
  const internalEndpoint = process.env.RESIDE_INTERNAL_ENDPOINT ?? `http://${replicaName}`

  if (
    !loadedAccount.profile.endpoints ||
    loadedAccount.profile.endpoints.internal !== internalEndpoint ||
    loadedAccount.profile.endpoints.external !== externalEndpoint
  ) {
    loadedAccount.profile.$jazz.set("endpoints", {
      internal: internalEndpoint,
      external: externalEndpoint,
    })
  }

  // create empty objects for each implemented contract and run migrations
  for (const contract of Object.values(replicaDef.implementations ?? {})) {
    let contractData = (loadedAccount.profile!.contracts as any)[contract.identity]

    if (!contractData) {
      assert(loadedAccount.profile.contracts.$isLoaded)

      loadedAccount.profile!.contracts!.$jazz.set(contract.identity as any, {} as any)

      // make contract data public
      contractData = (loadedAccount.profile!.contracts as any)[contract.identity]
      contractData.$jazz.owner.makePublic()
    }

    if (contract.migration) {
      contract.migration(contractData, loadedAccount)
    }
  }

  return loadedAccount
}
