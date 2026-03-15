import { registerGracefulShutdown } from "./shutdown"

export type ShutdownableServer = {
  listen(address: string): Promise<number>
  shutdown(): Promise<void>
}

/**
 * Starts a server, then registers a graceful shutdown handler.
 *
 * @param server The server instance.
 */
export async function startService(server: ShutdownableServer): Promise<void> {
  await server.listen("0.0.0.0:8080")

  registerGracefulShutdown(() => server.shutdown())
}
