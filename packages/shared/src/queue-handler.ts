export type MaybeAsyncHandler<TArgs extends unknown[] = unknown[]> = (
  ...args: TArgs
) => Promise<void> | void

export type FireAndForgetHandler<TArgs extends unknown[] = unknown[]> = (...args: TArgs) => void

/**
 * Creates minimal single-concurrency "fire-and-forget" wrapper of some handler.
 *
 * Semantics:
 * - at most one handler runs at a time;
 * - while running there is at most one pending invocation;
 * - new calls replace the pending args (latest wins);
 * - the handler is never cancelled once started.
 *
 * @param handler The handler function to wrap.
 * @returns Fire-and-forget wrapper function.
 */
export function singleConcurrencyFireAndForget<TArgs extends unknown[] = unknown[]>(
  handler: MaybeAsyncHandler<TArgs>,
): FireAndForgetHandler<TArgs> {
  let running = false
  let pending: { args: TArgs } | null = null

  async function runNext(): Promise<void> {
    if (running) return

    const item = pending
    if (!item) return

    pending = null
    running = true

    try {
      await handler(...item.args)
    } finally {
      running = false
      if (pending) {
        void runNext()
      }
    }
  }

  return (...args: TArgs): void => {
    if (pending) {
      // replace pending args (latest wins)
      pending.args = args
    } else if (running) {
      // running, create pending so it runs after current finishes
      pending = { args }
    } else {
      // idle, capture and start immediately
      pending = { args }
      void runNext()
    }
  }
}

export default singleConcurrencyFireAndForget
