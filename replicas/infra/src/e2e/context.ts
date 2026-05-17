import { AppsV1Api, CoreV1Api, CustomObjectsApi } from "@kubernetes/client-node"
import { getReplicaName, getReplicaNamespace, kubeConfig } from "@reside/common"

export type DatabaseE2EContext = {
  namespace: string
  replicaName: string
  appsApi: AppsV1Api
  coreApi: CoreV1Api
  customObjectsApi: CustomObjectsApi
}

/**
 * Creates the shared database e2e context.
 *
 * @returns The initialized database e2e context.
 */
export async function createDatabaseE2EContext(): Promise<DatabaseE2EContext> {
  const namespace = getReplicaNamespace()

  return {
    namespace,
    replicaName: getReplicaName(),
    appsApi: kubeConfig.makeApiClient(AppsV1Api),
    coreApi: kubeConfig.makeApiClient(CoreV1Api),
    customObjectsApi: kubeConfig.makeApiClient(CustomObjectsApi),
  }
}
