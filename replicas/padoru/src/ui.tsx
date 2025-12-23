import type { OutMessage } from "@reside/telegram"
import type { PadoruConfig } from "./config"
import { formatRemaining } from "./date"

export const hoursInMs = 60 * 60 * 1000

export function renderPadoruMessage(config: PadoruConfig): OutMessage {
  const newYearDate = new Date(new Date().getFullYear(), 0, 1)
  const remainingMs = newYearDate.getTime() - Date.now()
  const remainingWithTZ = remainingMs + config.defaultOffsetHours * hoursInMs

  const remaining = formatRemaining(remainingWithTZ, { locale: "ru" })
  let baseText = config.template.replace("{remaining}", remaining) + "\n\n"

  for (const [username, celebrant] of Object.entries(config.celebrants)) {
    const celebrantRemainingWithTZ = remainingMs + celebrant.offsetHours * hoursInMs
    const celebrantRemaining = formatRemaining(celebrantRemainingWithTZ, { locale: "ru" })
    const formattedOffset = `UTC${celebrant.offsetHours >= 0 ? "+" : ""}${celebrant.offsetHours}`

    baseText += `${username} (${formattedOffset}): ${celebrantRemaining}\n`
  }

  return {
    text: <code>{baseText.trim()}</code>,
  }
}
