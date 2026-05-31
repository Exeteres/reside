export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function getStatusCode(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined
  }

  const directCode = error.code
  if (typeof directCode === "number") {
    return directCode
  }

  const directStatusCode = error.statusCode
  if (typeof directStatusCode === "number") {
    return directStatusCode
  }

  const response = error.response
  if (!isRecord(response)) {
    return undefined
  }

  const responseStatusCode = response.statusCode
  if (typeof responseStatusCode === "number") {
    return responseStatusCode
  }

  const responseCode = response.code
  if (typeof responseCode === "number") {
    return responseCode
  }

  return undefined
}

export function errorToString(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

export function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }

  return new Error(String(error))
}
