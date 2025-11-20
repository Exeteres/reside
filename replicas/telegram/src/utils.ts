import { mapValues } from "remeda"

export function filterOutBotToken(value: unknown, botToken: string): unknown {
  if (typeof value === "string") {
    return value.replaceAll(botToken, "[REDACTED]")
  }

  if (Array.isArray(value)) {
    return value.map(v => filterOutBotToken(v, botToken))
  }

  if (typeof value === "object" && value !== null) {
    return mapValues(value, v => filterOutBotToken(v, botToken))
  }

  return value
}
