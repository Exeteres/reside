import { describe, expect, test } from "bun:test"
import { grantPermissionToUser } from "./user"

describe("grantPermissionToUser", () => {
  test("validates that permission sets must be loaded", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: mock object for testing
    const mockUser: any = {
      id: 1,
      permissionSets: {
        $isLoaded: false,
      },
    }

    // biome-ignore lint/suspicious/noExplicitAny: mock object for testing
    const mockContract: any = {}
    // biome-ignore lint/suspicious/noExplicitAny: mock object for testing
    const mockPermission: any = {}
    // biome-ignore lint/suspicious/noExplicitAny: mock object for testing
    const mockReplicas: any = []

    // should throw error when permission sets not loaded
    await expect(
      grantPermissionToUser(mockUser, mockContract, mockPermission, mockReplicas, {}),
    ).rejects.toThrow("User's permission sets are not loaded")
  })
})
