import { describe, expect, test } from "bun:test"
import { ALL_NLS_SYSTEM_TOOLS, DEFAULT_NLS_SYSTEM_TOOLS, NlsSystemTool } from "./system-tools"

describe("nls system tools", () => {
  test("knows sql as a system tool", () => {
    expect(ALL_NLS_SYSTEM_TOOLS).toContain(NlsSystemTool.Sql)
  })

  test("allows sql by default", () => {
    expect(DEFAULT_NLS_SYSTEM_TOOLS).toContain(NlsSystemTool.Sql)
  })
})
