/** biome-ignore-all lint/suspicious/noExplicitAny: for complex types */

import type { Contract } from "./contract"
import type { ReplicaDefinition } from "./replica-definition"
import { ok } from "node:assert"
import { type BaseAccountShape, co } from "jazz-tools"
import { z } from "zod"

export const CommonReplicaConfig = z.object({
  RESIDE_CONTROL_BLOCK_ID: z.string(),
  RESIDE_ACCOUNT_ID: z.string(),
  RESIDE_AGENT_SECRET: z.string(),
  RESIDE_SYNC_SERVER_URL: z.string(),
  RESIDE_REPLICA_ENDPOINT: z.string().optional(),
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
    endpoint: z.string().optional(),
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

  ok(
    loadedAccount.$isLoaded,
    `unexpected replica account state: ${loadedAccount.$jazz.loadingState}`,
  )

  if (replicaDef.privateData && loadedAccount.root.$jazz.loadingState === "unavailable") {
    loadedAccount.$jazz.set("root", {} as any)
  }

  if (loadedAccount.profile.$jazz.loadingState === "unavailable") {
    loadedAccount.$jazz.set("profile", {
      name: replicaName,
      replicaId,
      contracts: {},
    } as any)

    ok(loadedAccount.profile.$isLoaded)

    // make profile public to allow lookups of contracts
    loadedAccount.profile.$jazz.owner.makePublic()
  }

  ok(loadedAccount.profile.$isLoaded)

  // update endpoint so consumers can reach this replica
  const endpoint = process.env.RESIDE_REPLICA_ENDPOINT ?? `http://${replicaName}`

  if (loadedAccount.profile.endpoint !== endpoint) {
    loadedAccount.profile.$jazz.set("endpoint", endpoint)
  }

  // create empty objects for each implemented contract and run migrations
  for (const contract of Object.values(replicaDef.implementations ?? {})) {
    let contractData = (loadedAccount.profile!.contracts as any)[contract.identity]

    if (!contractData) {
      ok(loadedAccount.profile.contracts.$isLoaded)

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
