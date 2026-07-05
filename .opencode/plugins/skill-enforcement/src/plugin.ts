import type { Plugin } from "@opencode-ai/plugin"
import type { SkillRule } from "./types"
import { existsSync, lstatSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getMissingSkills } from "./enforcement"
import { createMigrationCreationError, getBlockedMigrationCreations } from "./prisma-migrations"
import { getSkillName, loadSkillRules } from "./skills"
import { getTargetCommands, getTargetPaths } from "./targets"

type SkillEnforcementOptions = {
  environment?: ResideEnvironment
  loadRules?: (worktree: string) => Promise<SkillRule[]>
}

type ResideEnvironment = "interactive" | "factory-interactive" | "factory-background"

const environmentSkillNames = {
  interactive: "reside-env-interactive",
  "factory-interactive": "reside-env-factory-interactive",
  "factory-background": "reside-env-factory-background",
} satisfies Record<ResideEnvironment, string>

const skillEnvironments = new Map<string, ResideEnvironment>(
  Object.entries(environmentSkillNames).map(([environment, skillName]) => [
    skillName,
    environment as ResideEnvironment,
  ]),
)
const preInteractiveReadTools = new Set(["read"])
const factoryPreInstallReadTools = new Set(["glob", "grep", "list", "read"])
const preInteractiveReadablePaths = new Set(["README.md", "AGENTS.md"])
const environmentBootstrapPrefix = `Before working with the user's request, load the "`
const environmentBootstrapSuffix = `" skill.`
const editTools = new Set(["apply_patch", "edit", "multiedit", "patch", "write"])

export function createSkillEnforcementPlugin(options: SkillEnforcementOptions = {}): Plugin {
  return async ({ worktree }) => {
    const rules = await (options.loadRules ?? loadSkillRules)(worktree)
    const loadedSkillsBySession = new Map<string, Set<string>>()
    const environmentBySession = new Map<string, ResideEnvironment>()
    const installedFactoryDependenciesBySession = new Set<string>()
    const defaultEnvironment = options.environment ?? getConfiguredEnvironment()

    function getLoadedSkills(sessionID: string): Set<string> {
      let loadedSkills = loadedSkillsBySession.get(sessionID)

      if (!loadedSkills) {
        loadedSkills = new Set<string>()
        loadedSkillsBySession.set(sessionID, loadedSkills)
      }

      return loadedSkills
    }

    function getSessionEnvironment(sessionID: string): ResideEnvironment {
      return environmentBySession.get(sessionID) ?? defaultEnvironment
    }

    function setSessionEnvironment(sessionID: string, environment: ResideEnvironment): void {
      environmentBySession.set(sessionID, environment)
    }

    return {
      dispose: async () => {
        loadedSkillsBySession.clear()
        environmentBySession.clear()
        installedFactoryDependenciesBySession.clear()
      },

      "chat.message": async (input, output) => {
        const loadedSkills = getLoadedSkills(input.sessionID)
        const environment = getSessionEnvironment(input.sessionID)
        const requiredSkillName = environmentSkillNames[environment]

        if (loadedSkills.has(requiredSkillName)) {
          return
        }

        const textPart = output.parts.find(part => part.type === "text")

        if (!textPart) {
          return
        }

        const requestedEnvironment = getPromptRequestedEnvironment(textPart.text)
        if (requestedEnvironment) {
          if (requestedEnvironment !== environment) {
            throw new Error(createWrongEnvironmentError(requestedEnvironment, environment))
          }

          setSessionEnvironment(input.sessionID, requestedEnvironment)
          return
        }

        textPart.text = `${createEnvironmentReminder(requiredSkillName)}\n\n${textPart.text}`
      },

      "tool.execute.before": async (input, output) => {
        const loadedSkills = getLoadedSkills(input.sessionID)
        const environment = getSessionEnvironment(input.sessionID)
        const requiredSkillName = environmentSkillNames[environment]

        if (
          input.tool !== "skill" &&
          !isPreInteractiveAllowedRead(input.tool, output.args, worktree) &&
          !loadedSkills.has(requiredSkillName)
        ) {
          throw new Error(
            [
              "Skill enforcement blocked this tool call.",
              `Load the "${requiredSkillName}" skill before using other tools in the "${environment}" environment.`,
            ].join("\n"),
          )
        }

        if (input.tool === "skill") {
          const skillName = getSkillName(output.args)

          if (skillName) {
            const skillEnvironment = skillEnvironments.get(skillName)
            if (skillEnvironment) {
              if (skillEnvironment !== environment) {
                throw new Error(createWrongEnvironmentError(skillEnvironment, environment))
              }

              setSessionEnvironment(input.sessionID, skillEnvironment)
            }

            loadedSkills.add(skillName)
          }

          return
        }

        if (isFactoryEnvironment(environment)) {
          if (input.tool === "bash" && isBunInstallCommand(output.args)) {
            installedFactoryDependenciesBySession.add(input.sessionID)
          } else if (
            !installedFactoryDependenciesBySession.has(input.sessionID) &&
            !isFactoryPreInstallAllowedRead(input.tool, output.args, worktree)
          ) {
            throw new Error(
              [
                "Skill enforcement blocked this tool call.",
                `Run "bun install --frozen-lockfile" before serving user requests in the "${environment}" environment.`,
              ].join("\n"),
            )
          }
        }

        const targets = editTools.has(input.tool) ? getTargetPaths(input.tool, output.args) : []
        const commands = getTargetCommands(input.tool, output.args)

        if (isFactoryEnvironment(environment)) {
          if (!isGitLinkedWorktree(worktree) && targets.length > 0) {
            throw new Error(createFactoryMainRepositoryEditError(targets))
          }

          const blockedEditTargets = getBlockedFactoryEditTargets(targets, worktree)

          if (blockedEditTargets.length > 0) {
            throw new Error(createFactoryEditBoundaryError(blockedEditTargets))
          }
        }

        const blockedMigrationCreations = getBlockedMigrationCreations(
          input.tool,
          output.args,
          worktree,
        )

        if (blockedMigrationCreations.length > 0) {
          throw createMigrationCreationError(blockedMigrationCreations)
        }

        if (targets.length === 0 && commands.length === 0) {
          return
        }

        const missingSkills = getMissingSkills(targets, commands, rules, loadedSkills)

        if (missingSkills.length === 0) {
          return
        }

        throw new Error(
          [
            "Skill enforcement blocked this edit.",
            `Load required skills first: ${missingSkills.join(", ")}.`,
            `Matched target files: ${targets.join(", ") || "none"}.`,
            `Matched commands: ${commands.join(", ") || "none"}.`,
          ].join("\n"),
        )
      },
    }
  }
}

