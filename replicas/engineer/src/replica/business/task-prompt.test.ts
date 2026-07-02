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
  test("includes planning context values", () => {
    const prompt = createPlanningPrompt(repository, "запланируй новую команду", "Новая команда")

    expect(prompt).toContain("Repository: exeteres/reside4")
    expect(prompt).toContain("Preview topic title: Новая команда")
    expect(prompt).toContain("User prompt: запланируй новую команду")
  })
})

describe("createImplementationPrompt", () => {
  test("includes implementation context values", () => {
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
    expect(prompt).toContain("Current user request: реализуй задачу")
  })

  test("uses implementation-only issue context without issue", () => {
    const prompt = createImplementationPrompt(
      "exeteres",
      "reside4",
      "replica/task-7/11",
      undefined,
      "сразу реализуй задачу",
    )

    expect(prompt).toContain("Issue: none.")
    expect(prompt).not.toContain("Issue: #")
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
