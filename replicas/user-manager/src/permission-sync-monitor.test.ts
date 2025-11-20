import type { AlphaData } from "@contracts/alpha.v1"
import type { Logger } from "pino"
import { describe, expect, test } from "bun:test"
import { testLogger } from "@reside/shared"
import { runPermissionSync } from "./permission-sync-monitor"

type UsersArg = Parameters<typeof runPermissionSync>[1]
type DefaultsArg = Parameters<typeof runPermissionSync>[2]
type SyncFnArg = Parameters<typeof runPermissionSync>[4]

type PermissionSetStub = {
  $isLoaded: boolean
  label: string
}

type PermissionSetCollectionStub = {
  values(): IterableIterator<PermissionSetStub | null>
}

type UserStub = {
  $isLoaded: boolean
  id: number
  account: { $jazz: { id: string } }
  permissionSets: PermissionSetCollectionStub
}

type UserCollectionStub = {
  values(): IterableIterator<UserStub | null>
}

function createPermissionSet(label: string, loaded = true): PermissionSetStub {
  return {
    $isLoaded: loaded,
    label,
  }
}

function createPermissionSetCollection(
  sets: Array<PermissionSetStub | null>,
): PermissionSetCollectionStub {
  return {
    values: function* values() {
      yield* sets
    },
  }
}

function createUser(
  id: number,
  accountId: string,
  permissionSets: PermissionSetCollectionStub,
  loaded = true,
): UserStub {
  return {
    $isLoaded: loaded,
    id,
    account: { $jazz: { id: accountId } },
    permissionSets,
  }
}

function createUserCollection(users: Array<UserStub | null>): UserCollectionStub {
  return {
    values: function* values() {
      yield* users
    },
  }
}

describe("runPermissionSync", () => {
  test("syncs combined default and user permission sets", async () => {
    const defaultSet = createPermissionSet("default")
    const userSet = createPermissionSet("user")

    const defaults = createPermissionSetCollection([defaultSet])
    const users = createUserCollection([
      createUser(1, "account-1", createPermissionSetCollection([userSet])),
    ])

    const calls: Array<{ accountId: string; sets: PermissionSetStub[] }> = []
    const syncFn = async (
      _alpha: AlphaData,
      account: { $jazz: { id: string } },
      permissionSets: PermissionSetStub[],
      logger?: Logger,
    ) => {
      logger?.info(
        { accountId: account.$jazz.id },
        "synchronized replica control block permissions",
      )
      calls.push({ accountId: account.$jazz.id, sets: permissionSets })
    }

    await runPermissionSync(
      {} as AlphaData,
      users as unknown as UsersArg,
      defaults as unknown as DefaultsArg,
      testLogger,
      syncFn as unknown as SyncFnArg,
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]!.accountId).toBe("account-1")
    expect(calls[0]!.sets).toEqual([defaultSet, userSet])
  })

  test("ignores unloaded users and permission sets", async () => {
    const defaultLoaded = createPermissionSet("default-loaded")
    const defaultUnloaded = createPermissionSet("default-unloaded", false)

    const defaults = createPermissionSetCollection([defaultLoaded, defaultUnloaded])
    const userLoaded = createUser(
      1,
      "account-1",
      createPermissionSetCollection([createPermissionSet("user-loaded")]),
    )
    const userUnloaded = createUser(
      2,
      "account-2",
      createPermissionSetCollection([createPermissionSet("user-unloaded")]),
      false,
    )

    const users = createUserCollection([userLoaded, userUnloaded])

    const calls: Array<{ accountId: string; sets: PermissionSetStub[] }> = []
    const syncFn = async (
      _alpha: AlphaData,
      account: { $jazz: { id: string } },
      permissionSets: PermissionSetStub[],
      logger?: Logger,
    ) => {
      logger?.info(
        { accountId: account.$jazz.id },
        "synchronized replica control block permissions",
      )
      calls.push({ accountId: account.$jazz.id, sets: permissionSets })
    }

    await runPermissionSync(
      {} as AlphaData,
      users as unknown as UsersArg,
      defaults as unknown as DefaultsArg,
      testLogger,
      syncFn as unknown as SyncFnArg,
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]!.accountId).toBe("account-1")
    expect(calls[0]!.sets).toEqual([
      defaultLoaded,
      expect.objectContaining({ label: "user-loaded" }),
    ])
  })

  test("continues when sync fails", async () => {
    const permissionSet = createPermissionSet("user")
    const defaults = createPermissionSetCollection([])
    const users = createUserCollection([
      createUser(7, "account-7", createPermissionSetCollection([permissionSet])),
    ])

    let attempts = 0
    const syncFn = async () => {
      attempts += 1
      throw new Error("boom")
    }

    expect(
      runPermissionSync(
        {} as AlphaData,
        users as unknown as UsersArg,
        defaults as unknown as DefaultsArg,
        testLogger,
        syncFn as unknown as SyncFnArg,
      ),
    ).resolves.toBeUndefined()

    expect(attempts).toBe(1)
  })
})
