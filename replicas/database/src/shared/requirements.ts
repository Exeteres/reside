import type { DatabaseOptions } from "@reside/common"
import { getReplicaNamespace } from "@reside/common"
import { TEMPORAL_FRONTEND_PORT, TEMPORAL_FRONTEND_SERVICE_NAME } from "./temporal/constants"

/**
 * Creates helper options for the database replica runtime.
 *
 * The database replica bootstraps its own Temporal namespace ahead of time,
 * so the runtime can use the ready credentials directly.
 *
 * @returns Database helper options for the current replica.
 */
export function createReplicaDatabaseOptions(): DatabaseOptions {
  return {
    provisionService: {
      async getPostgresDatabaseCredentials() {
        throw new Error("Database replica does not use provisioned PostgreSQL helper credentials")
      },

      async getTemporalNamespaceCredentials() {
        return {
          credentials: {
            $case: "result",
            value: {
              address: `${TEMPORAL_FRONTEND_SERVICE_NAME}.${getReplicaNamespace()}.svc.cluster.local:${TEMPORAL_FRONTEND_PORT}`,
              namespace: getReplicaNamespace(),
            },
          },
        }
      },
    },
    operationService: {
      async getOperation() {
        throw new Error("Database replica does not use provisioning operation polling here")
      },

      async subscribeToOperationCompletion() {
        throw new Error("Database replica does not use operation completion subscriptions here")
      },

      async cancelOperation() {
        throw new Error("Database replica does not use operation cancellation here")
      },
    },
  }
}
