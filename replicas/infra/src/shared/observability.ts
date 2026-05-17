import { OpenTelemetryProtocol } from "@reside/api/infra/observability.v1_pb"
import { getReplicaNamespace } from "@reside/common"

const SIGNOZ_OTEL_COLLECTOR_SERVICE_NAME = "signoz-otel-collector"
const SIGNOZ_OTLP_GRPC_PORT = 4317

export function getOpenTelemetryCredentials() {
  return {
    endpoint: `${SIGNOZ_OTEL_COLLECTOR_SERVICE_NAME}.${getReplicaNamespace()}.svc.cluster.local:${SIGNOZ_OTLP_GRPC_PORT}`,
    protocol: OpenTelemetryProtocol.GRPC,
    insecure: true,
    headers: [],
    tlsCaPem: "",
    refreshAfterSeconds: 300,
  }
}
