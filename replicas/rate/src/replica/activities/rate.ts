const CBR_SOAP_URL = "https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx"
const CBR_SOAP_ACTION = "http://web.cbr.ru/KeyRate"

/**
 * Formats a date as ISO 8601 datetime string for the CBR SOAP API.
 */
function formatSoapDate(date: Date): string {
  return date.toISOString().substring(0, 10) + "T00:00:00"
}

/**
 * Builds the SOAP request body for the KeyRate operation.
 */
function buildKeyRateSoapBody(fromDate: Date, toDate: Date): string {
  return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><KeyRate xmlns="http://web.cbr.ru/"><fromDate>${formatSoapDate(fromDate)}</fromDate><ToDate>${formatSoapDate(toDate)}</ToDate></KeyRate></soap:Body></soap:Envelope>`
}

/**
 * Fetches the current key rate from the official CBR SOAP API.
 * Queries the last 30 days to ensure a result is returned even if there was
 * no rate change today.
 *
 * @returns The current key rate as a percentage (e.g. 21 for 21%).
 */
export async function fetchKeyRate(): Promise<number> {
  const toDate = new Date()
  const fromDate = new Date(toDate)
  fromDate.setDate(fromDate.getDate() - 30)

  const response = await fetch(CBR_SOAP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: CBR_SOAP_ACTION,
    },
    body: buildKeyRateSoapBody(fromDate, toDate),
  })

  if (!response.ok) {
    throw new Error(`CBR API returned HTTP ${response.status}`)
  }

  const xml = await response.text()

  // Extract all <Rate> values; take the last one as the most recent rate.
  const lastRateStr = [...xml.matchAll(/<Rate>([\d.]+)<\/Rate>/g)].at(-1)?.[1]

  if (lastRateStr === undefined) {
    throw new Error("CBR API response does not contain key rate data")
  }

  const rate = Number.parseFloat(lastRateStr)

  if (Number.isNaN(rate)) {
    throw new Error(`Failed to parse key rate value: "${lastRateStr}"`)
  }

  return rate
}

export function createRateActivities() {
  return { fetchKeyRate }
}
