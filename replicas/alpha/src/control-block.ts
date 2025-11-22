import type { AlphaData, GrantedPermissionSet, Replica, ReplicaVersion } from "@contracts/alpha.v1"
import type { Logger } from "pino"
import {
  box,
  ControlBlockPermission,
  loadBoxed,
  type PermissionState,
  ReplicaControlBlock,
} from "@reside/shared"
import { type Account, Group } from "jazz-tools"
import { mapValues } from "remeda"

export async function createReplicaControlBlock(
  data: AlphaData,
  replica: Replica,
): Promise<ReplicaControlBlock> {
  const loadedReplica = await replica.$jazz.ensureLoaded({ resolve: { account: true } })

  const controlBlock = ReplicaControlBlock.create(
    {
      id: replica.id,
      name: replica.name,
      requirements: {},
      permissions: {},
    },
    { owner: Group.create(data.$jazz.loadedAs as Account) },
  )

  // allow replica to interact with control block
  controlBlock.$jazz.owner.addMember(loadedReplica.account, "writer")

  // create index to look up control block by replica ID
  await createReplicaControlBlockIndex(data, replica, controlBlock)

  // allow users with rcb:manage:all permission to read/write the RCB
  const loadedData = await data.$jazz.ensureLoaded({ resolve: { rcbManageGroup: true } })

  controlBlock.$jazz.owner.addMember(loadedData.rcbManageGroup, "writer")

  return controlBlock
}

export async function createReplicaControlBlockIndex(
  data: AlphaData,
  replica: Replica,
  controlBlock: ReplicaControlBlock,
): Promise<void> {
  // create index to look up control block by replica ID
  box(ReplicaControlBlock).create(
    { value: controlBlock },
    {
      unique: `rcb.by-id.${replica.id}`,
      owner: data.$jazz.owner,
    },
  )
}

export async function getReplicaControlBlock(
  data: AlphaData,
  replica: Replica,
): Promise<ReplicaControlBlock> {
  const controlBlock = await loadBoxed(
    ReplicaControlBlock,
    `rcb.by-id.${replica.id}`,
    data.$jazz.owner.$jazz.id,
    data.$jazz.loadedAs,
  )

  if (!controlBlock) {
    throw new Error(`Replica control block not found for replica "${replica.name}"`)
  }

  return controlBlock
}

export async function syncReplicaControlBlockPermissions(
  alphaData: AlphaData,
  version: ReplicaVersion,
  logger: Logger,
): Promise<void> {
  const loadedVersion = await version.$jazz.ensureLoaded({
    resolve: {
      replica: {
        account: {
          profile: true,
        },
      },
      requirements: {
        $each: {
          contract: true,
          replicas: { $each: true },
          permissions: {
            $each: {
              permission: true,
            },
          },
        },
      },
    },
  })

  const permissionSets = Object.values(
    loadedVersion.requirements as unknown as Record<string, GrantedPermissionSet | undefined>,
  ).filter((permissionSet): permissionSet is GrantedPermissionSet => Boolean(permissionSet))

  await syncControlBlockPermissions(
    alphaData,
    loadedVersion.replica.account,
    permissionSets,
    logger,
  )
}

/**
 * Synchronises the permissions from the provided permission sets with the target account's Replica Control Blocks.
 */
