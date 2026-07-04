import type { SkillRule } from "./types"

export function getMissingSkills(
  targets: string[],
  commands: string[],
  rules: SkillRule[],
  loadedSkills: ReadonlySet<string>,
): string[] {
  const requiredSkills = new Set<string>()

  for (const rule of rules) {
    for (const target of targets) {
      if (rule.files.some(pattern => matchesGlob(target, pattern))) {
        requiredSkills.add(rule.name)
      }
    }

    for (const command of commands) {
      if (rule.commands.some(pattern => matchesGlob(command, pattern))) {
        requiredSkills.add(rule.name)
      }
    }
  }

  return [...requiredSkills].filter(skill => !loadedSkills.has(skill)).sort()
}

function matchesGlob(path: string, pattern: string): boolean {
  return new Bun.Glob(pattern).match(path)
}
