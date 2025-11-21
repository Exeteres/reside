import type { Account } from "jazz-tools"
import type { AlphaData } from "./contract"
import { type Contract, createRequirement, type Requirement } from "@reside/shared"
import { getContractEntityByIdentity } from "./contract-entity"
import { getReplicasImplementingContract } from "./replica"

/**
 * Discover a requirement for a given contract within the provided alpha data.
 *
 * @param alphaData The alpha data to search within.
 * @param contract The contract for which to discover the requirement.
 * @param baseUrl Optional base URL for the requirement.
 */
export async function discoverRequirement<TContract extends Contract>(
  alphaData: AlphaData,
  contract: TContract,
): Promise<Requirement<TContract>> {
  const contractEntity = await getContractEntityByIdentity(alphaData, contract.identity)
  if (!contractEntity) {
    throw new Error(`Contract entity for contract ${contract.identity} not found`)
  }

  const replicas = await getReplicasImplementingContract(alphaData, contractEntity.id)
  if (replicas.length === 0) {
    throw new Error(
      `No replicas found implementing contract ${contract.identity} (${contractEntity.id})`,
    )
  }

  const loadedReplica = await replicas[0]!.$jazz.ensureLoaded({
    resolve: {
      account: true,
    },
  })

  return createRequirement(
    contract,
    loadedReplica.account.$jazz.id,
    loadedReplica.$jazz.loadedAs as Account,
  )
}
