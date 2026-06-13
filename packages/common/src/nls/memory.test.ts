import { describe, expect, test } from "bun:test"
import { createMemorySearchWords, createMemoryTools, type MemoryToolsPrisma } from "./memory"

describe("createMemorySearchWords", () => {
  test("normalizes separate words for any-word search", () => {
    const search = createMemorySearchWords([
      "Deploy",
      "replica:alpha",
      "telegram",
      "deploy",
      "_",
      "read-only",
    ])

    expect(search.words).toEqual(["deploy", "replica", "alpha", "telegram", "read", "only"])
    expect(search.anyTermQuery).toBe("deploy | replica | alpha | telegram | read | only")
    expect(search.likePatterns).toEqual([
      "%deploy%",
      "%replica%",
      "%alpha%",
      "%telegram%",
      "%read%",
      "%only%",
    ])
  })

  test("escapes like pattern control characters", () => {
    const search = createMemorySearchWords(["alpha_%"])

    expect(search.likePatterns).toEqual(["%alpha%"])
  })
})

describe("createMemoryTools", () => {
  test("find_notes searches by any provided word and applies tag filter", async () => {
    const rawQueries: { values: unknown[] }[] = []
    const prisma: MemoryToolsPrisma = {
      $queryRaw: async <T = unknown>(
        _query: TemplateStringsArray,
        ...values: unknown[]
      ): Promise<T> => {
        rawQueries.push({ values })
        return [
          {
            id: 7,
            title: "Deploy allow",
            description: "Safe deploy rule",
            tags: ["allow"],
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        ] as T
      },
      memoryNote: {
        findUnique: async () => null,
        create: async () => ({ id: 1 }),
        update: async () => ({ id: 1 }),
        delete: async () => ({ id: 1 }),
      },
    }
    const tools = createMemoryTools({
      prisma,
      tags: {
        allow: { description: "Allow rules" },
      },
    })
    const findNotes = tools.find(tool => tool.name === "find_notes")
    if (!findNotes) {
      throw new Error("find_notes tool is missing")
    }
    const toolInvocation = {} as Parameters<typeof findNotes.handler>[1]

    const result = await findNotes.handler(
      {
        words: ["deploy", "replica:alpha", "status"],
        tags: ["allow"],
      },
      toolInvocation,
    )

    expect(result).toEqual({
      notes: [
        {
          id: 7,
          title: "Deploy allow",
          description: "Safe deploy rule",
          tags: ["allow"],
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
    })
    expect(rawQueries).toHaveLength(1)
    expect(rawQueries[0]?.values).toContain("deploy | replica | alpha | status")
    expect(rawQueries[0]?.values).toContainEqual(["%deploy%", "%replica%", "%alpha%", "%status%"])
    expect(rawQueries[0]?.values).toContainEqual(["allow"])
  })

  test("find_notes returns empty result without querying when words contain no searchable terms", async () => {
    let queried = false
    const prisma: MemoryToolsPrisma = {
      $queryRaw: async <T = unknown>(): Promise<T> => {
        queried = true
        return [] as T
      },
      memoryNote: {
        findUnique: async () => null,
        create: async () => ({ id: 1 }),
        update: async () => ({ id: 1 }),
        delete: async () => ({ id: 1 }),
      },
    }
    const tools = createMemoryTools({ prisma })
    const findNotes = tools.find(tool => tool.name === "find_notes")
    if (!findNotes) {
      throw new Error("find_notes tool is missing")
    }
    const toolInvocation = {} as Parameters<typeof findNotes.handler>[1]

    const result = await findNotes.handler({ words: ["_"] }, toolInvocation)

    expect(result).toEqual({ notes: [] })
    expect(queried).toBe(false)
  })
})
