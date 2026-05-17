import type { PingServiceImplementation } from "@reside/api/common/ping.v1"
import { logger } from "./logger"

/**
 * Creates a basic PingService implementation used for replica wake-up calls.
 *
 * @returns A PingService implementation that always responds with an empty payload.
 */
export function createPingService(): PingServiceImplementation {
  return {
    async ping() {
      logger.debug("received ping request")

      return {}
    },
  }
}
