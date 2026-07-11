import { defineTool } from "@reside/common"
import { z } from "zod"
import { DEFAULT_BET_SIDES, DICE_EMOJI } from "../business"

export const casinoTools = [
  defineTool("get_casino_rules", {
    description: "Gets non-sensitive casino betting rules and command usage.",
    parameters: z.object({}),
    handler: () => ({
      command: "/bet {amount} {sides?}",
      defaultSides: DEFAULT_BET_SIDES,
      diceEmoji: DICE_EMOJI,
      rules: [
        "The bet amount must be a positive integer in ∅.",
        "Sides can be provided as single values, comma-separated values, or ranges.",
        "The default sides are 1-3.",
        "The player throws one 🎲 after the bank payment is accepted.",
        "The payout is amount * 6 / selected_side_count and must be an integer.",
      ],
    }),
  }),
]
