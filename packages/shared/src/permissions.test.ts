import { beforeEach, expect, test } from "bun:test"
import { co, Group, z } from "jazz-tools"
import { createJazzTestAccount, setupJazzTestSync } from "jazz-tools/testing"
import { type Contract, defineContract } from "./contract"
import {
  ControlBlockPermission,
  ControlBlockPermissions,
  reconcileControlBlockPermissions,
} from "./permissions"
import { ReplicaAccount } from "./replica"
import { defineReplica } from "./replica-definition"
import { createReplicaTestAccount, testLogger } from "./testing"

type HandlerCall =
  | { type: "grant"; params: Record<string, unknown> }
  | { type: "revoke"; params: Record<string, unknown> }
  | { type: "update"; params: Record<string, unknown>; oldParams: Record<string, unknown> }

const handlerCalls: HandlerCall[] = []

beforeEach(() => {
  handlerCalls.length = 0
})

const TestContract = defineContract({
  identity: "test",

  data: co.map({
    protectedMap: co.map({
      value: z.string(),
    }),
  }),

  migration: data => {
    if (!data.protectedMap) {
      // this way protectedMap will inherit default read access which is not what we want
      // data.$jazz.set("protectedMap", { value: "" })

      // what we really want is to make new group-owned structure and manage its access ourselves
      // "create" by default creates new group
      data.$jazz.set("protectedMap", TestContract.data.shape.protectedMap.create({ value: "" }))
    }
  },

  displayInfo: {},

  permissions: {
    "test.permission": {
      displayInfo: {},
      params: z.object({
        scope: z.string().optional(),
      }),

      onGranted: async (data, account, params) => {
        const loadedData = await data.$jazz.ensureLoaded({ resolve: { protectedMap: true } })

        loadedData.protectedMap.$jazz.owner.addMember(account, "writer")
        handlerCalls.push({ type: "grant", params })
      },

      onUpdated: async (data, _account, params, oldParams) => {
        const loadedData = await data.$jazz.ensureLoaded({ resolve: { protectedMap: true } })

        if (typeof params.scope === "string") {
          loadedData.protectedMap.$jazz.set("value", params.scope)
        }

        handlerCalls.push({ type: "update", params, oldParams })
      },

      onRevoked: async (data, account, params) => {
        const loadedData = await data.$jazz.ensureLoaded({ resolve: { protectedMap: true } })

        loadedData.protectedMap.$jazz.owner.removeMember(account)
        handlerCalls.push({ type: "revoke", params })
      },
    },
  },
})

const replica = defineReplica({
  identity: "test-replica",
  displayInfo: {},
  info: {
    name: "test",
    class: "oneshot",
    exclusive: false,
    scalable: false,
  },

  implementations: { TestContract },
})

const TestReplica = ReplicaAccount(undefined, { TestContract })

const contracts = new Map<string, Contract>()
contracts.set(TestContract.identity, TestContract)

async function setupReplicaAndTarget() {
  await setupJazzTestSync()

  const { account: replicaAccount } = await createReplicaTestAccount(replica)

  const targetAccount = await createJazzTestAccount()

  const targetAccountOnReplicaSide = await co.account().load(targetAccount.$jazz.id, {
    loadAs: replicaAccount,
  })

  if (!targetAccountOnReplicaSide.$isLoaded) {
    throw new Error("Failed to load target account on replica side")
  }

  return { replicaAccount, targetAccount, targetAccountOnReplicaSide }
}

