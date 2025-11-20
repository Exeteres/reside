/** biome-ignore-all lint/suspicious/noExplicitAny: to allow generic types */

import type { Logger } from "pino"
import type { LocalizedDisplayInfo } from "./contract"
import { experimental_defineRequest } from "jazz-tools"

export type AnyRequestInvoker = ReturnType<typeof defineMethod<any, any, any, any>>

export type MethodHandler<TRpcMethod extends RpcMethod> = Parameters<
  ReturnType<TRpcMethod["definition"]>["handle"]
>[2]

export type RpcMethod<TRequestDefinition extends AnyRequestInvoker = AnyRequestInvoker> = {
  /**
   * The display information for the method.
   *
   * The key is BCP 47 language tag (e.g., "en", "fr", "de") and the value is the display information in that language.
   */
  displayInfo: LocalizedDisplayInfo

  /**
   * The factory function to create the request definition.
   */
  definition: (url: string, workerId: string) => TRequestDefinition
}

export const defineMethod = experimental_defineRequest

export const rpcHandlers: Bun.Serve.Routes<unknown, string> = {}

export function startRpcServer(port: number, logger: Logger) {
  const server = Bun.serve({
    port,
    routes: rpcHandlers,
  })

  logger.info(
    `RPC server started on port ${server.port} with ${Object.keys(rpcHandlers).length} handlers`,
  )

  return server
}
