#!/usr/bin/env bun

import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fail } from "@reside/skill-reside-core/process"
import { exists, findRepositoryRoot } from "@reside/skill-reside-core/repository"

type PackageJson = {
  workspaces?: unknown
  scripts?: Record<string, unknown>
}

async function main(): Promise<void> {
  const root = await findRepositoryRoot()
  const skillsDir = path.join(root, ".opencode", "skills")
  const packageJson = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  ) as PackageJson
  const workspaces = readStringArray(packageJson.workspaces, "package.json workspaces")
  const skillNames = await readSkillNames(skillsDir)

  if (await exists(path.join(root, "docs"))) {
    fail("Error: docs directory must not exist; project rules live in .opencode/skills")
  }

  if (await exists(path.join(root, "scripts"))) {
    fail("Error: root scripts directory must not exist; tooling belongs to owning skills")
  }

  for (const scriptName of ["format", "scaffold:replica", "changes:update-version"]) {
    if (packageJson.scripts?.[scriptName] !== undefined) {
      fail(`Error: root package.json must not define convenience script "${scriptName}"`)
    }
  }

  for (const skillName of skillNames) {
    await validateSkill(skillsDir, skillName, workspaces)
  }

  console.log(`Validated ${skillNames.length} skills`)
}

async function readSkillNames(skillsDir: string): Promise<string[]> {
  const entries = await readdir(skillsDir, { withFileTypes: true })
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
}

async function validateSkill(
  skillsDir: string,
  skillName: string,
  workspaces: string[],
): Promise<void> {
  const skillDir = path.join(skillsDir, skillName)
  const skillPath = path.join(skillDir, "SKILL.md")
  if (!(await exists(skillPath))) {
    fail(`Error: missing SKILL.md for skill "${skillName}"`)
  }

  const content = await readFile(skillPath, "utf8")
  const frontmatter = parseFrontmatter(content, skillName)
  if (frontmatter.name !== skillName) {
    fail(`Error: skill "${skillName}" frontmatter name must match folder name`)
  }

  if (!frontmatter.description.startsWith("Use ")) {
    fail(`Error: skill "${skillName}" description must start with "Use "`)
  }

  if (content.includes("docs/")) {
    fail(`Error: skill "${skillName}" must not reference removed docs/ paths`)
  }

  const packagePath = path.join(skillDir, "package.json")
  if (!(await exists(packagePath))) {
    return
  }

  const workspacePath = `.opencode/skills/${skillName}`
  if (!workspaces.includes(workspacePath)) {
    fail(`Error: skill package "${skillName}" must be explicitly listed as ${workspacePath}`)
  }
}

function parseFrontmatter(
  content: string,
  skillName: string,
): { name: string; description: string } {
  const match = /^---\n(?<body>[\s\S]*?)\n---/.exec(content)
  if (!match?.groups?.body) {
    fail(`Error: missing frontmatter for skill "${skillName}"`)
  }

  const fields = new Map<string, string>()
  for (const line of match.groups.body.split("\n")) {
    const separatorIndex = line.indexOf(":")
    if (separatorIndex === -1) {
      continue
    }

    fields.set(line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim())
  }

  const name = fields.get("name") ?? ""
  const description = fields.get("description") ?? ""
  if (!name || !description) {
    fail(`Error: skill "${skillName}" frontmatter must include name and description`)
  }

  return { name, description }
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === "string")) {
    fail(`Error: ${label} must be an array of strings`)
  }

  return value
}

await main()
