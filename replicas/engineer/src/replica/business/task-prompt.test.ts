import type { GithubRepositoryTarget } from "./ai-runtime"
import { describe, expect, test } from "bun:test"
import {
  createImplementationPrompt,
  createPlanningPrompt,
  extractSummaryFromFinalMessage,
} from "./task-prompt"

const repository: GithubRepositoryTarget = {
  owner: "exeteres",
  name: "reside4",
  cloneUrl: "https://github.com/exeteres/reside4.git",
}

describe("createPlanningPrompt", () => {
  test("includes repository context and user prompt", () => {
    const prompt = createPlanningPrompt(repository, "запланируй новую команду", "Новая команда")

    expect(prompt).toContain("Repository: exeteres/reside4")
    expect(prompt).toContain("Use submit_issue_draft exactly once.")
    expect(prompt).toContain(
      "The issue body MUST have exactly two top-level sections: 'Контекст' and 'Требования'.",
    )
    expect(prompt).toContain(
      "The issue body MUST NOT be a step-by-step implementation guide, task checklist, migration checklist, or process plan.",
    )
    expect(prompt).toContain(
      "For command-like capabilities, infer a concise command name and required arguments from context when they are missing.",
    )
    expect(prompt).toContain(
      "When command functionality is planned, infer matching natural-language/NLS tool availability so the same capability can be used through the natural interface.",
    )
    expect(prompt).toContain(
      "If the user provides a concise command signature, keep that signature unchanged.",
    )
    expect(prompt).toContain("Preview topic title: Новая команда")
    expect(prompt).toContain("User prompt: запланируй новую команду")
  })
})

describe("createImplementationPrompt", () => {
  test("includes branch, issue, and implementation constraints", () => {
    const prompt = createImplementationPrompt(
      "exeteres",
      "reside4",
      "replica/task-7/11",
      {
        number: 42,
        title: "Аудит безопасности банковской реплики",
        body: "Провести аудит и предоставить список рисков с рекомендациями.",
      },
      "реализуй задачу",
    )

    expect(prompt).toContain("Repository: exeteres/reside4")
    expect(prompt).toContain("Branch: replica/task-7/11")
    expect(prompt).toContain("Issue: #42")
    expect(prompt).toContain("Issue title: Аудит безопасности банковской реплики")
    expect(prompt).toContain("Issue body:")
    expect(prompt).toContain("Провести аудит и предоставить список рисков")
    expect(prompt).toContain("PR body MUST end with issue closing tag")
    expect(prompt).toContain("First classify the task")
    expect(prompt).toContain("Research-only tasks include audits")
    expect(prompt).toContain("For research-only tasks, do not change repository files")
    expect(prompt).toContain("Only call commit_changes, deliver_changes, or deploy_replica")
    expect(prompt).toContain(
      "Run Prisma, Bun, repository scripts, checks, generators, and other project-specific tools directly.",
    )
    expect(prompt).toContain("Do not run `devenv`, `devenv shell`, Nix")
    expect(prompt).toContain("call create_dev_database")
    expect(prompt).toContain("Temporary development databases are removed after 24 hours")
    expect(prompt).not.toContain("devenv shell -- <command>")
    expect(prompt).toContain("Prefer create/edit tools for source-file content changes.")
    expect(prompt).toContain("Prefer commit_changes for normal commits")
    expect(prompt).toContain("read and follow `docs/changes.md`")
    expect(prompt).toContain("Before calling deliver_changes")
    expect(prompt).toContain("Do not manually push or force-push")
    expect(prompt).toContain("Run focused checks for touched packages first")
    expect(prompt).toContain("missing local infrastructure")
    expect(prompt).toContain("bun scripts/scaffold-replica.ts example <new-replica>")
    expect(prompt).toContain("Current user request: реализуй задачу")
  })

  test("omits issue closing requirement without issue", () => {
    const prompt = createImplementationPrompt(
      "exeteres",
      "reside4",
      "replica/task-7/11",
      undefined,
      "сразу реализуй задачу",
    )

    expect(prompt).toContain("Issue: none.")
    expect(prompt).toContain("implementation-only task intentionally has no GitHub issue")
    expect(prompt).toContain("PR body MUST NOT add an issue closing tag")
    expect(prompt).not.toContain("Issue: #")
    expect(prompt).not.toContain("PR body MUST end with issue closing tag")
    expect(prompt).toContain("Current user request: сразу реализуй задачу")
  })
})

describe("extractSummaryFromFinalMessage", () => {
  test("trims and limits non-empty final message", () => {
    const summary = extractSummaryFromFinalMessage(` ${"a".repeat(2100)} `)

    expect(summary).toHaveLength(2000)
  })

  test("returns default summary for empty message", () => {
    expect(extractSummaryFromFinalMessage("   ")).toBe(
      "Итерация завершена, но агент не предоставил итоговое резюме.",
    )
  })
})
