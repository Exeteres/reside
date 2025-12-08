import type { KubernetesSentinelData } from "@contracts/kubernetes-sentinel.v1"
import type { Logger } from "pino"
import {
  type AlphaData,
  GrantedPermission,
  getReplicaByName,
  Replica,
  type ReplicaLoadRequest,
  ReplicaManagementBlock,
  ReplicaRequirement,
  ReplicaVersion,
} from "@contracts/alpha.v1"
import {
  addToIndexList,
  box,
  CommonReplicaConfig,
  type LocalizedDisplayInfo,
  loadConfig,
  type ReplicaInfo,
} from "@reside/shared"
import { WasmCrypto } from "cojson/crypto/WasmCrypto"
import { createWebSocketPeer } from "cojson-transport-ws"
import { Account, co, Group, type Peer } from "jazz-tools"
import { Config } from "./config"
import {
  createReplicaControlBlock,
  syncReplicaControlBlockPermissions,
  syncReplicaControlBlockRequirements,
} from "./control-block"
import {
  createReplicaSecret,
  syncReplicaVersionServiceAndIngress,
  syncReplicaVersionWorkload,
} from "./kubernetes"

export type PeerFactory = () => Peer
export type AccountFactory = () => Promise<Account>

export function createProductionPeer(): Peer {
  const config = loadConfig(CommonReplicaConfig)

  return createWebSocketPeer({
    id: "upstream",
    role: "server",
    websocket: new WebSocket(config.RESIDE_SYNC_SERVER_URL),
  }) as Peer
}

const crypto = await WasmCrypto.create()

export function createProductionAccount(): Promise<Account> {
  return Account.create({
    creationProps: { name: "" },
    crypto,
    peers: [createProductionPeer()],
  })
}

export type CreateReplicaVersionInput = {
  image: string
  digest: string
  displayInfo: LocalizedDisplayInfo
  implementations: co.loaded<typeof ReplicaVersion.shape.implementations, { $each: true }>
  requirements: co.loaded<typeof ReplicaVersion.shape.requirements, { $each: true }>
  identity: string
  info: ReplicaInfo
  name: string
  replica: Replica | null
}

export async function createReplicaVersion(
  alpha: AlphaData,
  k8s: KubernetesSentinelData,
  request: CreateReplicaVersionInput,
  accountFactory: AccountFactory = createProductionAccount,
  controlBlockFactory: typeof createReplicaControlBlock = createReplicaControlBlock,
): Promise<ReplicaVersion> {
  let replica = request.replica

  if (!replica) {
    // create new replica
    replica = await createReplica(alpha, k8s, request, accountFactory, controlBlockFactory)
  }

  // ensure memberhips for lists
  request.implementations.$jazz.owner.addMember(replica.$jazz.owner)
  request.requirements.$jazz.owner.addMember(replica.$jazz.owner)

  const loadedReplica = await replica.$jazz.ensureLoaded({
    resolve: {
      versions: true,
      management: true,
    },
  })

  const version = ReplicaVersion.create(
    {
      id: loadedReplica.versions.length + 1,
      status: "unknown",
      digest: request.digest,
      displayInfo: request.displayInfo,
      image: request.image,
      replica: loadedReplica,
      implementations: request.implementations,
      requirements: request.requirements,
    },
    loadedReplica.$jazz.owner,
  )

  // add version to replica
  loadedReplica.versions.$jazz.push(version)

  // set as current version
  loadedReplica.$jazz.set("currentVersion", version)

  // if replica is disabled, enable it
  if (!loadedReplica.management.enabled) {
    loadedReplica.management.$jazz.set("enabled", true)
  }

  return version
}

