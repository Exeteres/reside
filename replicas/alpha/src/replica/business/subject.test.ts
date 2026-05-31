import type { PrismaClient } from "../../database"
import { describe, expect, test } from "bun:test"
import { mockDeepFn } from "@reside/common/testing"
import {
  assertSubjectDisplayQueryReplica,
  parseReplicaSubjectId,
  resolveReplicaSubjectDisplayInfo,
} from "./subject"

describe("assertSubjectDisplayQueryReplica", () => {
  test("accepts allowed replicas", () => {
    expect(() => assertSubjectDisplayQueryReplica("access")).not.toThrow()
    expect(() => assertSubjectDisplayQueryReplica("alpha")).not.toThrow()
  })

  test("rejects disallowed replica", () => {
    expect(() => assertSubjectDisplayQueryReplica("telegram")).toThrow(
      'Replica "telegram" is not allowed to query replica subject display info',
    )
  })
})

describe("parseReplicaSubjectId", () => {
  test("parses valid subject id", () => {
    expect(parseReplicaSubjectId("replica:engineer")).toEqual({ name: "engineer" })
  })

  test("returns null for invalid subject id", () => {
    expect(parseReplicaSubjectId("engineer")).toBeNull()
    expect(parseReplicaSubjectId("replica:")).toBeNull()
    expect(parseReplicaSubjectId("other:engineer")).toBeNull()
  })
})

describe("resolveReplicaSubjectDisplayInfo", () => {
  test("throws for invalid subject id", () => {
    const prisma = mockDeepFn<PrismaClient>()

    expect(resolveReplicaSubjectDisplayInfo(prisma, "invalid")).rejects.toThrow(
      'Subject ID must match format "replica:{name}"',
    )
  })

  test("throws when subject is not found", () => {
    const prisma = mockDeepFn<PrismaClient>()
    prisma.replica.findUnique.mockResolvedValue(null as never)

    expect(resolveReplicaSubjectDisplayInfo(prisma, "replica:alpha")).rejects.toThrow(
      'Subject "replica:alpha" was not found',
    )
  })

  test("returns subject display info for registered replica", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    prisma.replica.findUnique.mockResolvedValue({
      title: "Alpha",
      avatarUrl: null,
    } as never)

    const result = await resolveReplicaSubjectDisplayInfo(prisma, "replica:alpha")

    expect(result).toEqual({
      title: "Alpha",
      avatarUrl: undefined,
    })
  })
})
