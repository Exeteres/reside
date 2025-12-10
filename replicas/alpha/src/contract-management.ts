import type { Logger } from "pino"
import { type AlphaData, ContractEntity, getContractEntityByIdentity } from "@contracts/alpha.v1"
import { box, type SerializedContract } from "@reside/shared"
import { type Account, Group } from "jazz-tools"
import { mapValues } from "remeda"
import { fetchResideManifest } from "./docker"

/**
 * Creates or updates the contract entity in the alpha contract data.
 *
 * @param alpha The alpha contract data.
 * @param contract The serialized contract to register.
 */
export async function upsertContractEntity(
  alpha: AlphaData,
  contract: SerializedContract,
  logger: Logger,
): Promise<ContractEntity> {
  const existingContract = await getContractEntityByIdentity(alpha, contract.identity)

  const mappedPermissions = mapValues(contract.permissions, (permission, name) => ({
    name,
    displayInfo: permission.displayInfo,
    instanceKeys: permission.instanceKeys,
    params: permission.params,
  }))

  const mappedMethods = mapValues(contract.methods, (method, name) => ({
    name,
    displayInfo: method.displayInfo,
  }))

  if (existingContract) {
    // just update the fields
    existingContract.$jazz.set("displayInfo", contract.displayInfo)
    existingContract.$jazz.set("permissions", mappedPermissions)
    existingContract.$jazz.set("methods", mappedMethods)

    logger.info("entity of contract '%s' updated", contract.identity)

    return existingContract
  }

  const loadedData = await alpha.$jazz.ensureLoaded({
    resolve: { contracts: true, replicas: true },
  })

  const group = Group.create(alpha.$jazz.loadedAs as Account)

  // allow read access for accounts with "replica:read:all" permission
  group.addMember(loadedData.replicas.$jazz.owner, "reader")

  const newContract = ContractEntity.create(
    {
      id: loadedData.contracts.length + 1,
      identity: contract.identity,
      displayInfo: contract.displayInfo,
      permissions: mappedPermissions,
      methods: mappedMethods,
    },
    group,
  )

  loadedData.contracts.$jazz.push(newContract)

  // create indexe for lookup by ID
  box(ContractEntity).create(
    { value: newContract },
    {
      unique: `contract.by-id.${newContract.id}`,
      owner: alpha.$jazz.owner,
    },
  )

  // create index for lookup by identity
  box(ContractEntity).create(
    { value: newContract },
    {
      unique: `contract.by-identity.${newContract.identity}`,
      owner: alpha.$jazz.owner,
    },
  )

  logger.info("entity of contract '%s' created", contract.identity)

  return newContract
}

/**
 * Fetches the contract manifest and refreshes or creates the contract entity in the alpha.
 *
 * @param alpha The alpha data.
 * @param identity The contract identity.
 * @returns The loaded contract entity.
 */
export async function refreshContractEntity(
  alpha: AlphaData,
  identity: string,
  logger: Logger,
  fetchResideManifestFn: typeof fetchResideManifest = fetchResideManifest,
): Promise<ContractEntity> {
  const manifest = await fetchResideManifestFn(identity)
  if (manifest.type !== "contract") {
    throw new Error(`Invalid contract identity: "${identity}" is not a contract image`)
  }

  return await upsertContractEntity(alpha, manifest, logger)
}
