/** biome-ignore-all lint/suspicious/noExplicitAny: to simplify types */

import type { BaseAccountShape } from "jazz-tools"
import type { Contract } from "./contract"
import type { ReplicaDefinition } from "./replica-definition"
import { createJazzTestAccount } from "jazz-tools/testing"
import { pino } from "pino"
import { ReplicaControlBlock } from "./control-block"
import { populateReplicaAccount, ReplicaAccount } from "./replica"
import { createImplementations, type ReplicaContext } from "./replica-launcher"

export const testLogger = pino({ name: "test" })

export async function createReplicaTestAccount<
  TPrivateData extends BaseAccountShape["root"],
  TImplementations extends Record<string, Contract>,
  TRequirements extends Record<string, Contract>,
>(replica: ReplicaDefinition<TPrivateData, TImplementations, TRequirements>) {
  const AccountSchema = ReplicaAccount<TPrivateData, TImplementations>(
    replica.privateData,
    replica.implementations,
  )

  const account = await createJazzTestAccount({ AccountSchema, isCurrentActiveAccount: true })

  const loadedAccount = await populateReplicaAccount(
    account as ReplicaAccount<TPrivateData, TImplementations>,
    replica,
    1,
    "test-replica",
  )

  const rcb = ReplicaControlBlock.create({
    id: 1,
    name: "test-replica",
    permissions: {},
    requirements: {},
  })

  const implementations = createImplementations(replica, loadedAccount, rcb, testLogger)

  type Context = ReplicaContext<TPrivateData, TImplementations, TRequirements>

  return {
    account: loadedAccount as ReplicaAccount<TPrivateData, TImplementations>,
    implements: implementations as Context["implementations"],
  }
}