test("reconcile grants permissions when expected state is true", async () => {
  // arrange
  const { replicaAccount, targetAccount, targetAccountOnReplicaSide } =
    await setupReplicaAndTarget()

  const loadedTargetAccountOnReplicaSide = await targetAccountOnReplicaSide.$jazz.ensureLoaded({
    resolve: { profile: true },
  })

  if (!loadedTargetAccountOnReplicaSide.$isLoaded) {
    throw new Error("Failed to load target account details")
  }

  const permissionKey = `${loadedTargetAccountOnReplicaSide.$jazz.id}:test.permission`

  const permissionEntry = ControlBlockPermission.create(
    {
      identity: TestContract.identity,
      name: "test.permission",
      account: loadedTargetAccountOnReplicaSide,
      expected: { granted: true, params: {} },
      current: { granted: false, params: {} },
    },
    Group.create(),
  )

  const permissions = ControlBlockPermissions.create(
    { [permissionKey]: permissionEntry },
    Group.create(),
  )

  // act
  await reconcileControlBlockPermissions(replicaAccount, permissions, contracts, testLogger)

  // assert
  expect(permissions[permissionKey]?.current).toEqual({ granted: true, params: {} })
  expect(permissions[permissionKey]?.expected).toEqual({ granted: true, params: {} })

  expect(handlerCalls).toEqual([{ type: "grant", params: {} }])

  // write data on target account side
  const replicaOnTargetSide = await TestReplica.load(replicaAccount.$jazz.id, {
    loadAs: targetAccount,
    resolve: {},
    // resolve: { profile: { contracts: { test: { protectedMap: true } } } },
  })

  if (!replicaOnTargetSide.$isLoaded) {
    throw new Error("Failed to load replica account on target side")
  }

  const loadedReplicaOnTargetSide = await replicaOnTargetSide.$jazz.ensureLoaded({
    resolve: { profile: { contracts: { test: { protectedMap: true } } } },
  })

  if (!loadedReplicaOnTargetSide) {
    throw new Error("Failed to load replica account data")
  }

  const replicaSideTest = new Promise<void>(resolve => {
    loadedReplicaOnTargetSide.profile.contracts.test.$jazz.subscribe(contractData => {
      if (contractData.protectedMap?.value !== "new value") return
      resolve()
    })
  })

  loadedReplicaOnTargetSide.profile.contracts.test.protectedMap.$jazz.set("value", "new value")
  await loadedReplicaOnTargetSide.$jazz.waitForAllCoValuesSync({ timeout: 500 })

  // verify data is synced to replica side
  await replicaSideTest
})

test("reconcile does nothing when expected matches current", async () => {
  const { replicaAccount, targetAccountOnReplicaSide } = await setupReplicaAndTarget()

  const loadedTargetAccountOnReplicaSide = await targetAccountOnReplicaSide.$jazz.ensureLoaded({
    resolve: { profile: true },
  })

  if (!loadedTargetAccountOnReplicaSide.$isLoaded) {
    throw new Error("Failed to load target account details")
  }

  const permissionKey = `${loadedTargetAccountOnReplicaSide.$jazz.id}:test.permission`

  const permissionEntry = ControlBlockPermission.create(
    {
      identity: TestContract.identity,
      name: "test.permission",
      account: loadedTargetAccountOnReplicaSide,
      expected: { granted: true, params: { scope: "read" } },
      current: { granted: true, params: { scope: "read" } },
    },
    Group.create(),
  )

  const permissions = ControlBlockPermissions.create(
    { [permissionKey]: permissionEntry },
    Group.create(),
  )

  await reconcileControlBlockPermissions(replicaAccount, permissions, contracts, testLogger)

  expect(handlerCalls).toEqual([])
  expect(permissions[permissionKey]?.current).toEqual({ granted: true, params: { scope: "read" } })
  expect(permissions[permissionKey]?.expected).toEqual({ granted: true, params: { scope: "read" } })
})