export async function createReplicaVersionFromLoadRequest(
  alpha: AlphaData,
  k8s: KubernetesSentinelData,
  loadRequest: ReplicaLoadRequest,
  logger: Logger,
  accountFactory: AccountFactory = createProductionAccount,
  controlBlockFactory: typeof createReplicaControlBlock = createReplicaControlBlock,
): Promise<ReplicaVersion> {
  const loadedRequest = await loadRequest.$jazz.ensureLoaded({
    resolve: {
      existingReplica: {
        versions: true,
      },
      approveRequest: {
        implementations: { $each: true },
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
    },
  })

  if (!loadedRequest.approveRequest) {
    throw new Error("Load request has no approve request")
  }

  if (loadedRequest.status !== "approved") {
    throw new Error("Load request has not been approved")
  }

  const requirements = ReplicaVersion.shape.requirements.create(
    {},
    Group.create(alpha.$jazz.loadedAs as Account),
  )

  // deep copy requirements to isolate replica object from load request
  for (const [key, preResolvedRequirement] of Object.entries(
    loadedRequest.approveRequest.requirements,
  )) {
    const resolvedRequirement = ReplicaRequirement.create(
      {
        // contract object has correct ownership
        contract: preResolvedRequirement.contract,

        // copy replicas array
        replicas: co
          .list(Replica)
          .create(Array.from(preResolvedRequirement.replicas.values()), requirements.$jazz.owner),

        multiple: preResolvedRequirement.multiple,
        optional: preResolvedRequirement.optional,

        // copy permissions array
        permissions: co.list(GrantedPermission).create(
          Array.from(preResolvedRequirement.permissions.values()).map(permission => ({
            // set all permissions as approved
            status: "approved",
            requestType: "static",
            permission: permission.permission,
            instanceId: permission.instanceId,
            params: permission.params,
          })),
          requirements.$jazz.owner,
        ),
      },
      requirements.$jazz.owner,
    )

    requirements.$jazz.set(key, resolvedRequirement)
  }

  const resolvedRequest: CreateReplicaVersionInput = {
    // copy implementations to isolate replica object from load request
    implementations: ReplicaVersion.shape.implementations.create(
      Object.fromEntries(Object.entries(loadedRequest.approveRequest.implementations)),
      Group.create(alpha.$jazz.loadedAs as Account),
    ),

    requirements,

    // replica object have correct ownership
    replica: loadedRequest.existingReplica ?? null,

    // copy value-semantic fields
    image: loadedRequest.image,
    digest: loadedRequest.approveRequest.digest,
    displayInfo: loadedRequest.approveRequest.displayInfo,
    identity: loadedRequest.approveRequest.identity,
    info: loadedRequest.approveRequest.info,
    name: loadedRequest.approveRequest.name,
  }

  const replicaVersion = await createReplicaVersion(
    alpha,
    k8s,
    resolvedRequest,
    accountFactory,
    controlBlockFactory,
  )

  // create deployment for new version
  await syncReplicaVersionWorkload(alpha, k8s, replicaVersion, logger)

  // create (if needed) service for the replica
  await syncReplicaVersionServiceAndIngress(k8s, replicaVersion, logger)

  // sync RCB permissions
  await syncReplicaControlBlockPermissions(alpha, replicaVersion, logger)

  // sync RCB requirements
  await syncReplicaControlBlockRequirements(alpha, replicaVersion, logger)

  return replicaVersion
}

const wellKnownReplicaIds: Record<string, number> = {
  seed: 0,
  alpha: 1,
  "kubernetes-sentinel": 2,
}

async function createReplica(
  alpha: AlphaData,
  k8s: KubernetesSentinelData,
  request: CreateReplicaVersionInput,
  accountFactory: AccountFactory,
  controlBlockFactory: typeof createReplicaControlBlock = createReplicaControlBlock,
): Promise<Replica> {
  const loadedAlpha = await alpha.$jazz.ensureLoaded({
    resolve: {
      replicas: true,
      replicaManageGroup: true,
    },
  })

  const config = loadConfig(Config)

  const name = request.name
  const conflictReplica = await getReplicaByName(alpha, name)

  if (conflictReplica) {
    throw new Error(`Replica with name "${name}" already exists`)
  }

  const account = await createReplicaAccount(k8s, name, accountFactory)
  const wellKnownId = wellKnownReplicaIds[request.name]

  const replica = Replica.create(
    {
      id: wellKnownId ?? loadedAlpha.replicas.length,
      name,
      identity: request.identity,
      info: request.info,
      account,
      versions: [],
      management: ReplicaManagementBlock.create(
        { enabled: true, placementGroup: config.RESIDE_DEFAULT_PLACEMENT_GROUP || undefined },
        Group.create(alpha.$jazz.loadedAs as Account),
      ),
    },
    Group.create(alpha.$jazz.loadedAs as Account),
  )

  // management: inherit read access from replica
  replica.management.$jazz.owner.addMember(replica.$jazz.owner, "reader")

  // management: allow accounts with "replica:manage:all" permission to manage the replica
  replica.management.$jazz.owner.addMember(loadedAlpha.replicaManageGroup)

  if (wellKnownId !== undefined && wellKnownId < loadedAlpha.replicas.length) {
    // maintain well-known replica ID positions
    loadedAlpha.replicas.$jazz.splice(wellKnownId, 0, replica)
  } else {
    // append to the end of the replicas list
    loadedAlpha.replicas.$jazz.push(replica)
  }

  // allow reading creaded replica for accounts with `replica:read:all` permission
  replica.$jazz.owner.addMember(loadedAlpha.replicas.$jazz.owner, "reader")

  // create RCB for the replica
  await controlBlockFactory(alpha, replica)

  // create indext for `getReplicaById` lookup
  box(Replica).create(
    { value: replica },
    {
      unique: `replica.by-id.${replica.id}`,
      owner: alpha.$jazz.owner,
    },
  )

  // create index for `getReplicaByName` lookup
  box(Replica).create(
    { value: replica },
    {
      unique: `replica.by-name.${replica.name}`,
      owner: alpha.$jazz.owner,
    },
  )

  // create index for `getReplicasByIdentity` lookup
  await addToIndexList(
    Replica,
    replica,
    `replica.by-identity.${replica.identity}`,
    alpha.$jazz.owner,
  )

  // create indexes for `getReplicasImplementingContract` lookup
  for (const implementation of Object.values(request.implementations)) {
    await addToIndexList(
      Replica,
      replica,
      `replica.by-contract.${implementation.id}`,
      alpha.$jazz.owner,
    )
  }

  return replica
}

async function createReplicaAccount(
  k8s: KubernetesSentinelData,
  resolvedName: string,
  accountFactory: AccountFactory,
): Promise<Account> {
  const account = await accountFactory()

  // request Kubernetes Sentinel to create the secret for this replica
  await createReplicaSecret(
    k8s,
    resolvedName,
    account.$jazz.id,
    account.$jazz.localNode.agentSecret,
  )

  return account
}
