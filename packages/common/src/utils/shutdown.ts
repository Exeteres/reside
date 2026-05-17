export type ShutdownHandler = () => Promise<void>

const shutdownHandlers: ShutdownHandler[] = []
let listenersRegistered = false
let shutdownPromise: Promise<void> | null = null

async function runShutdownHandlers(): Promise<void> {
  if (shutdownPromise !== null) {
    await shutdownPromise
    return
  }

  shutdownPromise = (async () => {
    for (const handler of [...shutdownHandlers].reverse()) {
      try {
        await handler()
      } catch (error) {
        console.error("graceful shutdown handler failed", error)
      }
    }
  })()

  await shutdownPromise
}

function ensureShutdownListeners(): void {
  if (listenersRegistered) {
    return
  }

  listenersRegistered = true

  process.once("SIGINT", () => {
    void runShutdownHandlers()
  })

  process.once("SIGTERM", () => {
    void runShutdownHandlers()
  })
}

/**
 * Registers a shutdown handler for SIGINT and SIGTERM.
 *
 * The handler is executed at most once.
 *
 * @param handler The async shutdown handler.
 */
export function registerGracefulShutdown(handler: ShutdownHandler): void {
  if (shutdownPromise !== null) {
    return
  }

  shutdownHandlers.push(handler)
  ensureShutdownListeners()
}
