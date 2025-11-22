import type { AlphaData } from "@contracts/alpha.v1"
import { beforeAll, describe, expect, test } from "bun:test"
import {
  ContractEntity,
  GrantedPermission,
  GrantedPermissionSet,
  PermissionEntity,
  Replica,
} from "@contracts/alpha.v1"
import { KubernetesSentinelContract } from "@contracts/kubernetes-sentinel.v1"
import { createReplicaTestAccount, testLogger } from "@reside/shared"
import { co } from "jazz-tools"
import { createJazzTestAccount, setupJazzTestSync } from "jazz-tools/testing"
import {
  createReplicaControlBlock,
  getReplicaControlBlock,
  syncControlBlockPermissions,
} from "./control-block"
import { AlphaReplica } from "./replica"

let nextReplicaId = 1_000

type PermissionInput = {
  name: string
  status: "approved" | "pending" | "rejected"
  params?: Record<string, unknown>
  instanceId?: string
  displayTitle?: string
  displayDescription?: string
}

async function createTestReplica(alpha: AlphaData, name: string): Promise<Replica> {
  const account = await createJazzTestAccount()

  const replicaInstance = Replica.create({
    id: nextReplicaId++,
    name,
    identity: `ghcr.io/exeteres/reside/replicas/${name}`,
    info: {
      name,
      class: "long-running",
      exclusive: false,
      scalable: true,
    },
    account,
    currentVersion: null!,
    versions: [],
    management: { enabled: true },
  })

  await createReplicaControlBlock(alpha, replicaInstance)

  return replicaInstance
}

beforeAll(async () => {
  await setupJazzTestSync()
})

describe("syncControlBlockPermissions", () => {
  test("creates expected entries for approved permissions", async () => {
    const context = await setupScenario({
      permissions: [
        { name: "deployment:manage:all", status: "approved", params: { scope: "cluster" } },
        { name: "secret:manage:all", status: "pending" },
      ],
    })

    const loadedTarget = await context.sync()
    const accountId = loadedTarget.account.$jazz.id
    const dependencyControlBlock = await context.getControlBlock(context.dependencies[0]!)
    const targetControlBlock = await context.getControlBlock(context.target)

    const approvedPermission = context.grantedPermissions[0]!
    const approvedKey = buildPermissionKey(accountId, approvedPermission.permission.name)
    const approvedEntry = dependencyControlBlock.permissions[approvedKey]

    expect(approvedEntry).toBeDefined()
    expect(approvedEntry!.identity).toBe(context.contract.identity)
    expect(approvedEntry!.expected.granted).toBe(true)
    expect(approvedEntry!.expected.params).toEqual({ scope: "cluster" })
    expect(approvedEntry!.current?.granted ?? false).toBe(false)

    const keys = Object.keys(dependencyControlBlock.permissions)
    expect(keys).toContain(approvedKey)
    expect(keys.length).toBe(1)

    expect(Object.keys(targetControlBlock.permissions)).toHaveLength(0)
  })

  test("marks permissions as revoked when status becomes pending", async () => {
    const context = await setupScenario({
      permissions: [{ name: "deployment:manage:all", status: "approved" }],
    })

    const loadedTarget = await context.sync()
    const accountId = loadedTarget.account.$jazz.id
    const dependencyControlBlock = await context.getControlBlock(context.dependencies[0]!)
    const permissionKey = buildPermissionKey(
      accountId,
      context.grantedPermissions[0]!.permission.name,
    )

    expect(dependencyControlBlock.permissions[permissionKey]?.expected.granted).toBe(true)

    context.grantedPermissions[0]!.$jazz.set("status", "pending")

    await context.sync()

    const controlBlockAfter = await context.getControlBlock(context.dependencies[0]!)
    const entryAfter = controlBlockAfter.permissions[permissionKey]

    expect(entryAfter).toBeDefined()
    expect(entryAfter!.expected.granted).toBe(false)
  })

  test("updates expected params when they change", async () => {
    const context = await setupScenario({
      permissions: [
        { name: "deployment:manage:all", status: "approved", params: { scope: "read" } },
      ],
    })

    const loadedTarget = await context.sync()
    const accountId = loadedTarget.account.$jazz.id
    const permissionKey = buildPermissionKey(
      accountId,
      context.grantedPermissions[0]!.permission.name,
    )

    const initialControlBlock = await context.getControlBlock(context.dependencies[0]!)
    expect(initialControlBlock.permissions[permissionKey]?.expected.params).toEqual({
      scope: "read",
    })

    context.grantedPermissions[0]!.$jazz.set("params", { scope: "write" })

    await context.sync()

    const controlBlockAfter = await context.getControlBlock(context.dependencies[0]!)
    expect(controlBlockAfter.permissions[permissionKey]?.expected.params).toEqual({
      scope: "write",
    })
  })

  test("syncs permissions for multiple dependent replicas", async () => {
    const context = await setupScenario({
      permissions: [{ name: "deployment:manage:all", status: "approved" }],
      dependencyNames: ["dependency-b"],
    })

    const loadedTarget = await context.sync()
    const accountId = loadedTarget.account.$jazz.id
    const permissionName = context.grantedPermissions[0]!.permission.name

    for (const dependency of context.dependencies) {
      const controlBlock = await context.getControlBlock(dependency)
      const entry = controlBlock.permissions[buildPermissionKey(accountId, permissionName)]

      expect(entry?.expected.granted).toBe(true)
    }
  })

  test("keeps control block empty when no permission sets provided", async () => {
    const context = await setupScenario({ permissions: [] })

    await context.sync()

    const controlBlock = await context.getControlBlock(context.target)
    expect(Object.keys(controlBlock.permissions)).toHaveLength(0)
  })
})

