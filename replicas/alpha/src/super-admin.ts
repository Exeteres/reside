import {
  AlphaContract,
  type AlphaData,
  GrantedPermissionSet,
  getContractEntityByIdentity,
  getReplicaById,
} from "@contracts/alpha.v1"
import { type Account, Group } from "jazz-tools"

export async function createPermissionSet(
  alphaData: AlphaData,
  replicaId: number,
  contractIdentity: string,
  permissionNames: string[],
  createAs: Account,
): Promise<GrantedPermissionSet> {
  const replica = await getReplicaById(alphaData, replicaId)
  if (!replica) {
    throw new Error(`Replica with ID ${replicaId} not found`)
  }

  const contract = await getContractEntityByIdentity(alphaData, contractIdentity)
  if (!contract) {
    throw new Error(`Alpha contract entity not found`)
  }

  const loadedContract = await contract.$jazz.ensureLoaded({
    resolve: {
      permissions: { $each: true },
    },
  })

  const permissions = permissionNames.map(name => {
    const permission = loadedContract.permissions[name]
    if (!permission) {
      throw new Error(`Permission "${name}" not found in Alpha contract entity`)
    }
    return permission
  })

  return GrantedPermissionSet.create(
    {
      contract: contract,
      replicas: [replica],
      permissions: permissions.map(permission => ({
        permission,
        requestType: "static",
        status: "approved",
        params: {},
      })),
    },
    Group.create(createAs),
  )
}

export async function createSuperAdminPermissionSet(
  alphaData: AlphaData,
  alphaReplicaId: number,
  createAs: Account,
): Promise<GrantedPermissionSet> {
  return await createPermissionSet(
    alphaData,
    alphaReplicaId,
    AlphaContract.identity,
    [
      //
      "replica:read:all",
      "replica:manage:all",
      "load-request:create",
      "load-request:read:all",
      "load-request:approve",
    ],
    createAs,
  )
}
