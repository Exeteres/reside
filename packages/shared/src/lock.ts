import type { LocalNode } from "cojson"
import type { Logger } from "pino"
import { createWebSocketPeer } from "cojson-transport-ws"
import { type Etcd3, EtcdLockFailedError } from "etcd3"
import {
  type Account,
  type CoValueClassOrSchema,
  JazzRequestError,
  type co,
  createJazzContextFromExistingCredentials,
  isControlledAccount,
  randomSessionProvider,
} from "jazz-tools"
import pRetry from "p-retry"
import { loadConfig } from "./config"
import { CommonReplicaConfig } from "./replica"

export type LockOptions = {
  /**
   * The time-to-live for the lock in milliseconds.
   *
   * Default is 30 000 ms (30 seconds).
   */
  ttl?: number
}

export interface LockService {
  /**
   * Acquires a lock for the given key, executes the handler, and releases the lock.
   *
   * @param key The key to acquire the lock for.
   * @param handler The handler to execute while holding the lock.
   * @param options The options for acquiring the lock.
   */
  acquire<TResult = void>(
    key: string,
    handler: () => Promise<TResult> | TResult,
    options?: LockOptions,
  ): Promise<TResult>

  /**
   * Executes a transaction with the given value.
   *
   * It includes:
   * - acquiring a lock for the `$jazz.id` of the value,
   * - creating new context inside lock and loading the value inside it,
   * - executing the handler with the loaded value,
   * - using `waitForAllCoValuesSync` to ensure all changes are persisted before releasing the lock.
   *
   * @param schema The CoValue schema or class to load the value as.
   * @param value The CoValue to execute the transaction on.
   * @param handler The handler to execute inside the transaction.
   * @param options The options for acquiring the lock.
   */
  transaction<TSchema extends CoValueClassOrSchema, TResult = void>(
    schema: TSchema,
    value: co.loaded<TSchema>,
    handler: (value: co.loaded<TSchema>, account: Account) => Promise<TResult> | TResult,
    options?: LockOptions,
  ): Promise<TResult>
}

export class SafeJazzRequestError extends Error {
  public readonly isJazzRequestError = true

  public constructor(
    message: string,
    public readonly code: number,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = "JazzRequestError"
  }

  toJSON() {
    return { message: this.message, code: this.code, details: this.details }
  }
}

export class EtcdLockService implements LockService {
  constructor(
    private readonly etcd: Etcd3 | undefined,
    private readonly logger: Logger,
  ) {}

  async acquire<TResult = void>(
    key: string,
    handler: () => Promise<TResult>,
    options?: LockOptions,
  ): Promise<TResult> {
    if (!this.etcd) {
      throw new Error("etcd client is not initialized, cannot acquire lock")
    }

    const safeHandler = async (): Promise<TResult> => {
      try {
        return await handler()
      } catch (err) {
        if (err instanceof JazzRequestError) {
          throw new SafeJazzRequestError(err.message, err.code, err.details)
        }

        this.logger.error({ err }, `error occurred while executing handler for lock "${key}"`)
        throw err
      }
    }

    const ttl = options?.ttl ?? 30

    return await pRetry(
      async () => {
        return await this.etcd!.lock(key).ttl(ttl).do(safeHandler)
      },
      {
        minTimeout: 100,
        retries: 10,
        shouldRetry: ({ error }) => error instanceof EtcdLockFailedError,
      },
    )
  }

  // @ts-expect-error idk why
  async transaction<TSchema extends CoValueClassOrSchema, TResult = void>(
    schema: TSchema,
    value: co.loaded<TSchema>,
    handler: (value: co.loaded<TSchema>, account: Account) => Promise<TResult> | TResult,
    options?: LockOptions,
  ): Promise<TResult> {
    return await this.acquire(
      value.$jazz.id,
      async () => {
        this.logger.debug(`starting transaction for value "%s"`, value.$jazz.id)

        const account = value.$jazz.loadedAs as Account
        // @ts-expect-error idk why
        const localNode = value.$jazz.localNode as LocalNode

        if (!isControlledAccount(account)) {
          throw new Error("LockService.transaction can only be used with controlled accounts")
        }

        const config = loadConfig(CommonReplicaConfig)

        const context = await createJazzContextFromExistingCredentials({
          asActiveAccount: false,
          credentials: {
            accountID: account.$jazz.id,
            secret: localNode.agentSecret,
          },
          crypto: localNode.crypto,
          sessionProvider: randomSessionProvider,
          peers: [
            createWebSocketPeer({
              id: "upstream",
              role: "server",
              websocket: new WebSocket(config.RESIDE_SYNC_SERVER_URL),
            }),
          ],
        })

        try {
          // @ts-expect-error to simplify
          const loadedValue = await schema.load(value.$jazz.id, { loadAs: context.account })

          if (!loadedValue.$isLoaded) {
            throw new Error(
              `Failed to load value "${value.$jazz.id}" inside transaction: ${loadedValue.$jazz.loadingState}`,
            )
          }

          return await handler(loadedValue as co.loaded<TSchema>, context.account)
        } finally {
          await context.account.$jazz.waitForAllCoValuesSync()
          await context.logOut()

          this.logger.debug(`completed transaction for value "%s"`, value.$jazz.id)
        }
      },
      options,
    )
  }
}
