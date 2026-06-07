import type { ResideCrypto } from "../encryption"
import { createId } from "@paralleldrive/cuid2"

const encryptedValues = new Map<string, unknown>()

export const testCrypto: ResideCrypto = {
  async encrypt(data) {
    const ecid = `enc:test:${createId()}`
    encryptedValues.set(ecid, data)

    return ecid
  },
  async getSecret(key) {
    return `test-secret:${key}`
  },
  async decrypt(schema, ecid) {
    const ecids = Array.isArray(ecid) ? ecid : [ecid]
    const values: unknown[] = []

    for (const currentEcid of ecids) {
      if (!encryptedValues.has(currentEcid)) {
        throw new Error(`Test encrypted content "${currentEcid}" is not found`)
      }

      values.push(encryptedValues.get(currentEcid))
    }

    if (Array.isArray(ecid)) {
      return schema.parse(values)
    }

    return schema.parse(values[0])
  },
}