export async function syncControlBlockPermissions(
  alphaData: AlphaData,
  account: Account,
  permissionSets: GrantedPermissionSet[],
  logger: Logger,
): Promise<void> {
  const loadedAccount = await account.$jazz.ensureLoaded({
    resolve: {
      profile: true,
    },
  })

  if (!loadedAccount.$isLoaded) {
    throw new Error("Target account is not loaded")
  }

  const buildPermissionKey = (
    contractIdentity: string,
    permissionName: string,
    instanceId?: string,
  ) =>
    instanceId
      ? `${loadedAccount.$jazz.id}:${contractIdentity}:${permissionName}:${instanceId}`
      : `${loadedAccount.$jazz.id}:${contractIdentity}:${permissionName}`

  type RcbState = {
    rcb: ReplicaControlBlock
    permissionCache: Map<string, ControlBlockPermission>
    expectedStates: Map<string, PermissionState>
    createdKeys: Set<string>
    actions: {
      added: Set<string>
      updated: Set<string>
      unchanged: Set<string>
      revoked: Set<string>
    }
  }

  const rcbStates = new Map<string, RcbState>()

  for (const permissionSet of permissionSets) {
    const loadedSet = await permissionSet.$jazz.ensureLoaded({
      resolve: {
        contract: true,
        replicas: { $each: true },
        permissions: {
          $each: {
            permission: true,
          },
        },
      },
    })

    if (!loadedSet.contract?.$isLoaded) {
      throw new Error("Contract in permission set is not loaded")
    }

    const replicas = Array.from(loadedSet.replicas.values())
    const grantedPermissions = Array.from(loadedSet.permissions.values())

    for (const targetReplica of replicas) {
      const rcb = await getReplicaControlBlock(alphaData, targetReplica)

      const loadedRcb = await rcb.$jazz.ensureLoaded({
        resolve: {
          permissions: {
            $each: {
              account: {
                profile: true,
              },
            },
          },
        },
      })

      let state = rcbStates.get(rcb.$jazz.id)
      if (!state) {
        const permissionCache = new Map<string, ControlBlockPermission>()
        for (const [key, value] of Object.entries(loadedRcb.permissions)) {
          if (value) {
            permissionCache.set(key, value)
          }
        }

        state = {
          rcb,
          permissionCache,
          expectedStates: new Map<string, PermissionState>(),
          createdKeys: new Set<string>(),
          actions: {
            added: new Set<string>(),
            updated: new Set<string>(),
            unchanged: new Set<string>(),
            revoked: new Set<string>(),
          },
        }

        rcbStates.set(rcb.$jazz.id, state)
      }

      for (const grantedPermission of grantedPermissions) {
        const permissionKey = buildPermissionKey(
          loadedSet.contract.identity,
          grantedPermission.permission.name,
          grantedPermission.instanceId ?? undefined,
        )

        if (grantedPermission.status !== "approved") {
          state.expectedStates.delete(permissionKey)
          state.createdKeys.delete(permissionKey)
          continue
        }

        const expectedState: PermissionState = {
          granted: true,
          params: grantedPermission.params as PermissionState["params"],
        }

        state.expectedStates.set(permissionKey, expectedState)

        if (!state.permissionCache.has(permissionKey)) {
          const newPermission = ControlBlockPermission.create(
            {
              identity: loadedSet.contract.identity,
              name: grantedPermission.permission.name,
              account: loadedAccount,
              instanceId: grantedPermission.instanceId,
              expected: expectedState,
              current: {
                granted: false,
                params: grantedPermission.params,
              },
            },
            state.rcb.$jazz.owner,
          )

          // biome-ignore lint/suspicious/noExplicitAny: jazz typings do not expose precise mutation types
          loadedRcb.permissions.$jazz.set(permissionKey, newPermission as any)
          state.permissionCache.set(permissionKey, newPermission)
          state.createdKeys.add(permissionKey)
        }
      }
    }
  }

  for (const state of rcbStates.values()) {
    const loadedRcb = await state.rcb.$jazz.ensureLoaded({
      resolve: {
        permissions: {
          $each: {
            account: {
              profile: true,
            },
          },
        },
      },
    })

    for (const [permissionKey, permissionRecord] of Object.entries(loadedRcb.permissions)) {
      if (!permissionRecord) {
        continue
      }

      if (permissionRecord.account.$jazz.id !== loadedAccount.$jazz.id) {
        continue
      }

      if (state.createdKeys.has(permissionKey)) {
        state.actions.added.add(permissionKey)
        continue
      }

      const expectedState = state.expectedStates.get(permissionKey)

      if (expectedState) {
        if (!statesEqual(permissionRecord.expected as PermissionState, expectedState)) {
          permissionRecord.$jazz.set("expected", expectedState)
          state.actions.updated.add(permissionKey)
        } else {
          state.actions.unchanged.add(permissionKey)
        }
      } else {
        const revokedState: PermissionState = {
          granted: false,
          params: (permissionRecord.current?.params ??
            permissionRecord.expected?.params ??
            {}) as PermissionState["params"],
        }

        if (!statesEqual(permissionRecord.expected as PermissionState, revokedState)) {
          permissionRecord.$jazz.set("expected", revokedState)
          state.actions.revoked.add(permissionKey)
        } else {
          state.actions.unchanged.add(permissionKey)
        }
      }
    }

    logger.info(
      {
        replicaId: state.rcb.id,
        replicaName: state.rcb.name,
        accountId: loadedAccount.$jazz.id,
        accountName: loadedAccount.profile?.name ?? null,
        actions: {
          added: Array.from(state.actions.added),
          updated: Array.from(state.actions.updated),
          unchanged: Array.from(state.actions.unchanged),
          revoked: Array.from(state.actions.revoked),
        },
      },
      "synchronized replica control block permissions",
    )
  }
}

function statesEqual(a: PermissionState | undefined, b: PermissionState | undefined): boolean {
  if (!a || !b) {
    return a === b
  }

  if (a.granted !== b.granted) {
    return false
  }

  return JSON.stringify(a.params) === JSON.stringify(b.params)
}

export async function syncReplicaControlBlockRequirements(
  alphaData: AlphaData,
  version: ReplicaVersion,
  logger: Logger,
): Promise<void> {
  const loadedVersion = await version.$jazz.ensureLoaded({
    resolve: {
      replica: true,
      requirements: {
        $each: {
          contract: true,
          replicas: { $each: { account: true } },
        },
      },
    },
  })

  const rcb = await getReplicaControlBlock(alphaData, loadedVersion.replica)

  // set contract -> account IDs mapping
  rcb.$jazz.set(
    "requirements",
    mapValues(loadedVersion.requirements, requirement =>
      requirement.replicas.map(replica => replica.account.$jazz.id),
    ),
  )

  logger.info(
    {
      replicaId: rcb.id,
      replicaName: rcb.name,
      requirements: rcb.requirements,
    },
    "synchronized replica control block requirements",
  )
}
