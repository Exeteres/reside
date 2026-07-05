import type {
  GetStorageBucketCredentialsResponse,
  StorageBucketCredentials,
} from "@reside/api/infra/provision.v1"
import type { CommonServices } from "../services"
import { S3Client } from "@aws-sdk/client-s3"
import { waitForResult } from "@reside/api"
import { logger } from "../logger"

type StorageBucketCredentialsServices = Pick<
  CommonServices<"infra">,
  "provisionService" | "infraOperationService"
>

export type StorageBucketService = {
  client: S3Client
  bucket: string
}

export type CreateStorageBucketServiceOptions = {
  operationWaitTimeoutMs?: number
}

/**
 * Creates a configured AWS S3 client service for the replica storage bucket.
 *
 * It resolves provisioning operations automatically when the infra API returns an operation instead of direct credentials.
 */
export async function createStorageBucketService(
  services: StorageBucketCredentialsServices,
  options: CreateStorageBucketServiceOptions = {},
): Promise<StorageBucketService> {
  const credentials = await getStorageBucketCredentials(services, options)

  logger.info(
    'received storage bucket credentials endpoint="%s" bucket="%s"',
    credentials.endpoint,
    credentials.bucket,
  )

  return {
    client: new S3Client({
      endpoint: credentials.endpoint,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: credentials.accessKey,
        secretAccessKey: credentials.secretKey,
      },
    }),
    bucket: credentials.bucket,
  }
}

async function getStorageBucketCredentials(
  services: StorageBucketCredentialsServices,
  options: CreateStorageBucketServiceOptions,
): Promise<StorageBucketCredentials> {
  logger.info("requesting storage bucket credentials from infra provision service")

  const response: GetStorageBucketCredentialsResponse =
    await services.provisionService.getStorageBucketCredentials({})

  const credentials = response.credentials
  if (!credentials || credentials.case === undefined) {
    throw new Error("Server returned empty storage bucket credentials response")
  }

  const waitOptions = {
    operationService: services.infraOperationService,
    ...(options.operationWaitTimeoutMs === undefined
      ? {}
      : { timeout: options.operationWaitTimeoutMs }),
  }

  return await waitForResult(credentials, {
    ...waitOptions,
  })
}
