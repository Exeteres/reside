import type { Client } from "@temporalio/client"
import type { PrismaClient } from "../../database"
import { describe, expect, test } from "bun:test"
import { ConnectError } from "@connectrpc/connect"
import { mockDeepFn } from "@reside/common/testing"
import {
  assertRequiredValue,
  assertValidSlotNames,
  normalizeEndpointDependencySlots,
  normalizeReplicaDependencySlots,
  registerReplicaDefinition,
  startReplicaReleaseNotesWorkflow,
  toNullableText,
} from "./registration"

describe("toNullableText", () => {
  test("returns null for undefined and blank values", () => {
    expect(toNullableText(undefined)).toBeNull()
    expect(toNullableText("   ")).toBeNull()
  })

  test("returns trimmed text for non-empty values", () => {
    expect(toNullableText("  hello ")).toBe("hello")
  })
})

describe("assertRequiredValue", () => {
  test("throws for empty value", () => {
    expect(() => assertRequiredValue("", "title")).toThrow('Field "title" is required')
  })
})

describe("assertValidSlotNames", () => {
  test("throws for empty slot name", () => {
    expect(() => assertValidSlotNames(["", "dep"], "replicaDependencies")).toThrow(
      'Field "replicaDependencies" contains slot with empty name',
    )
  })

  test("throws for duplicate slot names", () => {
    expect(() => assertValidSlotNames(["dep", "dep"], "replicaDependencies")).toThrow(
      'Field "replicaDependencies" contains duplicate slot name "dep"',
    )
  })
})

describe("slot normalizers", () => {
  test("normalizes replica dependency slots", () => {
    const request = {
      replicaDependencies: [
        {
          name: " dep-a ",
          defaultReplicaName: " alpha ",
        },
        {
          name: "dep-b",
          defaultReplicaName: "   ",
        },
      ],
      endpointDependencies: [],
    }

    const result = normalizeReplicaDependencySlots(request as never)

    expect(result).toEqual([
      {
        name: "dep-a",
        defaultReplicaName: "alpha",
      },
      {
        name: "dep-b",
        defaultReplicaName: null,
      },
    ])
  })

  test("normalizes endpoint dependency slots", () => {
    const request = {
      replicaDependencies: [],
      endpointDependencies: [
        {
          name: " api ",
          defaultEndpoint: " https://example.internal ",
        },
      ],
    }

    const result = normalizeEndpointDependencySlots(request as never)

    expect(result).toEqual([
      {
        name: "api",
        defaultEndpoint: "https://example.internal",
      },
    ])
  })
})

describe("startReplicaReleaseNotesWorkflow", () => {
  test("wraps regular errors into connect internal error", async () => {
    const temporalClient = mockDeepFn<Client>()
    temporalClient.workflow.start.mockRejectedValue(new Error("boom"))

    const promise = startReplicaReleaseNotesWorkflow(temporalClient, {
      replicaName: "alpha",
      replicaTitle: "Альфа Реплика",
      oldVersion: "0.1.0",
      newVersion: "0.1.1",
      changes: "Исправлены ошибки.",
    })

    expect(promise).rejects.toBeInstanceOf(ConnectError)
    expect(promise).rejects.toThrow("boom")
  })

  test("throws generic internal error for unknown throw type", async () => {
    const temporalClient = mockDeepFn<Client>()
    temporalClient.workflow.start.mockRejectedValue("boom" as never)

    expect(
      startReplicaReleaseNotesWorkflow(temporalClient, {
        replicaName: "alpha",
        replicaTitle: "Альфа Реплика",
        oldVersion: "0.1.0",
        newVersion: "0.1.1",
        changes: "Исправлены ошибки.",
      }),
    ).rejects.toThrow("Failed to schedule replica release notes workflow")
  })
})

describe("registerReplicaDefinition version/changes rules", () => {
  test("sets changes to null when version changes without reported changes", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    let upsertArgs: unknown

    prisma.replica.findMany.mockResolvedValue([] as never)
    prisma.$transaction.mockImplementation(async callback => {
      const tx = {
        replica: {
          findUnique: async () => ({ version: "1.0.0", changes: "old changes" }),
          upsert: async (args: unknown) => {
            upsertArgs = args
            return { id: 1 }
          },
        },
        replicaDependencySlot: {
          deleteMany: async () => ({ count: 0 }),
          upsert: async () => ({}),
        },
        replicaEndpointDependencySlot: {
          deleteMany: async () => ({ count: 0 }),
          upsert: async () => ({}),
        },
      }

      return await callback(tx as never)
    })

    await registerReplicaDefinition({
      prisma,
      replicaName: "alpha",
      request: {
        title: "Alpha",
        description: "",
        internalEndpoint: "http://alpha",
        replicaDependencies: [],
        endpointDependencies: [],
        version: "1.1.0",
        changes: "",
      } as never,
    })

    const payload = upsertArgs as {
      create: { changes: string | null }
      update: { changes: string | null }
    }

    expect(payload.update.changes).toBeNull()
    expect(payload.create.changes).toBeNull()
  })

  test("keeps previous changes when version does not change", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    let upsertArgs: unknown

    prisma.replica.findMany.mockResolvedValue([] as never)
    prisma.$transaction.mockImplementation(async callback => {
      const tx = {
        replica: {
          findUnique: async () => ({ version: "1.0.0", changes: "old changes" }),
          upsert: async (args: unknown) => {
            upsertArgs = args
            return { id: 1 }
          },
        },
        replicaDependencySlot: {
          deleteMany: async () => ({ count: 0 }),
          upsert: async () => ({}),
        },
        replicaEndpointDependencySlot: {
          deleteMany: async () => ({ count: 0 }),
          upsert: async () => ({}),
        },
      }

      return await callback(tx as never)
    })

    const output = await registerReplicaDefinition({
      prisma,
      replicaName: "alpha",
      request: {
        title: "Alpha",
        description: "",
        internalEndpoint: "http://alpha",
        replicaDependencies: [],
        endpointDependencies: [],
        version: "1.0.0",
        changes: "new changes should be ignored",
      } as never,
    })

    const payload = upsertArgs as {
      update: { changes: string | null }
    }

    expect(payload.update.changes).toBe("old changes")
    expect(output.releaseNotes).toBeNull()
  })

  test("creates release notes with null oldVersion on first version report", async () => {
    const prisma = mockDeepFn<PrismaClient>()

    prisma.replica.findMany.mockResolvedValue([] as never)
    prisma.$transaction.mockImplementation(async callback => {
      const tx = {
        replica: {
          findUnique: async () => null,
          upsert: async () => ({ id: 1 }),
        },
        replicaDependencySlot: {
          deleteMany: async () => ({ count: 0 }),
          upsert: async () => ({}),
        },
        replicaEndpointDependencySlot: {
          deleteMany: async () => ({ count: 0 }),
          upsert: async () => ({}),
        },
      }

      return await callback(tx as never)
    })

    const output = await registerReplicaDefinition({
      prisma,
      replicaName: "alpha",
      request: {
        title: "Alpha",
        description: "",
        internalEndpoint: "http://alpha",
        replicaDependencies: [],
        endpointDependencies: [],
        version: "1.0.0",
        changes: "",
      } as never,
    })

    expect(output.releaseNotes).toEqual({
      replicaName: "alpha",
      replicaTitle: "Alpha",
      oldVersion: null,
      newVersion: "1.0.0",
      changes: null,
    })
  })
})
