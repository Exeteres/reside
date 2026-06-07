import type { ResideCrypto } from "@reside/common/encryption"
import { z } from "zod"
import { strings } from "../../locale"

const ECID_PATTERN = /enc:[a-z0-9_-]+:[a-z0-9_-]+/gi

type EcidTextSubstitutor = {
  substituteInText: (text: string) => Promise<string>
}

export function createEcidTextSubstitutor(
  crypto: ResideCrypto,
  args?: {
    onDecryptError?: (input: { ecid: string; error: Error }) => void
  },
): EcidTextSubstitutor {
  const valueCache = new Map<string, unknown>()

  return {
    async substituteInText(text) {
      const ecids = Array.from(new Set(text.match(ECID_PATTERN) ?? []))
      if (ecids.length === 0) {
        return text
      }

      const valueByEcid = new Map<string, string>()

      for (const ecid of ecids) {
        if (valueCache.has(ecid)) {
          valueByEcid.set(ecid, renderDecryptedValue(valueCache.get(ecid)))
          continue
        }

        try {
          const value = await crypto.decrypt(
            z.unknown(),
            ecid,
            strings.worker.ecidSubstitution.decryptReason,
          )

          valueCache.set(ecid, value)
          valueByEcid.set(ecid, renderDecryptedValue(value))
        } catch (error) {
          args?.onDecryptError?.({
            ecid,
            error: toError(error),
          })
          valueByEcid.set(ecid, strings.worker.ecidSubstitution.unavailableValue)
        }
      }

      return text.replace(ECID_PATTERN, ecid => valueByEcid.get(ecid) ?? ecid)
    },
  }
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }

  return new Error(String(error))
}

function renderDecryptedValue(value: unknown): string {
  if (typeof value === "string") {
    return value
  }

  if (Array.isArray(value)) {
    return renderArrayValue(value)
  }

  if (value !== null && typeof value === "object") {
    return strings.worker.ecidSubstitution.objectWithFieldCount(Object.keys(value).length)
  }

  if (value === null) {
    return strings.worker.ecidSubstitution.nullValue
  }

  if (typeof value === "boolean") {
    return value
      ? strings.worker.ecidSubstitution.booleanTrue
      : strings.worker.ecidSubstitution.booleanFalse
  }

  return String(value)
}

function renderArrayValue(value: unknown[]): string {
  if (value.length === 0) {
    return strings.worker.ecidSubstitution.emptyArray
  }

  if (value.every(item => typeof item === "string")) {
    return renderStringArrayValue(value as string[])
  }

  const objectCount = value.filter(
    item => item !== null && !Array.isArray(item) && typeof item === "object",
  ).length

  if (objectCount === value.length) {
    return strings.worker.ecidSubstitution.arrayOfObjects(value.length)
  }

  return strings.worker.ecidSubstitution.arrayWithElementCount(value.length)
}

function renderStringArrayValue(value: string[]): string {
  if (value.length === 1) {
    return value[0] ?? ""
  }

  if (value.length === 2) {
    const [first, second] = value
    return strings.worker.ecidSubstitution.stringArrayTwo(first ?? "", second ?? "")
  }

  const [first, second] = value
  return strings.worker.ecidSubstitution.stringArrayMany(
    first ?? "",
    second ?? "",
    value.length - 2,
  )
}
