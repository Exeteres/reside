import { XMLParser } from "fast-xml-parser"

const cbrKeyRateUrl = "https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx"
const cbrSoapAction = "http://web.cbr.ru/KeyRate"

type ParseXml = (xml: string) => unknown

export type RateRow = {
  dateValue: string
  rateValue: string
}

export type FetchKeyRateDependencies = {
  fetchFn: typeof fetch
  now?: () => Date
  parseXml?: ParseXml
  keyRateUrl?: string
  soapAction?: string
}

const defaultXmlParser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
})

const parseXmlWithDefaultParser: ParseXml = xml => {
  return defaultXmlParser.parse(xml)
}

/**
 * Fetches the latest Bank of Russia key rate value.
 *
 * It requests the CBR SOAP endpoint for the recent 30-day window
 * and returns the most recent value by `<DT>` date from the response payload.
 *
 * @param fetchFn The fetch implementation used for HTTP requests.
 * @param now The current time provider.
 * @param parseXml XML parser function used to parse response payload.
 * @param keyRateUrl SOAP endpoint URL.
 * @param soapAction SOAP action header value.
 * @returns The latest key rate as number.
 */
export async function fetchKeyRate({
  fetchFn,
  now = () => new Date(),
  parseXml = parseXmlWithDefaultParser,
  keyRateUrl = cbrKeyRateUrl,
  soapAction = cbrSoapAction,
}: FetchKeyRateDependencies): Promise<number> {
  const to = now()
  const from = new Date(to)
  from.setDate(from.getDate() - 30)
  const fromDate = formatSoapDateTime(from)
  const toDate = formatSoapDateTime(to)
  const requestBody = buildKeyRateSoapEnvelope(fromDate, toDate)

  const response = await fetchFn(keyRateUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `"${soapAction}"`,
    },
    body: requestBody,
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch key rate response with status "${response.status}"`)
  }

  const xml = await response.text()
  const latestRateRow = parseLatestRateRowFromXml({
    xml,
    parseXml,
  })
  const latestRateValue = latestRateRow?.rateValue

  if (!latestRateValue) {
    throw new Error("Failed to parse key rate from CBR response")
  }

  const normalizedRateValue = latestRateValue.replace(",", ".")
  const parsedRate = Number(normalizedRateValue)
  if (Number.isNaN(parsedRate) || parsedRate <= 0) {
    throw new Error(`Failed to parse valid key rate from value "${latestRateValue}"`)
  }

  return parsedRate
}

function formatSoapDateTime(date: Date): string {
  return date.toISOString()
}

function buildKeyRateSoapEnvelope(fromDate: string, toDate: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <KeyRate xmlns="http://web.cbr.ru/">
      <fromDate>${fromDate}</fromDate>
      <ToDate>${toDate}</ToDate>
    </KeyRate>
  </soap:Body>
</soap:Envelope>`
}

export function parseLatestRateRowFromXml({
  xml,
  parseXml,
}: {
  xml: string
  parseXml: ParseXml
}): RateRow | undefined {
  const rateRows = extractRateRows({
    xml,
    parseXml,
  })

  return selectLatestRateRow(rateRows)
}

function extractRateRows({ xml, parseXml }: { xml: string; parseXml: ParseXml }): RateRow[] {
  const parsedXml = parseXml(xml)
  const rows: RateRow[] = []

  collectRateRows(parsedXml, rows)

  return rows
}

function collectRateRows(value: unknown, rows: RateRow[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRateRows(item, rows)
    }

    return
  }

  if (!value || typeof value !== "object") {
    return
  }

  const record = value as Record<string, unknown>
  const dateValue = toStringValue(record.DT)
  const rateValue = toStringValue(record.Rate)

  if (dateValue && rateValue) {
    rows.push({
      dateValue,
      rateValue,
    })
  }

  for (const nestedValue of Object.values(record)) {
    collectRateRows(nestedValue, rows)
  }
}

function selectLatestRateRow(rows: RateRow[]): RateRow | undefined {
  return rows.reduce<RateRow | undefined>((latest, row) => {
    if (latest === undefined) {
      return row
    }

    const latestTime = Date.parse(latest.dateValue)
    const rowTime = Date.parse(row.dateValue)

    if (Number.isNaN(rowTime)) {
      return latest
    }

    if (Number.isNaN(latestTime) || rowTime > latestTime) {
      return row
    }

    return latest
  }, undefined)
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim()

    return trimmed.length > 0 ? trimmed : undefined
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value)
  }

  return undefined
}