function buildPermissionKey(
  accountId: string,
  permissionName: string,
  instanceId?: string,
): string {
  return instanceId
    ? `${accountId}:${KubernetesSentinelContract.identity}:${permissionName}:${instanceId}`
    : `${accountId}:${KubernetesSentinelContract.identity}:${permissionName}`
}

async function setupScenario({
  permissions,
  dependencyNames = [],
  targetName = "alpha-target",
}: {
  permissions: PermissionInput[]
  dependencyNames?: string[]
  targetName?: string
}) {
  const {
    implements: { alpha },
  } = await createReplicaTestAccount(AlphaReplica)

  const alphaData = alpha.data

  const dependencyNamesWithPrimary = ["dependency", ...dependencyNames]

  const dependencies: Replica[] = []
  for (const dependencyName of dependencyNamesWithPrimary) {
    dependencies.push(await createTestReplica(alphaData, dependencyName))
  }

  const contract = ContractEntity.create({
    id: 1,
    identity: "ghcr.io/exeteres/reside/contracts/kubernetes-sentinel.v1",
    displayInfo: {},
    permissions: {},
    methods: {},
  })

  const grantedPermissions = permissions.map(input =>
    GrantedPermission.create({
      requestType: "static",
      status: input.status,
      permission: PermissionEntity.create({
        name: input.name,
        displayInfo: {
          en: {
            title: input.displayTitle ?? input.name,
            description: input.displayDescription ?? "",
          },
        },
      }),
      params: (input.params ?? {}) as GrantedPermission["params"],
      instanceId: input.instanceId,
    }),
  )

  const permissionSet = GrantedPermissionSet.create({
    contract,
    replicas: co.list(Replica).create(dependencies),
    permissions: co.list(GrantedPermission).create(grantedPermissions),
  })

  const permissionSets = permissions.length > 0 ? [permissionSet] : []

  const target = await createTestReplica(alphaData, targetName)

  return {
    alphaData,
    contract,
    dependencies,
    target,
    grantedPermissions,
    permissionSet,
    permissionSets,
    sync: async () => {
      const loadedTarget = await target.$jazz.ensureLoaded({
        resolve: {
          account: {
            profile: true,
          },
        },
      })

      await syncControlBlockPermissions(alphaData, loadedTarget.account, permissionSets, testLogger)

      return loadedTarget
    },
    getControlBlock: async (replicaRef: Replica) => {
      const rcb = await getReplicaControlBlock(alphaData, replicaRef)

      return rcb.$jazz.ensureLoaded({
        resolve: { permissions: { $each: { account: true } } },
      })
    },
  }
}
