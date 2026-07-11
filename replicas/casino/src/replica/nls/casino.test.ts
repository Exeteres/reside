import { describe, expect, test } from "bun:test"
import { DEFAULT_BET_SIDES, DICE_EMOJI } from "../business"
import { casinoTools } from "./casino"

describe("casinoTools", () => {
  test("exposes casino rules without sensitive data", async () => {
    const [tool] = casinoTools
    if (!tool) {
      throw new Error("Casino rules tool is missing")
    }

    const result = await tool.handler({}, { invocationId: "test-invocation" })

    expect(tool.name).toBe("get_casino_rules")
    expect(result).toMatchObject({
      command: "/bet {amount} {sides?}",
      defaultSides: DEFAULT_BET_SIDES,
      diceEmoji: DICE_EMOJI,
    })
    expect((result as { rules: string[] }).rules).toContain("The default sides are 1-3.")
  })
})
