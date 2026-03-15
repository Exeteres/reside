import { Channel, ChannelCredentials, createClientFactory } from "nice-grpc"
import { retryMiddleware } from "nice-grpc-client-middleware-retry"

/**
 * Creates a gRPC client for the specified endpoint configured with ReSide's standard settings.
 *
 * @param endpoint The gRPC server endpoint to connect to.
 * @returns A configured gRPC client instance.
 */
export function createChannel(endpoint: string): Channel {
  return new Channel(endpoint, ChannelCredentials.createInsecure(), {})
}

/**
 * The shared gRPC client factory instance used across ReSide services, configured with the standard settings and middleware.
 */
export const clientFactory = createClientFactory().use(retryMiddleware)
