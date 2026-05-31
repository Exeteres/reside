import type { PrismaClient } from "../../database"
import { describe, expect, test } from "bun:test"
import { mockDeepFn } from "@reside/common/testing"
import {
  parseReplicaSubjectId,
  resolveEffectiveEndpoints,
  resolveSubjectEndpointBySubjectId,
} from "./discovery"

describe("parseReplicaSubjectId", () => {
  test("parses valid replica subject id", () => {
    expect(parseReplicaSubjectId("replica:alpha")).toEqual({ replicaName: "alpha" })
  })

  test("returns null for invalid realm", () => {
    expect(parseReplicaSubjectId("telegram:alpha")).toBeNull()
  })

  test("returns null for invalid segment count", () => {
    expect(parseReplicaSubjectId("replica:alpha:extra")).toBeNull()
    expect(parseReplicaSubjectId("replica:")).toBeNull()
  })
})

describe("resolveSubjectEndpointBySubjectId", () => {
  test("throws for invalid subject id", () => {
    const prisma = mockDeepFn<PrismaClient>()

    expect(resolveSubjectEndpointBySubjectId(prisma, "invalid")).rejects.toThrow(
      'subject_id must be in format "replica:{name}"',
    )
  })

  test("throws when replica is not registered", () => {
    const prisma = mockDeepFn<PrismaClient>()
    prisma.replica.findUnique.mockResolvedValue(null as never)

    expect(resolveSubjectEndpointBySubjectId(prisma, "replica:alpha")).rejects.toThrow(
      'Replica "alpha" is not registered in alpha',
    )
  })

  test("returns endpoint for registered replica", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    prisma.replica.findUnique.mockResolvedValue({ internalEndpoint: "http://alpha" } as never)

    const result = await resolveSubjectEndpointBySubjectId(prisma, "replica:alpha")

    expect(result).toEqual({ endpoint: "http://alpha" })
  })
})

describe("resolveEffectiveEndpoints", () => {
  test("throws when replica is not registered", () => {
    const prisma = mockDeepFn<PrismaClient>()
    prisma.replica.findUnique.mockResolvedValue(null as never)

    expect(resolveEffectiveEndpoints(prisma, "alpha")).rejects.toThrow(
      'Replica "alpha" is not registered in alpha',
    )
  })

  test("resolves effective endpoint slots", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    prisma.replica.findUnique.mockResolvedValue({
      name: "alpha",
      image: "ghcr.io/example/alpha:1",
      replicaDependencySlots: [
        {
          name: "dep.api",
          currentReplica: {
            internalEndpoint: "http://dependency",
          },
        },
      ],
      endpointDependencySlots: [
        {
          name: "dep.api",
          defaultEndpoint: null,
          currentEndpoint: null,
        },
        {
          name: "status",
          defaultEndpoint: "http://status",
          currentEndpoint: null,
        },
      ],
    } as never)

    const result = await resolveEffectiveEndpoints(prisma, "alpha")

    expect(result).toEqual({
      endpoints: {
        "dep-api": "http://dependency",
        status: "http://status",
      },
    })
  })
})
