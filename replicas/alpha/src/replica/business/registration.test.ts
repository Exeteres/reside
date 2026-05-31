import { describe, expect, test } from "bun:test"
import {
  assertRequiredValue,
  assertValidSlotNames,
  normalizeEndpointDependencySlots,
  normalizeReplicaDependencySlots,
  toNullableText,
} from "./registration"

describe("toNullableText", () => {
  test("returns null for undefined and blank values", () => {
    expect(toNullableText(undefined)).toBeNull()
    expect(toNullableText("   ")).toBeNull()
  })

  test("returns trimmed text for non-empty values", () => {
    expect(toNullableText("  hello ")).toBe("hello")
  })
})

describe("assertRequiredValue", () => {
  test("throws for empty value", () => {
    expect(() => assertRequiredValue("", "title")).toThrow('Field "title" is required')
  })
})

describe("assertValidSlotNames", () => {
  test("throws for empty slot name", () => {
    expect(() => assertValidSlotNames(["", "dep"], "replicaDependencies")).toThrow(
      'Field "replicaDependencies" contains slot with empty name',
    )
  })

  test("throws for duplicate slot names", () => {
    expect(() => assertValidSlotNames(["dep", "dep"], "replicaDependencies")).toThrow(
      'Field "replicaDependencies" contains duplicate slot name "dep"',
    )
  })
})

describe("slot normalizers", () => {
  test("normalizes replica dependency slots", () => {
    const request = {
      replicaDependencies: [
        {
          name: " dep-a ",
          defaultReplicaName: " alpha ",
        },
        {
          name: "dep-b",
          defaultReplicaName: "   ",
        },
      ],
      endpointDependencies: [],
    }

    const result = normalizeReplicaDependencySlots(request as never)

    expect(result).toEqual([
      {
        name: "dep-a",
        defaultReplicaName: "alpha",
      },
      {
        name: "dep-b",
        defaultReplicaName: null,
      },
    ])
  })

  test("normalizes endpoint dependency slots", () => {
    const request = {
      replicaDependencies: [],
      endpointDependencies: [
        {
          name: " api ",
          defaultEndpoint: " https://example.internal ",
        },
      ],
    }

    const result = normalizeEndpointDependencySlots(request as never)

    expect(result).toEqual([
      {
        name: "api",
        defaultEndpoint: "https://example.internal",
      },
    ])
  })
})
