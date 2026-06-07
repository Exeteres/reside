import type { ResideCrypto } from "@reside/common/encryption"
import { describe, expect, mock, test } from "bun:test"
import { strings } from "../../locale"
import { createEcidTextSubstitutor } from "./ecid-substitution"

function createMockCrypto(values: Record<string, unknown>): {
  crypto: ResideCrypto
  decrypt: ReturnType<typeof mock>
} {
  const decrypt = mock(async (_schema: unknown, ecid: string | string[]) => {
    if (Array.isArray(ecid)) {
      return ecid.map(currentEcid => values[currentEcid])
    }

    return values[ecid]
  })

  return {
    crypto: {
      async encrypt() {
        throw new Error("encrypt is not used in ecid substitution")
      },
      async getSecret() {
        throw new Error("getSecret is not used in ecid substitution")
      },
      decrypt: decrypt as unknown as ResideCrypto["decrypt"],
    },
    decrypt,
  }
}

describe("createEcidTextSubstitutor", () => {
  test("returns input unchanged when there are no ECIDs", async () => {
    const { crypto, decrypt } = createMockCrypto({})
    const substitutor = createEcidTextSubstitutor(crypto)

    const result = await substitutor.substituteInText("обычный текст")

    expect(result).toBe("обычный текст")
    expect(decrypt).toHaveBeenCalledTimes(0)
  })

  test("substitutes duplicated ECID once and reuses cache", async () => {
    const ecid = "enc:alpha:abc123"
    const { crypto, decrypt } = createMockCrypto({
      [ecid]: "Алиса",
    })

    const substitutor = createEcidTextSubstitutor(crypto)

    const firstResult = await substitutor.substituteInText(`${ecid} и снова ${ecid}`)
    const secondResult = await substitutor.substituteInText(`повторно ${ecid}`)

    expect(firstResult).toBe("Алиса и снова Алиса")
    expect(secondResult).toBe("повторно Алиса")
    expect(decrypt).toHaveBeenCalledTimes(1)
    expect(decrypt.mock.calls[0]?.[2]).toBe(strings.worker.ecidSubstitution.decryptReason)
  })

  test("renders non-string decrypted values in localized generic format", async () => {
    const objectEcid = "enc:alpha:obj"
    const objectArrayEcid = "enc:alpha:objarr"
    const stringArrayEcid = "enc:alpha:strarr"
    const mixedArrayEcid = "enc:alpha:mixarr"
    const boolEcid = "enc:alpha:bool"
    const nullEcid = "enc:alpha:null"

    const { crypto } = createMockCrypto({
      [objectEcid]: { one: 1, two: 2 },
      [objectArrayEcid]: [{ a: 1 }, { b: 2 }, { c: 3 }],
      [stringArrayEcid]: ["a", "b", "c", "d"],
      [mixedArrayEcid]: ["a", 2, false],
      [boolEcid]: true,
      [nullEcid]: null,
    })

    const substitutor = createEcidTextSubstitutor(crypto)
    const result = await substitutor.substituteInText(
      [objectEcid, objectArrayEcid, stringArrayEcid, mixedArrayEcid, boolEcid, nullEcid].join(
        " | ",
      ),
    )

    expect(result).toBe(
      [
        "объект с 2 полями",
        "массив из 3 объектов",
        "a, b и ещё 2 элементов",
        "массив из 3 элементов",
        "да",
        "пустое значение",
      ].join(" | "),
    )
  })

  test("replaces undecryptable ECID with unavailable marker and keeps processing", async () => {
    const validEcid = "enc:alpha:valid"
    const brokenEcid = "enc:telegram:partial"
    const decrypt = mock(async (_schema: unknown, ecid: string | string[]) => {
      if (Array.isArray(ecid)) {
        return ecid
      }

      if (ecid === validEcid) {
        return "Алиса"
      }

      throw new Error("not found")
    })

    const substitutor = createEcidTextSubstitutor({
      async encrypt() {
        throw new Error("encrypt is not used in ecid substitution")
      },
      async getSecret() {
        throw new Error("getSecret is not used in ecid substitution")
      },
      decrypt: decrypt as unknown as ResideCrypto["decrypt"],
    })

    const result = await substitutor.substituteInText(`${brokenEcid} и ${validEcid}`)

    expect(result).toBe("ДАННЫЕ НЕДОСТУПНЫ и Алиса")
  })

  test("retries decrypting ECID after previous failure", async () => {
    const ecid = "enc:telegram:progressive"
    let attempts = 0
    const decrypt = mock(async (_schema: unknown, inputEcid: string | string[]) => {
      if (Array.isArray(inputEcid)) {
        return inputEcid
      }

      if (inputEcid !== ecid) {
        return inputEcid
      }

      attempts += 1
      if (attempts === 1) {
        throw new Error("still partial")
      }

      return "готово"
    })

    const substitutor = createEcidTextSubstitutor({
      async encrypt() {
        throw new Error("encrypt is not used in ecid substitution")
      },
      async getSecret() {
        throw new Error("getSecret is not used in ecid substitution")
      },
      decrypt: decrypt as unknown as ResideCrypto["decrypt"],
    })

    const firstResult = await substitutor.substituteInText(ecid)
    const secondResult = await substitutor.substituteInText(ecid)

    expect(firstResult).toBe("ДАННЫЕ НЕДОСТУПНЫ")
    expect(secondResult).toBe("готово")
    expect(decrypt).toHaveBeenCalledTimes(2)
  })
})
