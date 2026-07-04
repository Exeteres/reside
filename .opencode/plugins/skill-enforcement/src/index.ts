import type { Plugin } from "@opencode-ai/plugin"
import path from "node:path"
import { getMissingSkills } from "./enforcement"
import { getSkillName, loadSkillRules } from "./skills"
import { getTargetCommands, getTargetPaths } from "./targets"

const interactiveSkillName = "reside-interactive"
const engineerSkillName = "reside-engineer"
const preInteractiveReadTools = new Set(["read"])
const preInteractiveReadablePaths = new Set(["README.md", "AGENTS.md"])
const interactiveSessionReminder = [
  "This is an interactive ReSide session.",
  `Before working with the user's request, load the "${interactiveSkillName}" skill.`,
].join("\n")
const editTools = new Set(["apply_patch", "edit", "multiedit", "patch", "write"])

export const SkillEnforcementPlugin: Plugin = async ({ worktree }) => {
  const rules = await loadSkillRules(worktree)
  const loadedSkillsBySession = new Map<string, Set<string>>()
  const isInteractiveSession = !process.env.RESIDE_NON_INTERACTIVE

  function getLoadedSkills(sessionID: string): Set<string> {
    let loadedSkills = loadedSkillsBySession.get(sessionID)

    if (!loadedSkills) {
      loadedSkills = new Set<string>()
      loadedSkillsBySession.set(sessionID, loadedSkills)
    }

    return loadedSkills
  }

  return {
    dispose: async () => {
      loadedSkillsBySession.clear()
    },

    "chat.message": async (input, output) => {
      const loadedSkills = getLoadedSkills(input.sessionID)

      if (!isInteractiveSession || loadedSkills.has(interactiveSkillName)) {
        return
      }

      const textPart = output.parts.find(part => part.type === "text")

      if (!textPart) {
        return
      }

      textPart.text = `${interactiveSessionReminder}\n\n${textPart.text}`
    },

    "tool.execute.before": async (input, output) => {
      const loadedSkills = getLoadedSkills(input.sessionID)

      if (
        isInteractiveSession &&
        input.tool !== "skill" &&
        !isPreInteractiveAllowedRead(input.tool, output.args, worktree) &&
        !loadedSkills.has(interactiveSkillName)
      ) {
        throw new Error(
          [
            "Skill enforcement blocked this tool call.",
            `Load the "${interactiveSkillName}" skill before using other tools in interactive sessions.`,
          ].join("\n"),
        )
      }

      if (input.tool === "skill") {
        const skillName = getSkillName(output.args)

        if (isInteractiveSession && skillName === engineerSkillName) {
          throw new Error(
            [
              "Skill enforcement blocked this skill load.",
              `The "${engineerSkillName}" skill is only allowed in non-interactive sessions.`,
            ].join("\n"),
          )
        }

        if (skillName) {
          loadedSkills.add(skillName)
        }

        return
      }

      const targets = editTools.has(input.tool) ? getTargetPaths(input.tool, output.args) : []
      const commands = getTargetCommands(input.tool, output.args)

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

function isPreInteractiveAllowedRead(tool: string, args: unknown, worktree: string): boolean {
  if (!preInteractiveReadTools.has(tool) || !isRecord(args)) {
    return false
  }

  if (typeof args.filePath !== "string") {
    return false
  }

  return preInteractiveReadablePaths.has(normalizePath(args.filePath, worktree))
}

function normalizePath(targetPath: string, worktree: string): string {
  const relativePath = path.isAbsolute(targetPath)
    ? path.relative(worktree, targetPath)
    : targetPath

  return relativePath.replace(/^\.\//, "")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