test("reconcile updates permission params when they change", async () => {
  const { replicaAccount, targetAccountOnReplicaSide } = await setupReplicaAndTarget()

  const loadedTargetAccountOnReplicaSide = await targetAccountOnReplicaSide.$jazz.ensureLoaded({
    resolve: { profile: true },
  })

  if (!loadedTargetAccountOnReplicaSide.$isLoaded) {
    throw new Error("Failed to load target account details")
  }

  const permissionKey = `${loadedTargetAccountOnReplicaSide.$jazz.id}:test.permission`

  const permissionEntry = ControlBlockPermission.create(
    {
      identity: TestContract.identity,
      name: "test.permission",
      account: loadedTargetAccountOnReplicaSide,
      expected: { granted: true, params: { scope: "read" } },
      current: { granted: false, params: {} },
    },
    Group.create(),
  )

  const permissions = ControlBlockPermissions.create(
    { [permissionKey]: permissionEntry },
    Group.create(),
  )

  await reconcileControlBlockPermissions(replicaAccount, permissions, contracts, testLogger)
  await replicaAccount.$jazz.waitForAllCoValuesSync({ timeout: 500 })

  expect(handlerCalls).toEqual([{ type: "grant", params: { scope: "read" } }])
  handlerCalls.length = 0

  permissions[permissionKey]!.$jazz.set("expected", { granted: true, params: { scope: "write" } })

  await reconcileControlBlockPermissions(replicaAccount, permissions, contracts, testLogger)
  await replicaAccount.$jazz.waitForAllCoValuesSync({ timeout: 500 })

  expect(handlerCalls).toEqual([
    { type: "update", params: { scope: "write" }, oldParams: { scope: "read" } },
  ])

  expect(permissions[permissionKey]?.current).toEqual({ granted: true, params: { scope: "write" } })
  expect(permissions[permissionKey]?.expected).toEqual({
    granted: true,
    params: { scope: "write" },
  })

  const loadedReplicaAccount = await replicaAccount.$jazz.ensureLoaded({
    resolve: { profile: { contracts: { test: { protectedMap: true } } } },
  })

  expect(loadedReplicaAccount.profile.contracts.test.protectedMap.value).toBe("write")
})

test("do not allow write without granted permission", async () => {
  // arrange
  const { replicaAccount, targetAccount } = await setupReplicaAndTarget()

  const replicaOnTargetSide = await TestReplica.load(replicaAccount.$jazz.id, {
    loadAs: targetAccount,
    resolve: { profile: { contracts: { test: { protectedMap: true } } } },
  })

  expect(replicaOnTargetSide.$jazz.loadingState).toBe("unauthorized")
})

test("reconcile revokes permissions when expected state toggles to false", async () => {
  // arrange
  const { replicaAccount, targetAccount, targetAccountOnReplicaSide } =
    await setupReplicaAndTarget()

  const permissionKey = `${targetAccountOnReplicaSide.$jazz.id}:test.permission`

  const permissionEntry = ControlBlockPermission.create(
    {
      identity: TestContract.identity,
      name: "test.permission",
      account: targetAccountOnReplicaSide,
      expected: { granted: true, params: {} },
      current: { granted: false, params: {} },
    },
    Group.create(),
  )

  const permissions = ControlBlockPermissions.create(
    { [permissionKey]: permissionEntry },
    Group.create(),
  )

  // grant first
  await reconcileControlBlockPermissions(replicaAccount, permissions, contracts, testLogger)
  await replicaAccount.$jazz.waitForAllCoValuesSync({ timeout: 500 })

  expect(handlerCalls).toEqual([{ type: "grant", params: {} }])
  handlerCalls.length = 0

  const grantedReplica = await TestReplica.load(replicaAccount.$jazz.id, {
    loadAs: targetAccount,
    resolve: { profile: { contracts: { test: { protectedMap: true } } } },
  })

  if (!grantedReplica) {
    throw new Error("Failed to load replica account on target side after grant")
  }

  // toggle expectation to false and reconcile again
  permissions[permissionKey]!.$jazz.set("expected", { granted: false, params: {} })

  await reconcileControlBlockPermissions(replicaAccount, permissions, contracts, testLogger)
  await replicaAccount.$jazz.waitForAllCoValuesSync({ timeout: 500 })

  expect(permissions[permissionKey]?.current).toEqual({ granted: false, params: {} })
  expect(permissions[permissionKey]?.expected).toEqual({ granted: false, params: {} })

  expect(handlerCalls).toEqual([{ type: "revoke", params: {} }])

  // verify that consumer can no longer write to replica data
  const replicaAfterRevoke = await TestReplica.load(replicaAccount.$jazz.id, {
    loadAs: targetAccount,
    resolve: { profile: { contracts: { test: { protectedMap: true } } } },
  })

  expect(replicaAfterRevoke.$jazz.loadingState).toBe("unauthorized")
})
