import type { Plugin } from "@opencode-ai/plugin"
import { getMissingSkills } from "./enforcement"
import { getSkillName, loadSkillRules } from "./skills"
import { getTargetPaths } from "./targets"

const interactiveSkillName = "reside-interactive"
const interactiveSessionReminder = [
  "This is an interactive ReSide session.",
  `Before working with the user's request, load the "${interactiveSkillName}" skill.`,
].join("\n")
const editTools = new Set(["apply_patch", "edit", "multiedit", "patch", "write"])

export const SkillEnforcementPlugin: Plugin = async ({ worktree }) => {
  const rules = await loadSkillRules(worktree)
  const loadedSkills = new Set<string>()
  const isInteractiveSession = !process.env.RESIDE_NON_INTERACTIVE

  return {
    "chat.message": async (_input, output) => {
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
      if (input.tool === "skill") {
        const skillName = getSkillName(output.args)

        if (skillName) {
          loadedSkills.add(skillName)
        }

        return
      }

      if (!editTools.has(input.tool)) {
        return
      }

      const targets = getTargetPaths(input.tool, output.args)
      const missingSkills = getMissingSkills(targets, rules, loadedSkills)

      if (missingSkills.length === 0) {
        return
      }

      throw new Error(
        [
          "Skill enforcement blocked this edit.",
          `Load required skills first: ${missingSkills.join(", ")}.`,
          `Matched target files: ${targets.join(", ")}.`,
        ].join("\n"),
      )
    },
  }
}
