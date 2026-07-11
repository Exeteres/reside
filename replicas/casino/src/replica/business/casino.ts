import type { ResideCrypto } from "@reside/common/encryption"
import { CasinoValidationError } from "../../definitions"
import { strings } from "../../locale"

export const DEFAULT_BET_SIDES = "1-3"
export const DICE_EMOJI = "🎲"

export type ParsedBet = {
  amount: string
  sides: number[]
  selectedSideCount: number
  payoutAmount: string
  multiplierLabel: string
}

export type EncryptedParsedBet = Omit<ParsedBet, "amount" | "payoutAmount"> & {
  amountEcid: string
  payoutAmountEcid: string
}

export function parseBet(amount: string, rawSides?: string): ParsedBet {
  const parsedAmount = parsePositiveInteger(amount, strings.errors.positiveAmount)
  const sides = parseBetSides(rawSides ?? DEFAULT_BET_SIDES)
  const selectedSideCount = sides.length
  const payoutNumerator = parsedAmount * 6n
  const divisor = BigInt(selectedSideCount)

  if (payoutNumerator % divisor !== 0n) {
    throw new CasinoValidationError(strings.errors.fractionalPayout)
  }

  const multiplierNumerator = 6
  const multiplierLabel =
    multiplierNumerator % selectedSideCount === 0
      ? `x${multiplierNumerator / selectedSideCount}`
      : `x${multiplierNumerator}/${selectedSideCount}`

  return {
    amount: parsedAmount.toString(),
    sides,
    selectedSideCount,
    payoutAmount: (payoutNumerator / divisor).toString(),
    multiplierLabel,
  }
}

export async function parseEncryptedBet(
  crypto: ResideCrypto,
  amount: string,
  rawSides?: string,
): Promise<EncryptedParsedBet> {
  const parsed = parseBet(amount, rawSides)

  return {
    amountEcid: await crypto.encrypt(parsed.amount),
    sides: parsed.sides,
    selectedSideCount: parsed.selectedSideCount,
    payoutAmountEcid: await crypto.encrypt(parsed.payoutAmount),
    multiplierLabel: parsed.multiplierLabel,
  }
}

export function assertSufficientBalance(balance: string, payoutAmount: string): void {
  const parsedBalance = parsePositiveIntegerOrZero(balance)
  const parsedPayout = parsePositiveInteger(payoutAmount, strings.errors.invalidPayout)

  if (parsedBalance < parsedPayout) {
    throw new CasinoValidationError(strings.errors.insufficientCasinoFunds)
  }
}

function parseBetSides(rawSides: string): number[] {
  const tokens = rawSides
    .split(",")
    .map(token => token.trim())
    .filter(token => token.length > 0)

  if (tokens.length === 0) {
    throw new CasinoValidationError(strings.errors.emptySides)
  }

  const sides = new Set<number>()
  for (const token of tokens) {
    const rangeMatch = /^(\d+)-(\d+)$/.exec(token)
    if (rangeMatch) {
      const start = Number(rangeMatch[1])
      const end = Number(rangeMatch[2])
      assertSide(start)
      assertSide(end)
      if (start > end) {
        throw new CasinoValidationError(strings.errors.invalidSides)
      }

      for (let side = start; side <= end; side += 1) {
        sides.add(side)
      }
      continue
    }

    if (!/^\d+$/.test(token)) {
      throw new CasinoValidationError(strings.errors.invalidSides)
    }

    const side = Number(token)
    assertSide(side)
    sides.add(side)
  }

  if (sides.size === 0) {
    throw new CasinoValidationError(strings.errors.emptySides)
  }

  return [...sides].sort((left, right) => left - right)
}

function assertSide(side: number): void {
  if (!Number.isInteger(side) || side < 1 || side > 6) {
    throw new CasinoValidationError(strings.errors.invalidSideValue)
  }
}

function parsePositiveInteger(value: string, errorMessage: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new CasinoValidationError(errorMessage)
  }

  const parsed = BigInt(value)
  if (parsed <= 0n) {
    throw new CasinoValidationError(errorMessage)
  }

  return parsed
}

function parsePositiveIntegerOrZero(value: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new CasinoValidationError(strings.errors.invalidBalance)
  }

  return BigInt(value)
}
