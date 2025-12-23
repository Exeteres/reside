export type RemainingLocale = "ru" | "en"

type UnitForms = {
  en: readonly [string, string]
  ru: readonly [string, string, string]
}

type Unit = {
  key: "day" | "hour" | "minute"
  ms: number
  forms: UnitForms
}

const units: readonly Unit[] = [
  {
    key: "day",
    ms: 86_400_000,
    forms: {
      en: ["day", "days"],
      ru: ["день", "дня", "дней"],
    },
  },
  {
    key: "hour",
    ms: 3_600_000,
    forms: {
      en: ["hour", "hours"],
      ru: ["час", "часа", "часов"],
    },
  },
  {
    key: "minute",
    ms: 60_000,
    forms: {
      en: ["minute", "minutes"],
      ru: ["минута", "минуты", "минут"],
    },
  },
] as const

export type FormatRemainingOptions = {
  locale?: RemainingLocale
  maxParts?: number
}

export function formatRemaining(durationMs: number, options?: FormatRemainingOptions): string {
  const locale = options?.locale ?? "ru"
  const maxParts = options?.maxParts ?? Number.POSITIVE_INFINITY
  const duration = Number.isFinite(durationMs) ? Math.max(0, Math.floor(durationMs)) : 0

  if (duration < 60_000) {
    return locale === "en" ? "less than a minute" : "меньше минуты"
  }

  let remaining = duration
  const parts: Array<{ value: number; unit: Unit }> = units.map(unit => {
    const value = Math.floor(remaining / unit.ms)
    remaining -= value * unit.ms
    return { value, unit }
  })

  const meaningful: Array<{ value: number; unit: Unit }> = parts.filter(({ value }) => value > 0)
  const selected: Array<{ value: number; unit: Unit }> =
    meaningful.length === 0 ? [parts[parts.length - 1]!] : meaningful

  const limited = selected.slice(0, maxParts)
  return limited
    .map(({ value, unit }) => `${value} ${formatUnit(value, unit.forms[locale], locale)}`)
    .join(" ")
}

function formatUnit(
  value: number,
  forms: UnitForms[RemainingLocale],
  locale: RemainingLocale,
): string {
  if (locale === "en") {
    const [singular, plural] = forms as UnitForms["en"]
    return value === 1 ? singular : plural
  }

  const [one, few, many] = forms as UnitForms["ru"]
  const mod10 = value % 10
  const mod100 = value % 100

  if (mod10 === 1 && mod100 !== 11) {
    return one
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return few
  }

  return many
}
