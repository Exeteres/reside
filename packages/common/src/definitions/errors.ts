export class ResideError extends Error {}

export function isResideError(error: unknown, name: string): error is ResideError {
  if (error instanceof Error && error.name === name) {
    return true
  }

  if (error === null || typeof error !== "object") {
    return false
  }

  if ("type" in error && error.type === name) {
    return true
  }

  if ("cause" in error) {
    return isResideError(error.cause, name)
  }

  return false
}