function getConfiguredEnvironment(): ResideEnvironment {
  const value = process.env.RESIDE_ENVIRONMENT?.trim()
  if (!value) {
    return "interactive"
  }

  if (isResideEnvironment(value)) {
    return value
  }

  throw new Error(
    `Invalid RESIDE_ENVIRONMENT "${value}". Expected one of: interactive, factory-interactive, factory-background`,
  )
}

function isResideEnvironment(value: string): value is ResideEnvironment {
  return (
    value === "interactive" || value === "factory-interactive" || value === "factory-background"
  )
}

function isFactoryEnvironment(environment: ResideEnvironment): boolean {
  return environment === "factory-interactive" || environment === "factory-background"
}

function createEnvironmentReminder(skillName: string): string {
  return `${environmentBootstrapPrefix}${skillName}${environmentBootstrapSuffix}`
}

function createWrongEnvironmentError(
  requestedEnvironment: ResideEnvironment,
  detectedEnvironment: ResideEnvironment,
): string {
  return [
    "Skill enforcement blocked this skill load.",
    `Detected environment is "${detectedEnvironment}".`,
    `Requested environment skill belongs to "${requestedEnvironment}".`,
    `Load the "${environmentSkillNames[detectedEnvironment]}" skill instead.`,
  ].join("\n")
}

function getPromptRequestedEnvironment(text: string): ResideEnvironment | undefined {
  if (!text.startsWith(environmentBootstrapPrefix)) {
    return undefined
  }

  const suffixStart = text.indexOf(environmentBootstrapSuffix, environmentBootstrapPrefix.length)
  if (suffixStart === -1) {
    return undefined
  }

  const skillName = text.slice(environmentBootstrapPrefix.length, suffixStart)
  return skillEnvironments.get(skillName)
}

export const SkillEnforcementPlugin: Plugin = createSkillEnforcementPlugin()

function isPreInteractiveAllowedRead(tool: string, args: unknown, worktree: string): boolean {
  if (!preInteractiveReadTools.has(tool) || !isRecord(args)) {
    return false
  }

  if (typeof args.filePath !== "string") {
    return false
  }

  return preInteractiveReadablePaths.has(normalizePath(args.filePath, worktree))
}

function isFactoryPreInstallAllowedRead(tool: string, args: unknown, worktree: string): boolean {
  if (!factoryPreInstallReadTools.has(tool) || !isRecord(args)) {
    return false
  }

  const targetPath = getReadToolPath(tool, args)
  if (targetPath === undefined) {
    return true
  }

  return isFactoryEditablePath(targetPath, worktree)
}

function getReadToolPath(tool: string, args: Record<string, unknown>): string | undefined {
  if (tool === "read" || tool === "list") {
    return typeof args.filePath === "string" ? args.filePath : undefined
  }

  if (tool === "glob" || tool === "grep") {
    return typeof args.path === "string" ? args.path : undefined
  }

  return undefined
}

function normalizePath(targetPath: string, worktree: string): string {
  const relativePath = path.isAbsolute(targetPath)
    ? path.relative(worktree, targetPath)
    : targetPath

  return relativePath.replace(/^\.\//, "")
}

function getBlockedFactoryEditTargets(targets: string[], worktree: string): string[] {
  return targets.filter(target => !isFactoryEditablePath(target, worktree))
}

function isFactoryEditablePath(targetPath: string, worktree: string): boolean {
  const absolutePath = path.resolve(worktree, targetPath)

  return isPathInside(absolutePath, worktree) || isPathInside(absolutePath, tmpdir())
}

function isPathInside(targetPath: string, directory: string): boolean {
  const relativePath = path.relative(path.resolve(directory), path.resolve(targetPath))

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
}

function createFactoryEditBoundaryError(targets: string[]): string {
  return [
    "Skill enforcement blocked this edit.",
    "Factory environments may edit files only inside the session worktree or /tmp.",
    "Create a new workspace for the target repository and request the changes there.",
    `Blocked target files: ${targets.join(", ")}.`,
  ].join("\n")
}

function isGitLinkedWorktree(worktree: string): boolean {
  const gitPath = path.join(worktree, ".git")

  return existsSync(gitPath) && lstatSync(gitPath).isFile()
}

function createFactoryMainRepositoryEditError(targets: string[]): string {
  return [
    "Skill enforcement blocked this edit.",
    "Factory environments may edit repository files only from a workspace, not from the main git repository.",
    "Create a new workspace for this repository and request the changes there.",
    `Blocked target files: ${targets.join(", ")}.`,
  ].join("\n")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isBunInstallCommand(args: unknown): boolean {
  if (!isRecord(args) || typeof args.command !== "string") {
    return false
  }

  return /(^|&&|;)\s*bun\s+install(\s|$)/.test(args.command)
}
