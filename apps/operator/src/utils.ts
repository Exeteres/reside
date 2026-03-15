import { getStatusCode } from "@reside/utils"

export function isNotFoundError(error: unknown): boolean {
  return getStatusCode(error) === 404
}
