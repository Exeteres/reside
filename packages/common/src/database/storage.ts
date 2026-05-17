import { S3Client } from "@aws-sdk/client-s3"
import { waitForResult } from "@reside/api"
import type {
  GetStorageBucketCredentialsResponse,
  StorageBucketCredentials,
} from "@reside/api/infra/provision.v1"
import { logger } from "../logger"
import type { CommonServices } from "../services"

type StorageBucketCredentialsServices = Pick<
  CommonServices<"infra">,
  "provisionService" | "infraOperationService"
>

export type StorageBucketService = {
  client: S3Client
  bucket: string
}

/**
 * Creates a configured AWS S3 client service for the replica storage bucket.
 *
 * It resolves provisioning operations automatically when the infra API returns an operation instead of direct credentials.
 */
export async function createStorageBucketService(
  services: StorageBucketCredentialsServices,
): Promise<StorageBucketService> {
  const credentials = await getStorageBucketCredentials(services)

  logger.info(
    'received storage bucket credentials endpoint="%s" bucket="%s"',
    credentials.endpoint,
    credentials.bucket,
  )

  return {
    client: new S3Client({
      endpoint: `http://${credentials.endpoint}`,
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
): Promise<StorageBucketCredentials> {
  logger.info("requesting storage bucket credentials from infra provision service")

  const response: GetStorageBucketCredentialsResponse =
    await services.provisionService.getStorageBucketCredentials({})

  const credentials = response.credentials
  if (!credentials || credentials.case === undefined) {
    throw new Error("Server returned empty storage bucket credentials response")
  }

  return await waitForResult(credentials, {
    operationService: services.infraOperationService,
  })
}
