import type { PrismaClient } from "../../database"
import { CustomObjectsApi } from "@kubernetes/client-node"
import { kubeConfig, logger, registerGracefulShutdown } from "@reside/common"
import {
  isNotFoundError,
  REPLICA_API_GROUP,
  REPLICA_API_VERSION,
  REPLICA_PLURAL,
} from "../../shared/replica-crd"

const RECONCILE_INTERVAL_MS = 5_000

export function setupReplicaCrdReconciliation(prisma: PrismaClient): void {
  const customObjectsApi = kubeConfig.makeApiClient(CustomObjectsApi)
  let stopped = false

  let loopPromise: Promise<void> | undefined

  const runLoop = async (): Promise<void> => {
    while (!stopped) {
      try {
        await reconcileReplicaCrds(prisma, customObjectsApi)
      } catch (error) {
        if (stopped) {
          break
        }

        logger.error({ error }, "failed to reconcile replica CRDs")
      }

      if (stopped) {
        break
      }

      await Bun.sleep(RECONCILE_INTERVAL_MS)
    }
  }

  loopPromise = runLoop()

  registerGracefulShutdown(async () => {
    stopped = true

    if (loopPromise) {
      await loopPromise
    }
  })

  void loopPromise
}

async function reconcileReplicaCrds(
  prisma: PrismaClient,
  customObjectsApi: CustomObjectsApi,
): Promise<void> {
  const replicas = await prisma.replica.findMany({
    where: {
      image: {
        not: null,
      },
    },
    select: {
      name: true,
      image: true,
    },
  })

  for (const replica of replicas) {
    const image = replica.image
    if (image === null) {
      continue
    }

    await upsertReplicaCrd(customObjectsApi, {
      name: replica.name,
      image,
    })
  }
}

async function upsertReplicaCrd(
  customObjectsApi: CustomObjectsApi,
  args: {
    name: string
    image: string
  },
): Promise<void> {
  const spec = {
    image: args.image,
  }

  try {
    await customObjectsApi.patchClusterCustomObject({
      group: REPLICA_API_GROUP,
      version: REPLICA_API_VERSION,
      plural: REPLICA_PLURAL,
      name: args.name,
      body: [{ op: "add", path: "/spec", value: spec }],
    })

    return
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error
    }
  }

  await customObjectsApi.createClusterCustomObject({
    group: REPLICA_API_GROUP,
    version: REPLICA_API_VERSION,
    plural: REPLICA_PLURAL,
    body: {
      apiVersion: `${REPLICA_API_GROUP}/${REPLICA_API_VERSION}`,
      kind: "Replica",
      metadata: {
        name: args.name,
      },
      spec,
    },
  })
}
