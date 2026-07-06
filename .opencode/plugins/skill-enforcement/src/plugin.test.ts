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
    const hooks = await createHooks({ environment: "interactive" })
    const output = createChatOutput("make a change")

    await hooks["chat.message"]?.({ sessionID: "session-1" }, output)

    const textPart = output.parts[0]

    expect(textPart?.type).toBe("text")

    if (textPart?.type !== "text") {
      throw new Error("Expected text part")
    }

    expect(textPart.text).toContain('load the "reside-env-interactive" skill')
  })

  test("uses prompt-provided factory background environment", async () => {
    const hooks = await createHooks({ environment: "factory-background" })
    const output = createChatOutput(
      'Before working with the user\'s request, load the "reside-env-factory-background" skill.\nmake a change',
    )

    await hooks["chat.message"]?.({ sessionID: "session-1" }, output)

    const textPart = output.parts[0]

    expect(textPart?.type).toBe("text")

    if (textPart?.type !== "text") {
      throw new Error("Expected text part")
    }

    expect(textPart.text).toBe(
      'Before working with the user\'s request, load the "reside-env-factory-background" skill.\nmake a change',
    )

    expect(
      hooks["tool.execute.before"]?.(
        { tool: "read", sessionID: "session-1", callID: "call-1" },
        { args: { filePath: "src/index.ts" } },
      ),
    ).rejects.toThrow('Load the "reside-env-factory-background" skill')
  })

  test("blocks prompt-provided environment skills outside the detected environment", async () => {
    const hooks = await createHooks({ environment: "interactive" })
    const output = createChatOutput(
      'Before working with the user\'s request, load the "reside-env-factory-background" skill.\nmake a change',
    )

    expect(hooks["chat.message"]?.({ sessionID: "session-1" }, output)).rejects.toThrow(
      'Load the "reside-env-interactive" skill instead',
    )
  })

  test("blocks loading environment skills outside the detected environment", async () => {
    const hooks = await createHooks({ environment: "interactive" })

    expect(
      hooks["tool.execute.before"]?.(
        { tool: "skill", sessionID: "session-1", callID: "call-1" },
        { args: { name: "reside-env-factory-background" } },
      ),
    ).rejects.toThrow('Load the "reside-env-interactive" skill instead')
  })

  test("keeps loaded skills scoped to each plugin instance", async () => {
    const firstHooks = await createHooks({ environment: "interactive" })
    const secondHooks = await createHooks({ environment: "interactive" })

    await firstHooks["tool.execute.before"]?.(
      { tool: "skill", sessionID: "session-1", callID: "call-1" },
      { args: { name: "reside-env-interactive" } },
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
    ).rejects.toThrow('Load the "reside-env-interactive" skill')
  })

  test("does not enforce rules for child agents", async () => {
    const hooks = await createHooks({
      environment: "interactive",
      rules: [{ name: "reside-typescript", files: ["src/**/*.ts"], commands: [] }],
    })
    const childAgentInput = {
      tool: "write",
      sessionID: "session-1",
      callID: "call-1",
      agent: "explore",
    }

    await hooks["tool.execute.before"]?.(childAgentInput, { args: { filePath: "src/index.ts" } })
  })

  test("allows repository reads before factory preparation", async () => {
    const hooks = await createHooks({ environment: "factory-background" })

    await hooks["tool.execute.before"]?.(
      { tool: "skill", sessionID: "session-1", callID: "call-1" },
      { args: { name: "reside-env-factory-background" } },
    )

    await hooks["tool.execute.before"]?.(
      { tool: "read", sessionID: "session-1", callID: "call-2" },
      { args: { filePath: "src/index.ts" } },
    )

    await hooks["tool.execute.before"]?.(
      { tool: "grep", sessionID: "session-1", callID: "call-3" },
      { args: { pattern: "test", path: ".", include: "*.ts" } },
    )
  })

  test("requires git rebase and bun install before factory edits", async () => {
    const worktree = createLinkedWorktreeFixture()
    const hooks = await createHooks({ environment: "factory-background", worktree })

    await loadFactoryEnvironmentSkill(hooks)

    expect(
      hooks["tool.execute.before"]?.(
        { tool: "write", sessionID: "session-1", callID: "call-2" },
        { args: { filePath: "src/index.ts" } },
      ),
    ).rejects.toThrow('run "git rebase main", run "bun install --frozen-lockfile"')

    await hooks["tool.execute.before"]?.(
      { tool: "bash", sessionID: "session-1", callID: "call-3" },
      { args: { command: "git rebase main" } },
    )

    expect(
      hooks["tool.execute.before"]?.(
        { tool: "write", sessionID: "session-1", callID: "call-4" },
        { args: { filePath: "src/index.ts" } },
      ),
    ).rejects.toThrow('run "bun install --frozen-lockfile"')

    await hooks["tool.execute.before"]?.(
      { tool: "bash", sessionID: "session-1", callID: "call-5" },
      { args: { command: "bun install --frozen-lockfile" } },
    )

    await hooks["tool.execute.before"]?.(
      { tool: "write", sessionID: "session-1", callID: "call-6" },
      { args: { filePath: "src/index.ts" } },
    )
  })

  test("allows completing factory preparation in one command", async () => {
    const worktree = createLinkedWorktreeFixture()
    const hooks = await createHooks({ environment: "factory-background", worktree })

    await loadFactoryEnvironmentSkill(hooks)

    await hooks["tool.execute.before"]?.(
      { tool: "bash", sessionID: "session-1", callID: "prepare" },
      { args: { command: "git rebase main && bun install --frozen-lockfile" } },
    )

    await hooks["tool.execute.before"]?.(
      { tool: "write", sessionID: "session-1", callID: "write" },
      { args: { filePath: "src/index.ts" } },
    )
  })

  test("blocks factory edits outside the worktree and tmp", async () => {
    const worktree = createLinkedWorktreeFixture()
    const outsidePath = path.resolve(process.cwd(), "..", "outside.ts")
    const hooks = await createHooks({ environment: "factory-background", worktree })

    await loadFactoryEnvironmentSkill(hooks)
    await runFactoryInstall(hooks)

    expect(
      hooks["tool.execute.before"]?.(
        { tool: "write", sessionID: "session-1", callID: "call-3" },
        { args: { filePath: outsidePath } },
      ),
    ).rejects.toThrow(
      "Factory environments may edit files only inside the session worktree or /tmp",
    )
  })

  test("allows factory edits inside tmp", async () => {
    const worktree = createLinkedWorktreeFixture()
    const hooks = await createHooks({ environment: "factory-background", worktree })
    const tmpPath = path.join(tmpdir(), "skill-enforcement-output.txt")

    await loadFactoryEnvironmentSkill(hooks)
    await runFactoryInstall(hooks)

    await hooks["tool.execute.before"]?.(
      { tool: "write", sessionID: "session-1", callID: "call-3" },
      { args: { filePath: tmpPath } },
    )
  })

  test("blocks factory edits from the main git repository", async () => {
    const worktree = mkdtempSync(path.join(tmpdir(), "skill-enforcement-main-repo-"))
    mkdirSync(path.join(worktree, ".git"))
    const hooks = await createHooks({ environment: "factory-background", worktree })

    await loadFactoryEnvironmentSkill(hooks)
    await runFactoryInstall(hooks)

    expect(
      hooks["tool.execute.before"]?.(
        { tool: "write", sessionID: "session-1", callID: "call-3" },
        { args: { filePath: "src/index.ts" } },
      ),
    ).rejects.toThrow("only from a workspace, not from the main git repository")
  })

  test("blocks edits until matching required skills are loaded", async () => {
    const hooks = await createHooks({
      environment: "interactive",
      rules: [{ name: "reside-typescript", files: ["src/**/*.ts"], commands: [] }],
    })

    await loadEnvironmentSkill(hooks)

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
    const hooks = await createHooks({ environment: "interactive" })

    await loadEnvironmentSkill(hooks)

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

    const hooks = await createHooks({ environment: "interactive", worktree })

    await loadEnvironmentSkill(hooks)

    await hooks["tool.execute.before"]?.(
      { tool: "write", sessionID: "session-1", callID: "call-1" },
      { args: { filePath: migrationPath } },
    )
  })
})

