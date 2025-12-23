import { describe, expect, test } from "bun:test"
import { formatRemaining } from "./date"

const day = 86_400_000
const hour = 3_600_000
const minute = 60_000
const second = 1_000

describe("formatRemaining", () => {
  test("formats multi-part duration in russian", () => {
    const duration = 3 * day + 4 * hour + 18 * minute
    const result = formatRemaining(duration, { locale: "ru" })

    expect(result).toBe("3 дня 4 часа 18 минут")
  })

  test("formats multi-part duration in english", () => {
    const duration = 2 * day + 1 * hour + 1 * minute
    const result = formatRemaining(duration, { locale: "en" })

    expect(result).toBe("2 days 1 hour 1 minute")
  })

  test("respects maxParts to omit less significant units", () => {
    const duration = 1 * day + 2 * hour + 30 * minute
    const result = formatRemaining(duration, { locale: "en", maxParts: 2 })

    expect(result).toBe("1 day 2 hours")
  })

  test("handles russian plural forms correctly", () => {
    expect(formatRemaining(1 * day, { locale: "ru", maxParts: 1 })).toBe("1 день")
    expect(formatRemaining(2 * day, { locale: "ru", maxParts: 1 })).toBe("2 дня")
    expect(formatRemaining(5 * day, { locale: "ru", maxParts: 1 })).toBe("5 дней")
    expect(formatRemaining(21 * day, { locale: "ru", maxParts: 1 })).toBe("21 день")
    expect(formatRemaining(22 * day, { locale: "ru", maxParts: 1 })).toBe("22 дня")
    expect(formatRemaining(25 * day, { locale: "ru", maxParts: 1 })).toBe("25 дней")
  })

  test("defaults to seconds when all higher units are zero", () => {
    const duration = 15 * second
    const result = formatRemaining(duration, { locale: "ru" })

    expect(result).toBe("меньше минуты")
  })

  test("clamps negative or invalid durations to zero", () => {
    expect(formatRemaining(-100, { locale: "en" })).toBe("less than a minute")
    expect(formatRemaining(Number.NaN, { locale: "ru" })).toBe("меньше минуты")
  })
})
