import { describe, expect, test } from "bun:test"
import { extractLatestChangelogEntry } from "./alpha"
import { parseResideManifest } from "./manifest"

describe("parseResideManifest", () => {
  test("loads trimmed replica version", () => {
    expect(
      parseResideManifest(
        JSON.stringify({
          version: " 1.2.3 ",
          image: " ghcr.io/exeteres/reside/replicas/test ",
        }),
      ),
    ).toEqual({
      version: "1.2.3",
      image: "ghcr.io/exeteres/reside/replicas/test",
    })
  })

  test("returns undefined when version is missing", () => {
    expect(parseResideManifest(JSON.stringify({}))).toBeUndefined()
  })

  test("returns undefined when image is missing", () => {
    expect(parseResideManifest(JSON.stringify({ version: "1.2.3" }))).toBeUndefined()
  })
})

describe("extractLatestChangelogEntry", () => {
  test("extracts body of the latest changelog section", () => {
    const changelog = [
      "# Changelog",
      "",
      "## 1.2.3 - 2026-06-06",
      "",
      "Добавлена важная возможность.",
      "",
      "## 1.2.2 - 2026-06-05",
      "",
      "Старые изменения.",
    ].join("\n")

    expect(extractLatestChangelogEntry(changelog)).toBe("Добавлена важная возможность.")
  })

  test("supports windows line endings", () => {
    const changelog = ["# Changelog", "", "## 0.1.0 - 2026-01-01", "", "Исправлены ошибки."].join(
      "\r\n",
    )

    expect(extractLatestChangelogEntry(changelog)).toBe("Исправлены ошибки.")
  })

  test("returns undefined when changelog has no release sections", () => {
    const changelog = ["# Changelog", "", "Пока нет релизов."].join("\n")

    expect(extractLatestChangelogEntry(changelog)).toBeUndefined()
  })

  test("returns undefined when latest section has no body", () => {
    const changelog = [
      "# Changelog",
      "",
      "## 0.1.0 - 2026-01-01",
      "",
      "## 0.0.9 - 2025-12-31",
    ].join("\n")

    expect(extractLatestChangelogEntry(changelog)).toBeUndefined()
  })
})
