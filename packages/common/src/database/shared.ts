import type { OperationServiceClient } from "@reside/api/common/operation.v1"
import type { ProvisionServiceClient } from "@reside/api/database/provision.v1"

export type DatabaseOptions = {
  /**
   * The database provision service to use for fetching connection details for individual databases.
   */
  provisionService: ProvisionServiceClient

  /**
   * The operation service to use for polling the status of provisioning operations when waiting for database credentials to become available.
   */
  operationService: OperationServiceClient
}
