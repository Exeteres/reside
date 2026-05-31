export type ShutdownHandler = () => Promise<void>

const shutdownHandlers: ShutdownHandler[] = []
let listenersRegistered = false
let shutdownPromise: Promise<void> | null = null
const FORCED_EXIT_DELAY_MS = 5000

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

  const handleSignal = (signal: NodeJS.Signals) => {
    const forcedExitTimeout = setTimeout(() => {
      console.error(
        `forced process exit after ${FORCED_EXIT_DELAY_MS}ms timeout while handling ${signal}`,
      )
      process.exit(1)
    }, FORCED_EXIT_DELAY_MS)
    forcedExitTimeout.unref()

    void (async () => {
      await runShutdownHandlers()
      clearTimeout(forcedExitTimeout)
      process.exit(0)
    })()
  }

  process.once("SIGINT", () => {
    handleSignal("SIGINT")
  })

  process.once("SIGTERM", () => {
    handleSignal("SIGTERM")
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
