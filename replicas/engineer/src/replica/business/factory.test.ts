import { describe, expect, test } from "bun:test"
import { createEnvironmentPrompt, getFactoryRootPath } from "./factory"

describe("getFactoryRootPath", () => {
  test("returns factory container root path", () => {
    expect(getFactoryRootPath()).toBe("/root/factory")
  })
})

describe("createEnvironmentPrompt", () => {
  test("prefixes prompt with required environment skill", () => {
    expect(createEnvironmentPrompt("reside-env-factory-background", "Do the task")).toBe(
      'Before working with the user\'s request, load the "reside-env-factory-background" skill.\nDo the task',
    )
  })
})
