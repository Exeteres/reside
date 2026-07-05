export type ShutdownHandler = () => Promise<void>

export type GracefulShutdownOptions = {
  forcedExitDelayMs?: number | null
  exitOnComplete?: boolean
}

const shutdownHandlers: ShutdownHandler[] = []
let listenersRegistered = false
let shutdownPromise: Promise<void> | null = null
const FORCED_EXIT_DELAY_MS = 5000
let gracefulShutdownOptions: Required<GracefulShutdownOptions> = {
  forcedExitDelayMs: FORCED_EXIT_DELAY_MS,
  exitOnComplete: true,
}

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
    const forcedExitTimeout =
      gracefulShutdownOptions.forcedExitDelayMs === null
        ? null
        : setTimeout(() => {
            console.error(
              `forced process exit after ${gracefulShutdownOptions.forcedExitDelayMs}ms ` +
                `timeout while handling ${signal}`,
            )
            process.exit(1)
          }, gracefulShutdownOptions.forcedExitDelayMs)
    forcedExitTimeout?.unref()

    void (async () => {
      await runShutdownHandlers()
      if (forcedExitTimeout !== null) {
        clearTimeout(forcedExitTimeout)
      }

      if (gracefulShutdownOptions.exitOnComplete) {
        process.exit(0)
      }
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
 * Configures global graceful shutdown signal handling.
 *
 * Pass `null` as `forcedExitDelayMs` to disable the forced process exit timer.
 * Set `exitOnComplete` to `false` when another signal handler owns process exit.
 *
 * @param options The shutdown options to apply.
 */
export function configureGracefulShutdown(options: GracefulShutdownOptions): void {
  gracefulShutdownOptions = {
    ...gracefulShutdownOptions,
    ...options,
  }
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
