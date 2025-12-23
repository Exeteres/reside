import type { OutMessage } from "@reside/telegram"
import type { PadoruConfig } from "./config"
import { formatRemaining } from "./date"
import { hoursInMs, newYearDate } from "./shared"

function formatOffsetHours(offsetHours: number): string {
  return `UTC${offsetHours >= 0 ? "+" : ""}${offsetHours}`
}

function formatPadoruRemaining(remainingMs: number, offsetHours: number): string {
  const remainingWithTZ = remainingMs - offsetHours * hoursInMs

  if (remainingWithTZ <= 0) {
    return "PADORU PROTOCOL ACTIVATED!"
  }

  return formatRemaining(remainingWithTZ, { locale: "ru" })
}

export function renderPadoruMessage(config: PadoruConfig): OutMessage {
  const remainingMs = newYearDate.getTime() - Date.now()
  const remaining = formatPadoruRemaining(remainingMs, config.defaultOffsetHours)

  const header =
    remaining === "PADORU PROTOCOL ACTIVATED!"
      ? remaining
      : config.template.replace("{remaining}", remaining)

  let text = header + "\n\n"

  for (const [username, celebrant] of Object.entries(config.celebrants)) {
    const celebrantRemaining = formatPadoruRemaining(remainingMs, celebrant.offsetHours)
    const formattedOffset = formatOffsetHours(celebrant.offsetHours)

    text += `${username} (${formattedOffset}): ${celebrantRemaining}\n`
  }

  return {
    text: <code>{text.trim()}</code>,
  }
}
