const cbrKeyRateUrl = "https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx/KeyRate"

/**
 * Fetches the latest Bank of Russia key rate value.
 *
 * It requests the CBR SOAP endpoint for the recent 30-day window
 * and returns the last `<Rate>` value from the response payload.
 *
 * @returns The latest key rate as number.
 */
export async function fetchKeyRate(): Promise<number> {
  const now = new Date()
  const from = new Date(now)
  from.setDate(from.getDate() - 30)

  const response = await fetch(cbrKeyRateUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      fromDate: formatDate(from),
      ToDate: formatDate(now),
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch key rate response with status "${response.status}"`)
  }

  const xml = await response.text()
  const lastRateValue = [...xml.matchAll(/<Rate>([\d.]+)<\/Rate>/g)].at(-1)?.[1]

  if (!lastRateValue) {
    throw new Error("Failed to parse key rate from CBR response")
  }

  const parsedRate = Number(lastRateValue)
  if (Number.isNaN(parsedRate) || parsedRate <= 0) {
    throw new Error(`Failed to parse valid key rate from value "${lastRateValue}"`)
  }

  return parsedRate
}

function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const year = date.getFullYear()

  return `${month}/${day}/${year}`
}
