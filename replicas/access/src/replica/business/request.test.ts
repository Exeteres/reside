import type { GenericOperationService } from "@reside/common"
import type { Client } from "@temporalio/client"
import type { Operation as AccessOperation, PrismaClient } from "../../database"
import { describe, expect, test } from "bun:test"
import { mockDeepFn, mockFn } from "@reside/common/testing"
import { requestPermissions } from "./request"

describe("requestPermissions", () => {
  test("throws when effective subject id is unavailable", () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<AccessOperation>>()
    const temporalClient = mockDeepFn<Client>()

    expect(
      requestPermissions(prisma, operationService, temporalClient, undefined, {
        subjectId: undefined,
        permissionSetName: undefined,
        reason: "need access",
        items: [],
      }),
    ).rejects.toThrow("subject_id is missing and requester subject id is unavailable")
  })

  test("throws when subject id has invalid format", () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<AccessOperation>>()
    const temporalClient = mockDeepFn<Client>()

    expect(
      requestPermissions(prisma, operationService, temporalClient, "replica:alpha", {
        subjectId: "invalid",
        permissionSetName: undefined,
        reason: "need access",
        items: [],
      }),
    ).rejects.toThrow('subject_id must be in format "{realm}:{name}"')
  })

  test("throws when requested permissions are missing", () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<AccessOperation>>()
    const temporalClient = mockDeepFn<Client>()

    prisma.permission.findMany.mockResolvedValue([] as never)

    expect(
      requestPermissions(prisma, operationService, temporalClient, "replica:alpha", {
        subjectId: "telegram:1",
        permissionSetName: undefined,
        reason: "need access",
        items: [
          {
            permissionName: "perm.missing",
            scope: undefined,
          },
        ],
      }),
    ).rejects.toThrow("Permissions not found: perm.missing")
  })

  test("throws when scoped permission is requested without scope", () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<AccessOperation>>()
    const temporalClient = mockDeepFn<Client>()

    prisma.permission.findMany.mockResolvedValue([
      {
        id: 1,
        name: "perm.scoped",
        scoped: true,
      },
    ] as never)

    expect(
      requestPermissions(prisma, operationService, temporalClient, "replica:alpha", {
        subjectId: "telegram:1",
        permissionSetName: undefined,
        reason: "need access",
        items: [
          {
            permissionName: "perm.scoped",
            scope: undefined,
          },
        ],
      }),
    ).rejects.toThrow('Permission "perm.scoped" requires scope descriptor')
  })

  test("returns undefined operation when bindings already satisfy request", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<AccessOperation>>()
    const temporalClient = mockDeepFn<Client>()
    const tx = mockDeepFn<PrismaClient>()

    prisma.permission.findMany.mockResolvedValue([
      {
        id: 1,
        name: "perm.read",
        scoped: false,
      },
    ] as never)
    prisma.permissionRestriction.findFirst.mockResolvedValue(null as never)
    prisma.$transaction.mockImplementation(async callback => await callback(tx as never))

    tx.permissionSet.upsert.mockResolvedValue({ id: 10 } as never)
    tx.permissionSetItem.findMany.mockResolvedValue([] as never)
    tx.permissionBinding.findMany.mockResolvedValue([
      {
        permissionId: 1,
        scope: null,
      },
    ] as never)

    const result = await requestPermissions(
      prisma,
      operationService,
      temporalClient,
      "replica:alpha",
      {
        subjectId: "telegram:1",
        permissionSetName: undefined,
        reason: "need access",
        items: [
          {
            permissionName: "perm.read",
            scope: undefined,
          },
        ],
      },
    )

    expect(result).toEqual({
      operation: undefined,
    })
    expect(operationService.toApiOperation.spy()).toHaveBeenCalledTimes(0)
    expect(temporalClient.workflow.start.spy()).toHaveBeenCalledTimes(0)
  })

  test("reuses existing pending matching request operation", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<AccessOperation>>()
    const temporalClient = mockDeepFn<Client>()
    const tx = mockDeepFn<PrismaClient>()

    prisma.permission.findMany.mockResolvedValue([
      {
        id: 1,
        name: "perm.read",
        scoped: false,
      },
    ] as never)
    prisma.permissionRestriction.findFirst.mockResolvedValue(null as never)
    prisma.$transaction.mockImplementation(async callback => await callback(tx as never))

    tx.permissionSet.upsert.mockResolvedValue({ id: 10 } as never)
    tx.permissionSetItem.findMany.mockResolvedValue([] as never)
    tx.permissionBinding.findMany.mockResolvedValue([] as never)
    tx.permissionRequestSet.findMany.mockResolvedValue([
      {
        id: 123,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        operation: {
          id: 77,
          status: "PENDING",
        },
        items: [
          {
            permissionId: 1,
            scope: null,
          },
        ],
      },
    ] as never)
    operationService.toApiOperation.mockResolvedValue({ id: 77 } as never)

    const result = await requestPermissions(
      prisma,
      operationService,
      temporalClient,
      "replica:alpha",
      {
        subjectId: "telegram:1",
        permissionSetName: "default",
        reason: "need access",
        items: [
          {
            permissionName: "perm.read",
            scope: undefined,
          },
        ],
      },
    )

    expect(operationService.toApiOperation.spy()).toHaveBeenCalledWith(77)
    expect(temporalClient.workflow.start.spy()).toHaveBeenCalledTimes(0)
    expect(result.operation?.id).toBe(77)
  })

  test("creates new operation, cancels superseded operation and starts workflow", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const operationService = mockDeepFn<GenericOperationService<AccessOperation>>()
    const temporalClient = mockDeepFn<Client>()
    const tx = mockDeepFn<PrismaClient>()
    const cancel = mockFn()

    prisma.permission.findMany.mockResolvedValue([
      {
        id: 1,
        name: "perm.read",
        scoped: false,
      },
    ] as never)
    prisma.permissionRestriction.findFirst.mockResolvedValue(null as never)
    prisma.$transaction.mockImplementation(async callback => await callback(tx as never))

    tx.permissionSet.upsert.mockResolvedValue({ id: 10 } as never)
    tx.permissionSetItem.findMany.mockResolvedValue([] as never)
    tx.permissionBinding.findMany.mockResolvedValue([] as never)
    tx.permissionRequestSet.findMany.mockResolvedValue([
      {
        id: 321,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        operation: {
          id: 50,
          status: "PENDING",
        },
        items: [
          {
            permissionId: 999,
            scope: null,
          },
        ],
      },
    ] as never)
    tx.operation.create.mockResolvedValue({ id: 88 } as never)
    tx.permissionRequestSet.create.mockResolvedValue({ id: 999 } as never)

    temporalClient.workflow.getHandle.mockReturnValue({
      cancel,
    } as never)
    operationService.toApiOperation.mockResolvedValue({ id: 88 } as never)

    const result = await requestPermissions(
      prisma,
      operationService,
      temporalClient,
      "replica:alpha",
      {
        subjectId: "telegram:1",
        permissionSetName: "default",
        reason: "need access",
        items: [
          {
            permissionName: "perm.read",
            scope: undefined,
          },
        ],
      },
    )

    expect(temporalClient.workflow.getHandle.spy()).toHaveBeenCalledWith(
      "approve-permission-request-set-50",
    )
    expect(cancel.spy()).toHaveBeenCalledTimes(1)
    expect(temporalClient.workflow.start.spy()).toHaveBeenCalledTimes(1)
    expect(operationService.toApiOperation.spy()).toHaveBeenCalledWith(88)
    expect(result.operation?.id).toBe(88)
  })
})
