import type { Empty } from "@bufbuild/protobuf/wkt"
import type { ObservabilityServiceImplementation } from "@reside/api/infra/observability.v1"
import { authenticateReplica } from "@reside/common"
import { buildOpenTelemetryCredentialsResult } from "../business/observability"

export function createObservabilityService(): ObservabilityServiceImplementation {
  return {
    async getOpenTelemetryCredentials(_request: Empty, context) {
      await authenticateReplica(context)

      return buildOpenTelemetryCredentialsResult()
    },
  }
}
