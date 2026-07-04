import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import type { SkillRule } from "./types"
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createSkillEnforcementPlugin } from "./plugin"

const emptyRules: SkillRule[] = []

describe("createSkillEnforcementPlugin", () => {
  test("injects the interactive skill reminder before the skill is loaded", async () => {
    const hooks = await createHooks({ isInteractive: true })
    const output = createChatOutput("make a change")

    await hooks["chat.message"]?.({ sessionID: "session-1" }, output)

    const textPart = output.parts[0]

    expect(textPart?.type).toBe("text")

    if (textPart?.type !== "text") {
      throw new Error("Expected text part")
    }

    expect(textPart.text).toContain("This is an interactive ReSide session.")
    expect(textPart.text).toContain('load the "reside-interactive" skill')
  })

  test("keeps loaded skills scoped to each plugin instance", async () => {
    const firstHooks = await createHooks({ isInteractive: true })
    const secondHooks = await createHooks({ isInteractive: true })

    await firstHooks["tool.execute.before"]?.(
      { tool: "skill", sessionID: "session-1", callID: "call-1" },
      { args: { name: "reside-interactive" } },
    )

    await firstHooks["tool.execute.before"]?.(
      { tool: "read", sessionID: "session-1", callID: "call-2" },
      { args: { filePath: "src/index.ts" } },
    )

    expect(
      secondHooks["tool.execute.before"]?.(
        { tool: "read", sessionID: "session-1", callID: "call-2" },
        { args: { filePath: "src/index.ts" } },
      ),
    ).rejects.toThrow('Load the "reside-interactive" skill')
  })

  test("allows engineer skill in non-interactive mode", async () => {
    const hooks = await createHooks({ isInteractive: false })

    await hooks["tool.execute.before"]?.(
      { tool: "skill", sessionID: "session-1", callID: "call-1" },
      { args: { name: "reside-engineer" } },
    )
  })

  test("blocks edits until matching required skills are loaded", async () => {
    const hooks = await createHooks({
      isInteractive: false,
      rules: [{ name: "reside-typescript", files: ["src/**/*.ts"], commands: [] }],
    })

    expect(
      hooks["tool.execute.before"]?.(
        { tool: "write", sessionID: "session-1", callID: "call-1" },
        { args: { filePath: "src/index.ts" } },
      ),
    ).rejects.toThrow("Load required skills first: reside-typescript")

    await hooks["tool.execute.before"]?.(
      { tool: "skill", sessionID: "session-1", callID: "call-2" },
      { args: { name: "reside-typescript" } },
    )

    await hooks["tool.execute.before"]?.(
      { tool: "write", sessionID: "session-1", callID: "call-3" },
      { args: { filePath: "src/index.ts" } },
    )
  })

  test("blocks creating new Prisma migration files directly", async () => {
    const hooks = await createHooks({ isInteractive: false })

    expect(
      hooks["tool.execute.before"]?.(
        { tool: "apply_patch", sessionID: "session-1", callID: "call-1" },
        {
          args: {
            patchText: [
              "*** Begin Patch",
              "*** Add File: replicas/access/prisma/migrations/20260705000000_test/migration.sql",
              "+select 1;",
              "*** End Patch",
            ].join("\n"),
          },
        },
      ),
    ).rejects.toThrow("follow its migration creation workflow")
  })

  test("allows editing existing Prisma migration files", async () => {
    const worktree = mkdtempSync(path.join(tmpdir(), "skill-enforcement-"))
    const migrationPath = "replicas/access/prisma/migrations/20260705000000_test/migration.sql"
    const absoluteMigrationPath = path.join(worktree, migrationPath)

    mkdirSync(path.dirname(absoluteMigrationPath), { recursive: true })
    writeFileSync(absoluteMigrationPath, "select 1;", { flush: true })

    const hooks = await createHooks({ isInteractive: false, worktree })

    await hooks["tool.execute.before"]?.(
      { tool: "write", sessionID: "session-1", callID: "call-1" },
      { args: { filePath: migrationPath } },
    )
  })
})

type CreateHooksOptions = {
  isInteractive: boolean
  rules?: SkillRule[]
  worktree?: string
}

type ChatMessageOutput = Parameters<NonNullable<Hooks["chat.message"]>>[1]

async function createHooks(options: CreateHooksOptions): Promise<Hooks> {
  const worktree = options.worktree ?? process.cwd()
  const plugin = createSkillEnforcementPlugin({
    isInteractive: options.isInteractive,
    loadRules: async () => options.rules ?? emptyRules,
  })

  return await plugin({ worktree } as PluginInput)
}

function createChatOutput(text: string): ChatMessageOutput {
  return {
    message: {
      id: "message-1",
      sessionID: "session-1",
      time: { created: Date.now() },
      role: "user",
      agent: "build",
      model: { providerID: "test", modelID: "test" },
    },
    parts: [
      {
        id: "part-1",
        sessionID: "session-1",
        messageID: "message-1",
        type: "text",
        text,
      },
    ],
  }
}
