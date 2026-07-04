import type { SkillRule } from "./types"

export async function loadSkillRules(worktree: string): Promise<SkillRule[]> {
  const glob = new Bun.Glob(".opencode/skills/*/SKILL.md")
  const rules: SkillRule[] = []

  for await (const file of glob.scan({ cwd: worktree })) {
    const text = await Bun.file(`${worktree}/${file}`).text()
    const name = parseSkillName(text)
    const enforcement = parseEnforcement(text)

    if (name && (enforcement.files.length > 0 || enforcement.commands.length > 0)) {
      rules.push({ name, ...enforcement })
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

function parseEnforcement(text: string): Pick<SkillRule, "files" | "commands"> {
  const block = text.match(/^---\n(?<body>[\s\S]*?)\n---/)?.groups?.body

  if (!block) {
    return { files: [], commands: [] }
  }

  const lines = block.split("\n")
  const startIndex = lines.findIndex(line => line.trim() === "enforcement:")

  if (startIndex === -1) {
    return { files: [], commands: [] }
  }

  return {
    files: parseEnforcementList(lines, startIndex, "files"),
    commands: parseEnforcementList(lines, startIndex, "commands"),
  }
}

function parseEnforcementList(lines: string[], startIndex: number, key: string): string[] {
  const listIndex = lines.findIndex(
    (line, index) => index > startIndex && new RegExp(`^\\s{2}${key}:\\s*$`).test(line),
  )

  if (listIndex === -1) {
    return []
  }

  return lines
    .slice(listIndex + 1)
    .map(line => line.match(/^\s{4}-\s*["']?([^"'\n]+)["']?\s*$/)?.[1])
    .filter((item): item is string => Boolean(item))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