type CreateHooksOptions = {
  environment: "interactive" | "factory-interactive" | "factory-background"
  rules?: SkillRule[]
  worktree?: string
}

async function loadEnvironmentSkill(hooks: Hooks): Promise<void> {
  await hooks["tool.execute.before"]?.(
    { tool: "skill", sessionID: "session-1", callID: "load-environment" },
    { args: { name: "reside-env-interactive" } },
  )
}

async function loadFactoryEnvironmentSkill(hooks: Hooks): Promise<void> {
  await hooks["tool.execute.before"]?.(
    { tool: "skill", sessionID: "session-1", callID: "load-environment" },
    { args: { name: "reside-env-factory-background" } },
  )
}

async function runFactoryInstall(hooks: Hooks): Promise<void> {
  await hooks["tool.execute.before"]?.(
    { tool: "bash", sessionID: "session-1", callID: "rebase" },
    { args: { command: "git rebase main" } },
  )
  await hooks["tool.execute.before"]?.(
    { tool: "bash", sessionID: "session-1", callID: "install" },
    { args: { command: "bun install --frozen-lockfile" } },
  )
}

type ChatMessageOutput = Parameters<NonNullable<Hooks["chat.message"]>>[1]

async function createHooks(options: CreateHooksOptions): Promise<Hooks> {
  const worktree = options.worktree ?? process.cwd()
  const plugin = createSkillEnforcementPlugin({
    environment: options.environment,
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

function createLinkedWorktreeFixture(): string {
  const worktree = mkdtempSync(path.join(tmpdir(), "skill-enforcement-worktree-"))

  writeFileSync(path.join(worktree, ".git"), "gitdir: /tmp/test/.git/worktrees/test\n", {
    flush: true,
  })

  return worktree
}
