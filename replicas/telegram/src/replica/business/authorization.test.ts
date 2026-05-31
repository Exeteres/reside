import type { AuthzServiceClient } from "@reside/api/access/authz.v1"
import type { PermissionRequestServiceClient } from "@reside/api/access/request.v1"
import { describe, expect, test } from "bun:test"
import { mockDeepFn } from "@reside/common/testing"
import {
  canAskNls,
  canInteractWithNotificationChannel,
  canInvokeCommand,
  requestCommandInvokePermission,
  requestNlsAskPermission,
  requestNotificationChannelInteractPermission,
} from "./authorization"

describe("canInteractWithNotificationChannel", () => {
  test("returns false when channel is missing", async () => {
    const authzService = mockDeepFn<AuthzServiceClient>()

    const allowed = await canInteractWithNotificationChannel({
      authzService,
      userId: 1,
      channelName: null,
    })

    expect(allowed).toBeFalse()
    expect(authzService.checkPermission.spy()).toHaveBeenCalledTimes(0)
  })

  test("returns permission check result", async () => {
    const authzService = mockDeepFn<AuthzServiceClient>()
    authzService.checkPermission.mockResolvedValue({ authorized: true } as never)

    const allowed = await canInteractWithNotificationChannel({
      authzService,
      userId: 1,
      channelName: "alerts",
    })

    expect(allowed).toBeTrue()
    expect(authzService.checkPermission.spy()).toHaveBeenCalledTimes(1)
  })

  test("returns false on authz errors", async () => {
    const authzService = mockDeepFn<AuthzServiceClient>()
    authzService.checkPermission.mockRejectedValue(new Error("boom"))

    const allowed = await canInteractWithNotificationChannel({
      authzService,
      userId: 1,
      channelName: "alerts",
    })

    expect(allowed).toBeFalse()
  })
})

describe("canInvokeCommand", () => {
  test("returns checked=false when authz fails", async () => {
    const authzService = mockDeepFn<AuthzServiceClient>()
    authzService.checkPermission.mockRejectedValue(new Error("boom"))

    const result = await canInvokeCommand({
      authzService,
      userId: 1,
      commandName: "deploy",
    })

    expect(result).toEqual({
      authorized: false,
      checked: false,
    })
  })
})

describe("requestCommandInvokePermission", () => {
  test("submits permission request", async () => {
    const permissionRequestService = mockDeepFn<PermissionRequestServiceClient>()
    permissionRequestService.requestPermissions.mockResolvedValue({} as never)

    await requestCommandInvokePermission({
      permissionRequestService,
      userId: 7,
      commandName: "deploy",
    })

    expect(permissionRequestService.requestPermissions.spy()).toHaveBeenCalledTimes(1)
    expect(permissionRequestService.requestPermissions.spy()).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: "telegram:7",
        items: [
          expect.objectContaining({
            scope: "deploy",
          }),
        ],
      }),
    )
  })

  test("swallows request errors", async () => {
    const permissionRequestService = mockDeepFn<PermissionRequestServiceClient>()
    permissionRequestService.requestPermissions.mockRejectedValue(new Error("boom"))

    await requestCommandInvokePermission({
      permissionRequestService,
      userId: 7,
      commandName: "deploy",
    })

    expect(permissionRequestService.requestPermissions.spy()).toHaveBeenCalledTimes(1)
  })
})

describe("requestNotificationChannelInteractPermission", () => {
  test("submits interaction permission request", async () => {
    const permissionRequestService = mockDeepFn<PermissionRequestServiceClient>()
    permissionRequestService.requestPermissions.mockResolvedValue({} as never)

    await requestNotificationChannelInteractPermission({
      permissionRequestService,
      userId: 7,
      channelName: "alerts",
    })

    expect(permissionRequestService.requestPermissions.spy()).toHaveBeenCalledTimes(1)
    expect(permissionRequestService.requestPermissions.spy()).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: "telegram:7",
        items: [
          expect.objectContaining({
            scope: "alerts",
          }),
        ],
      }),
    )
  })

  test("swallows interaction permission request errors", async () => {
    const permissionRequestService = mockDeepFn<PermissionRequestServiceClient>()
    permissionRequestService.requestPermissions.mockRejectedValue(new Error("boom"))

    await requestNotificationChannelInteractPermission({
      permissionRequestService,
      userId: 7,
      channelName: "alerts",
    })

    expect(permissionRequestService.requestPermissions.spy()).toHaveBeenCalledTimes(1)
  })
})

describe("nls permission helpers", () => {
  test("canAskNls returns checked=false on failure", async () => {
    const authzService = mockDeepFn<AuthzServiceClient>()
    authzService.checkPermission.mockRejectedValue(new Error("boom"))

    const result = await canAskNls({
      authzService,
      fromSubjectId: "telegram:1",
      toSubjectId: "replica:alpha",
    })

    expect(result).toEqual({
      authorized: false,
      checked: false,
    })
  })

  test("requestNlsAskPermission submits request", async () => {
    const permissionRequestService = mockDeepFn<PermissionRequestServiceClient>()
    permissionRequestService.requestPermissions.mockResolvedValue({} as never)

    await requestNlsAskPermission({
      permissionRequestService,
      fromSubjectId: "telegram:1",
      toSubjectId: "replica:alpha",
    })

    expect(permissionRequestService.requestPermissions.spy()).toHaveBeenCalledTimes(1)
    expect(permissionRequestService.requestPermissions.spy()).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: "telegram:1",
      }),
    )
  })
})
