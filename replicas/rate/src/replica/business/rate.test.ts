import { describe, expect, it } from "bun:test"
import { XMLParser } from "fast-xml-parser"
import { fetchKeyRate, parseLatestRateRowFromXml, replaceSingleRateInTitle } from "./rate"

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
})

describe("parseLatestRateRowFromXml", () => {
  it("returns latest row by DT from CBR SOAP payload", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <KeyRateResponse xmlns="http://web.cbr.ru/">
      <KeyRateResult>
        <diffgr:diffgram xmlns:diffgr="urn:schemas-microsoft-com:xml-diffgram-v1">
          <KeyRate>
            <KR>
              <DT>2026-05-15T00:00:00+03:00</DT>
              <Rate>14.75</Rate>
            </KR>
            <KR>
              <DT>2026-05-19T00:00:00+03:00</DT>
              <Rate>14.50</Rate>
            </KR>
            <KR>
              <DT>2026-05-16T00:00:00+03:00</DT>
              <Rate>14.75</Rate>
            </KR>
          </KeyRate>
        </diffgr:diffgram>
      </KeyRateResult>
    </KeyRateResponse>
  </soap:Body>
</soap:Envelope>`

    const row = parseLatestRateRowFromXml({
      xml,
      parseXml: value => xmlParser.parse(value),
    })

    expect(row).toEqual({
      dateValue: "2026-05-19T00:00:00+03:00",
      rateValue: "14.50",
    })
  })

  it("returns undefined when payload does not contain KR rows", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <KeyRateResponse xmlns="http://web.cbr.ru/">
      <KeyRateResult>
        <diffgr:diffgram xmlns:diffgr="urn:schemas-microsoft-com:xml-diffgram-v1">
          <KeyRate />
        </diffgr:diffgram>
      </KeyRateResult>
    </KeyRateResponse>
  </soap:Body>
</soap:Envelope>`

    const row = parseLatestRateRowFromXml({
      xml,
      parseXml: value => xmlParser.parse(value),
    })

    expect(row).toBeUndefined()
  })
})

describe("replaceSingleRateInTitle", () => {
  it("replaces one rate-like number and preserves comma format", () => {
    expect(replaceSingleRateInTitle("Ключевая ставка 16,5%", 18.25)).toBe("Ключевая ставка 18,25%")
  })

  it("replaces one rate-like number and preserves dot format", () => {
    expect(replaceSingleRateInTitle("Rate: 16.5%", 18.25)).toBe("Rate: 18.25%")
  })

  it("does not replace when title has no rate-like number", () => {
    expect(replaceSingleRateInTitle("Ключевая ставка", 18.25)).toBeUndefined()
  })

  it("does not replace when title has multiple numbers", () => {
    expect(replaceSingleRateInTitle("Ставка 16,5 от 2026", 18.25)).toBeUndefined()
  })
})

describe("fetchKeyRate", () => {
  it("fetches and parses key rate with explicit dependencies", async () => {
    const fetchCalls: Array<{
      input: unknown
      init?: RequestInit
    }> = []

    const fetchFn = (async (input: unknown, init?: RequestInit) => {
      fetchCalls.push({ input, init })

      return new Response("<xml />", {
        status: 200,
        headers: {
          "content-type": "text/xml",
        },
      })
    }) as typeof fetch

    const rate = await fetchKeyRate({
      fetchFn,
      now: () => new Date("2026-05-30T12:00:00.000Z"),
      parseXml: () => {
        return {
          root: {
            KR: [
              {
                DT: "2026-05-29T00:00:00+03:00",
                Rate: "13,50",
              },
            ],
          },
        }
      },
    })

    expect(rate).toBe(13.5)
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]?.init?.method).toBe("POST")
    expect(fetchCalls[0]?.init?.body).toContain("<fromDate>2026-04-30T12:00:00.000Z</fromDate>")
    expect(fetchCalls[0]?.init?.body).toContain("<ToDate>2026-05-30T12:00:00.000Z</ToDate>")
  })

  it("rethrows CBR network failures with context", () => {
    const fetchFn = createFetchMock(async () => {
      throw new Error("network unavailable")
    })

    expect(
      fetchKeyRate({
        fetchFn,
        now: () => new Date("2026-05-30T12:00:00.000Z"),
      }),
    ).rejects.toThrow("Failed to fetch key rate response from CBR")
  })

  it("rethrows CBR XML parser failures with context", () => {
    const fetchFn = createFetchMock(async () => {
      return new Response("<xml />", {
        status: 200,
        headers: {
          "content-type": "text/xml",
        },
      })
    })

    expect(
      fetchKeyRate({
        fetchFn,
        now: () => new Date("2026-05-30T12:00:00.000Z"),
        parseXml: () => {
          throw new Error("invalid xml")
        },
      }),
    ).rejects.toThrow("Failed to parse key rate XML from CBR")
  })
})

type FetchMockHandler = (
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
) => Promise<Response>

function createFetchMock(handler: FetchMockHandler) {
  return handler as unknown as typeof fetch
}
