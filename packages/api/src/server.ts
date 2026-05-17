// import type { DescService } from "@bufbuild/protobuf"
// import type { Interceptor, ServiceImpl } from "@connectrpc/connect"
// import { createServer as createNodeServer, type Server as NodeServer } from "node:http"
// import { connectNodeAdapter } from "@connectrpc/connect-node"
// import { context, propagation, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api"
// import { registerGracefulShutdown } from "./shutdown"

// export type ShutdownableServer = {
//   listen(address: string): Promise<number>
//   shutdown(): Promise<void>
// }

// type ServiceRegistration = {
//   definition: DescService
//   implementation: ServiceImpl<DescService>
// }

// const grpcServerTracer = trace.getTracer("reside.grpc.server")

// export type RpcServer = ShutdownableServer & {
//   add<TService extends DescService>(
//     definition: TService,
//     implementation: ServiceImpl<TService>,
//   ): void
// }

// /**
//  * Creates an RPC server for protobuf service descriptors.
//  *
//  * @returns A mutable server instance with `add`, `listen`, and `shutdown` methods.
//  */
// export function createServer(): RpcServer {
//   const services: ServiceRegistration[] = []
//   let server: NodeServer | null = null

//   return {
//     add<TService extends DescService>(
//       definition: TService,
//       implementation: ServiceImpl<TService>,
//     ): void {
//       services.push({
//         definition,
//         implementation: implementation as ServiceImpl<DescService>,
//       })
//     },

//     async listen(address: string): Promise<number> {
//       const { host, port } = parseAddress(address)
//       const handler = connectNodeAdapter({
//         interceptors: [createGrpcServerTracingInterceptor()],
//         routes(router) {
//           for (const service of services) {
//             router.service(service.definition, service.implementation)
//           }
//         },
//       })

//       server = createNodeServer((request, response) => {
//         handler(request, response)
//       })

//       await new Promise<void>((resolve, reject) => {
//         server?.once("error", reject)
//         server?.listen(port, host, () => {
//           server?.off("error", reject)
//           resolve()
//         })
//       })

//       return port
//     },

//     async shutdown(): Promise<void> {
//       if (!server) {
//         return
//       }

//       await new Promise<void>((resolve, reject) => {
//         server?.close(error => {
//           if (error) {
//             reject(error)
//             return
//           }

//           resolve()
//         })
//       })

//       server = null
//     },
//   }
// }

// function createGrpcServerTracingInterceptor(): Interceptor {
//   return next => async request => {
//     const serviceName = request.service.typeName
//     const methodName = request.method.name

//     const incomingContext = propagation.extract(context.active(), request.header, {
//       get(carrier, key) {
//         const value = carrier.get(key)
//         if (value === null) {
//           return []
//         }

//         return [value]
//       },
//       keys(carrier) {
//         return Array.from(carrier.keys())
//       },
//     })

//     return await context.with(incomingContext, async () =>
//       grpcServerTracer.startActiveSpan(
//         `${serviceName}/${methodName}`,
//         {
//           kind: SpanKind.SERVER,
//         },
//         async span => {
//           span.setAttribute("rpc.system", "grpc")
//           span.setAttribute("rpc.service", serviceName)
//           span.setAttribute("rpc.method", methodName)
//           span.setAttribute("reside.replica", process.env.REPLICA_NAME ?? "unknown")

//           try {
//             const response = await next(request)

//             const grpcStatus = response.header.get("grpc-status")
//             if (grpcStatus) {
//               span.setAttribute("rpc.grpc.status_code", Number(grpcStatus))
//             }

//             return response
//           } catch (error) {
//             span.recordException(error as Error)
//             span.setStatus({
//               code: SpanStatusCode.ERROR,
//               message: error instanceof Error ? error.message : String(error),
//             })

//             throw error
//           } finally {
//             span.end()
//           }
//         },
//       ),
//     )
//   }
// }

// /**
//  * Starts a server, then registers a graceful shutdown handler.
//  *
//  * @param server The server instance.
//  */
// export async function startService(server: ShutdownableServer): Promise<void> {
//   await server.listen("0.0.0.0:8080")

//   registerGracefulShutdown(() => server.shutdown())
// }

// function parseAddress(address: string): { host: string; port: number } {
//   const separatorIndex = address.lastIndexOf(":")
//   if (separatorIndex < 1 || separatorIndex === address.length - 1) {
//     throw new Error(`Invalid listen address "${address}"`)
//   }

//   const host = address.slice(0, separatorIndex)
//   const portValue = Number(address.slice(separatorIndex + 1))

//   if (!Number.isInteger(portValue) || portValue < 1 || portValue > 65535) {
//     throw new Error(`Invalid listen port in address "${address}"`)
//   }

//   return {
//     host,
//     port: portValue,
//   }
// }
