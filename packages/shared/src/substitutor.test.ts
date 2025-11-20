import { describe, expect, test } from "bun:test"
import { createSubstitutor } from "./substitutor"

describe("createSubstitutor", () => {
  test("replaces placeholders in strings recursively", () => {
    const substitutor = createSubstitutor({ name: "Alice", city: "Paris", emoji: "🌟" })

    const source = {
      greeting: "Hello {name}!",
      nested: [
        { message: "{name} lives in {city}", tags: ["{emoji}", "plain"] },
        "Welcome, {name}",
      ],
      untouched: 42,
    }

    const result = substitutor(source)

    expect(result).toEqual({
      greeting: "Hello Alice!",
      nested: [{ message: "Alice lives in Paris", tags: ["🌟", "plain"] }, "Welcome, Alice"],
      untouched: 42,
    })
  })

  test("leaves unknown placeholders and non-string values unchanged", () => {
    const substitutor = createSubstitutor({ known: "value" })

    const source = {
      text: "Has {known} and {unknown}",
      flag: false,
      nil: null,
      nested: { inner: undefined },
    }

    const result = substitutor(source)

    expect(result).toEqual({
      text: "Has value and {unknown}",
      flag: false,
      nil: null,
      nested: { inner: undefined },
    })
  })

  test("does not mutate original data structures", () => {
    const substitutor = createSubstitutor({ word: "changed" })

    const source = {
      text: "{word}",
      array: ["{word}"],
      object: { nested: "{word}" },
    }

    const snapshot = structuredClone(source)

    const result = substitutor(source)

    expect(source).toEqual(snapshot)
    expect(result).not.toBe(source)
    expect(result.array).not.toBe(source.array)
    expect(result.object).not.toBe(source.object)

    expect(result).toEqual({
      text: "changed",
      array: ["changed"],
      object: { nested: "changed" },
    })
  })
})
