import { Code, ConnectError } from "@connectrpc/connect"

export function mapReplicaCallErrorMessage(
  error: unknown,
  input: {
    deadMessage: string
    brokenMessage: string
  },
): string {
  if (isReplicaGatewayError(error)) {
    return input.deadMessage
  }

  return input.brokenMessage
}

function isReplicaGatewayError(error: unknown): boolean {
  if (error instanceof ConnectError) {
    return error.code === Code.Unavailable || error.code === Code.DeadlineExceeded
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return (
      message.includes("502") ||
      message.includes("503") ||
      message.includes("bad gateway") ||
      message.includes("unavailable") ||
      message.includes("deadline")
    )
  }

  return false
}
