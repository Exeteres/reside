import type { CustomObjectsApi } from "@kubernetes/client-node"
import type { KnativeService } from "./types"
import { logger } from "../logger"
import {
  extractAnnotations,
  extractResourceVersion,
  isAlreadyExistsError,
  isNotFoundError,
} from "./shared"

export async function ensureKnativeService(
  customObjectsApi: CustomObjectsApi,
  service: KnativeService,
): Promise<void> {
  const group = "serving.knative.dev"
  const version = "v1"
  const plural = "services"

  let resourceVersion: string | undefined
  let annotations: Record<string, string> | undefined

  try {
    const existing: unknown = await customObjectsApi.getNamespacedCustomObject({
      group,
      version,
      namespace: service.metadata.namespace,
      plural,
      name: service.metadata.name,
    })

    resourceVersion = extractResourceVersion(existing)
    annotations = extractAnnotations(existing)
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error
    }
  }

  if (!resourceVersion) {
    try {
      await customObjectsApi.createNamespacedCustomObject({
        group,
        version,
        namespace: service.metadata.namespace,
        plural,
        body: service,
      })

      logger.info(
        'created knative service "%s" in namespace "%s"',
        service.metadata.name,
        service.metadata.namespace,
      )
      return
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error
      }
    }
  }

  await customObjectsApi.replaceNamespacedCustomObject({
    group,
    version,
    namespace: service.metadata.namespace,
    plural,
    name: service.metadata.name,
    body: {
      ...service,
      metadata: {
        ...service.metadata,
        annotations: {
          ...(annotations ?? {}),
          ...(service.metadata.annotations ?? {}),
        },
        resourceVersion,
      },
    },
  })

  logger.info(
    'updated knative service "%s" in namespace "%s"',
    service.metadata.name,
    service.metadata.namespace,
  )
}
