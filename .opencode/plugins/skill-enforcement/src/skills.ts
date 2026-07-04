import type { SkillRule } from "./types"

export async function loadSkillRules(worktree: string): Promise<SkillRule[]> {
  const glob = new Bun.Glob(".opencode/skills/*/SKILL.md")
  const rules: SkillRule[] = []

  for await (const file of glob.scan({ cwd: worktree })) {
    const text = await Bun.file(`${worktree}/${file}`).text()
    const name = parseSkillName(text)
    const patterns = parseEnforcementPatterns(text)

    if (name && patterns.length > 0) {
      rules.push({ name, patterns })
    }
  }

  return rules
}

export function getSkillName(args: unknown): string | undefined {
  if (!isRecord(args)) {
    return undefined
  }

  const name = args.name ?? args.skill

  return typeof name === "string" ? name : undefined
}

function parseSkillName(text: string): string | undefined {
  return text.match(/^name:\s*([^\n]+)$/m)?.[1]?.trim()
}

function parseEnforcementPatterns(text: string): string[] {
  const block = text.match(/^---\n(?<body>[\s\S]*?)\n---/)?.groups?.body

  if (!block) {
    return []
  }

  const lines = block.split("\n")
  const startIndex = lines.findIndex(line => line.trim() === "skill_enforcement:")

  if (startIndex === -1) {
    return []
  }

  const patternsIndex = lines.findIndex(
    (line, index) => index > startIndex && /^\s{2}patterns:\s*$/.test(line),
  )

  if (patternsIndex === -1) {
    return []
  }

  return lines
    .slice(patternsIndex + 1)
    .map(line => line.match(/^\s{4}-\s*["']?([^"'\n]+)["']?\s*$/)?.[1])
    .filter((pattern): pattern is string => Boolean(pattern))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
