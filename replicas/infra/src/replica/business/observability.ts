import { getOpenTelemetryCredentials } from "../../shared"

export function buildOpenTelemetryCredentialsResult() {
  return {
    result: getOpenTelemetryCredentials(),
  }
}
