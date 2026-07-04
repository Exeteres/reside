---
name: reside-rate-api
description: Use when editing the key rate replica, its get_rate NLS tool, Bank of Russia SOAP integration, key rate parsing, or rate API behavior.
skill_enforcement:
  patterns:
    - "replicas/rate/**"
---

# ReSide Key Rate Replica API

## Purpose

The key rate replica receives data from the public Bank of Russia SOAP API.
The internal NLS tool `get_rate` does not use a separate hidden data source: it calls the same business function for fetching the key rate, which calls the Bank of Russia endpoint directly.

## Data Source

- External source: Bank of Russia, service `DailyInfoWebServ`.
- Endpoint: `https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx`.
- SOAP action: `http://web.cbr.ru/KeyRate`.
- Method purpose: receive key rate values for the requested date range.

## Request Format

The request is made with `POST` to the Bank of Russia endpoint.
The request body is SOAP XML.
The replica requests a window from current date minus 30 days to current date and then selects the latest record by the `DT` field.

Required headers:

```http
Content-Type: text/xml; charset=utf-8
SOAPAction: "http://web.cbr.ru/KeyRate"
```

Request body:

```xml
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <KeyRate xmlns="http://web.cbr.ru/">
      <fromDate>2026-05-20T12:00:00.000Z</fromDate>
      <ToDate>2026-06-19T12:00:00.000Z</ToDate>
    </KeyRate>
  </soap:Body>
</soap:Envelope>
```

Request fields:

- `fromDate` is the period start in ISO 8601.
- `ToDate` is the period end in ISO 8601.

## Response Format

A successful response arrives as SOAP XML with `KeyRateResult`.
Inside the payload, the Bank of Russia returns a set of `KR` rows.
The replica searches the response for rows containing `DT` and `Rate` fields regardless of nesting level and uses the row with the latest `DT` date.

Example meaningful response part:

```xml
<KeyRateResponse xmlns="http://web.cbr.ru/">
  <KeyRateResult>
    <diffgr:diffgram xmlns:diffgr="urn:schemas-microsoft-com:xml-diffgram-v1">
      <KeyRate>
        <KR>
          <DT>2026-05-29T00:00:00+03:00</DT>
          <Rate>13.50</Rate>
        </KR>
      </KeyRate>
    </diffgr:diffgram>
  </KeyRateResult>
</KeyRateResponse>
```

Used response fields:

- `KR` is a row with one key rate value.
- `DT` is the effective date of the key rate value and is used to select the newest row.
- `Rate` is the key rate value in percent and may use either a dot or comma decimal separator.

## `get_rate` Result Format

The `get_rate` NLS tool accepts no arguments.
On successful data retrieval, it returns:

```json
{
  "rate": 13.5,
  "unit": "percent",
  "response": "Current key rate is 13.5%."
}
```

Result fields:

- `rate` is the numeric value of the latest found key rate.
- `unit` is the unit and is always `percent`.
- `response` is a human-readable message for the language interface.

If data could not be fetched or parsed, the tool returns an object with a `response` field containing the error text.
