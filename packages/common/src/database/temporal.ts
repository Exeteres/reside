import { waitForResult } from "@reside/api"
import { Client, Connection } from "@temporalio/client"
import { NativeConnection, Worker } from "@temporalio/worker"
import { createAuthInterceptor, getTokenForAudience } from "../kubernetes"
import { logger } from "../logger"
import type { CommonServices } from "../services"
import { registerGracefulShutdown } from "../utils"

export const DEFAULT_TEMPORAL_TASK_QUEUE = "default"

type TemporalCredentialsServices = Pick<
  CommonServices<"infra">,
  "provisionService" | "infraOperationService"
>

/**
 * Creates a Temporal client authorized for Replica's individual Temporal namespace.
 */
export async function createTemporalClient(services: TemporalCredentialsServices): Promise<Client> {
  try {
    const credentials = await getTemporalCredentials(services)

    const connection = await Connection.connect({
      address: credentials.address,
      interceptors: [createAuthInterceptor(credentials.address)],
    })

    await connection.ensureConnected()

    return new Client({
      connection,
      namespace: credentials.namespace,
    })
  } catch (error) {
    throw new Error("Failed to create Temporal client", { cause: error })
  }
}

export type WorkerOptions = {
  /**
   * The services needed to setup the Temporal worker.
   */
  services: CommonServices<"infra">

  /**
   * The full path to JavaScript workflow bundle code that the worker should load.
   *
   * Defaults to /app/workflows.js in runtime images.
   */
  workflowsCodePath?: string

  /**
   * The task queue that the worker should listen to for tasks.
   *
   * If not provided, defaults to the "default" task queue within the Temporal namespace assigned to the Replica.
   */
  taskQueue?: string

  /**
   * The activities to be registered with the worker.
   */
  activities?: Record<string, (...args: never[]) => Promise<unknown>>

  /**
   * Creates activities after the worker connection has been established.
   *
   * This is useful when activity dependencies need the connected workflow service.
   */
  createActivities?: (args: {
    connection: NativeConnection
  }) =>
    | Record<string, (...args: never[]) => Promise<unknown>>
    | Promise<Record<string, (...args: never[]) => Promise<unknown>>>
}

/**
 * Creates a Temporal worker for the given workflows and activities,
 * authorized for Replica's individual Temporal namespace.
 */
async function createTemporalWorker(options: WorkerOptions): Promise<Worker> {
  try {
    const credentials = await getTemporalCredentials(options.services)

    const getMetadata = (token: string) => {
      return {
        authorization: `Bearer ${token}`,
      }
    }

    const initialToken = await getTokenForAudience(credentials.address)

    const connection = await NativeConnection.connect({
      address: credentials.address,
    })

    connection.withMetadata(getMetadata(initialToken), async () =>
      getMetadata(await getTokenForAudience(credentials.address)),
    )

    await connection.ensureConnected()

    const activities = options.createActivities
      ? await options.createActivities({ connection })
      : options.activities

    return await Worker.create({
      connection,
      namespace: credentials.namespace,
      taskQueue: options.taskQueue ?? DEFAULT_TEMPORAL_TASK_QUEUE,
      workflowBundle: {
        codePath: options.workflowsCodePath ?? "/app/workflows.js",
      },
      activities,
    })
  } catch (error) {
    throw new Error("Failed to create Temporal worker", { cause: error })
  }
}

/**
 * Starts a Temporal worker and keeps it running until the process is terminated.
 * The worker will be gracefully shut down when the process receives a termination signal.
 *
 * @param options The worker options, including database options and worker configuration.
 */
export async function startTemporalWorker(options: WorkerOptions): Promise<void> {
  const worker = await createTemporalWorker(options)

  registerGracefulShutdown(async () => {
    try {
      worker.shutdown()
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Not running. Current state: INITIALIZED")
      ) {
        return
      }

      throw error
    }
  })

  void worker.run().catch(error => logger.error({ error }, "temporal worker failed with error"))
}

async function getTemporalCredentials(services: TemporalCredentialsServices) {
  const response = await services.provisionService.getTemporalNamespaceCredentials({})
  if (!response.credentials) {
    throw new Error("Server did not return Temporal namespace credentials")
  }
  if (response.credentials.case === undefined) {
    throw new Error("Server returned empty Temporal namespace credentials response")
  }

  const credentials = await waitForResult(response.credentials, services.infraOperationService)
  if (!credentials) {
    throw new Error("Server did not return resolved Temporal namespace credentials")
  }

  return credentials
}
