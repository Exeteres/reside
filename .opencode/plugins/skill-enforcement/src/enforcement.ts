import type { SkillRule } from "./types"

export function getMissingSkills(
  targets: string[],
  rules: SkillRule[],
  loadedSkills: ReadonlySet<string>,
): string[] {
  const requiredSkills = new Set<string>()

  for (const target of targets) {
    for (const rule of rules) {
      if (rule.patterns.some(pattern => matchesGlob(target, pattern))) {
        requiredSkills.add(rule.name)
      }
    }
  }

  return [...requiredSkills].filter(skill => !loadedSkills.has(skill)).sort()
}

function matchesGlob(path: string, pattern: string): boolean {
  return new Bun.Glob(pattern).match(path)
}
