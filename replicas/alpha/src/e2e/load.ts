import type { CustomObjectsApi } from "@kubernetes/client-node"
import type { PermissionRequestServiceClient } from "@reside/api/access/request.v1"
import type { LoadServiceClient } from "@reside/api/alpha/load.v1"
import type { OperationServiceClient } from "@reside/api/common/operation.v1"
import type { PrismaClient } from "../database"
import type { AlphaE2EScope } from "./scope"
import { waitForOperationSuccess } from "@reside/api"
import { logger, WellKnownPermissions } from "@reside/common"
import {
  isNotFoundError,
  REPLICA_API_GROUP,
  REPLICA_API_VERSION,
  REPLICA_PLURAL,
} from "../shared/replica-crd"

const REPLICA_CRD_WAIT_TIMEOUT_MS = 30_000
const REPLICA_CRD_WAIT_INTERVAL_MS = 1_000

export async function assertLoadApi(
  loadService: LoadServiceClient,
  accessRequestService: PermissionRequestServiceClient,
  accessOperationService: OperationServiceClient,
  prisma: PrismaClient,
  customObjectsApi: CustomObjectsApi,
  scope: AlphaE2EScope,
): Promise<void> {
  await deleteReplicaCrd(customObjectsApi, scope.loadReplicaName)

  try {
    const { operation } = await accessRequestService.requestPermissions({
      reason: "Для выполнения e2e проверки загрузки реплики",
      permissionSetName: scope.loadPermissionSetName,
      items: [
        {
          permissionName: WellKnownPermissions.ALPHA_REPLICA_LOAD,
          scope: scope.loadReplicaName,
        },
      ],
    })

    if (operation !== undefined) {
      await waitForOperationSuccess(operation, {
        operationService: accessOperationService,
      })
    }

    await loadService.loadReplica({
      name: scope.loadReplicaName,
      image: scope.loadReplicaImage,
    })

    await waitForReplicaCrdImage(customObjectsApi, scope.loadReplicaName, scope.loadReplicaImage)

    try {
      await prisma.replica.delete({
        where: {
          name: scope.loadReplicaName,
        },
      })
    } catch (error) {
      logger.warn({ error }, "failed to cleanup load e2e replica record")
    }

    await deleteReplicaCrd(customObjectsApi, scope.loadReplicaName)

    logger.info("load api e2e checks passed")
  } finally {
    await deleteReplicaCrd(customObjectsApi, scope.loadReplicaName)
  }
}

async function waitForReplicaCrdImage(
  customObjectsApi: CustomObjectsApi,
  replicaName: string,
  expectedImage: string,
): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < REPLICA_CRD_WAIT_TIMEOUT_MS) {
    try {
      const response = await customObjectsApi.getClusterCustomObject({
        group: REPLICA_API_GROUP,
        version: REPLICA_API_VERSION,
        plural: REPLICA_PLURAL,
        name: replicaName,
      })

      const body = Reflect.get(response, "body") ?? response
      const spec = Reflect.get(body as object, "spec")
      const image = Reflect.get(spec as object, "image")
      if (image === expectedImage) {
        return
      }
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error
      }
    }

    await Bun.sleep(REPLICA_CRD_WAIT_INTERVAL_MS)
  }

  throw new Error(`Replica CRD "${replicaName}" was not created with expected image`)
}

async function deleteReplicaCrd(
  customObjectsApi: CustomObjectsApi,
  replicaName: string,
): Promise<void> {
  try {
    await customObjectsApi.deleteClusterCustomObject({
      group: REPLICA_API_GROUP,
      version: REPLICA_API_VERSION,
      plural: REPLICA_PLURAL,
      name: replicaName,
    })
  } catch (error) {
    if (isNotFoundError(error)) {
      return
    }

    throw error
  }
}
