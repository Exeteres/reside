import type { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import type { StorageBucketService } from "@reside/common"
import { randomUUID } from "node:crypto"
import {
  GetObjectCommand as GetS3ObjectCommand,
  PutObjectCommand as PutS3ObjectCommand,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

const PRESIGNED_IMAGE_URL_EXPIRES_IN_SECONDS = 60 * 60

export type GenerateImageInput = {
  prompt: string
  size: string
}

export type GeneratedImage = {
  bytes: Uint8Array
  contentType: string
}

export type GenerateImage = (input: GenerateImageInput) => Promise<GeneratedImage>

export type CreateAiImageResult = {
  objectKey: string
  url: string
}

export type CreateImageUrl = (objectKey: string) => Promise<string>

export type AiStatus = {
  storageConfigured: boolean
}

export async function createAiImage(
  generateImage: GenerateImage,
  storage: StorageBucketService,
  input: GenerateImageInput,
  createImageUrl: CreateImageUrl = objectKey =>
    createPresignedImageUrl(storage.client, storage.bucket, objectKey),
): Promise<CreateAiImageResult> {
  const prompt = input.prompt.trim()
  if (prompt.length === 0) {
    throw new Error("Image prompt must not be empty")
  }

  const size = input.size.trim()
  if (size.length === 0) {
    throw new Error("Image size must not be empty")
  }

  const image = await generateImage({ prompt, size })
  const objectKey = `images/${randomUUID()}.png`

  await storage.client.send(
    new PutS3ObjectCommand({
      Bucket: storage.bucket,
      Key: objectKey,
      Body: Buffer.from(image.bytes),
      ContentType: image.contentType,
    }),
  )

  return {
    objectKey,
    url: await createImageUrl(objectKey),
  }
}

export function getAiStatus(storage: Pick<StorageBucketService, "bucket">): AiStatus {
  return {
    storageConfigured: storage.bucket.length > 0,
  }
}

function createPresignedImageUrl(
  client: StorageBucketService["client"],
  bucket: string,
  objectKey: string,
): Promise<string> {
  const presignClient = client as unknown as Parameters<typeof getSignedUrl>[0]

  return getSignedUrl(
    presignClient,
    new GetS3ObjectCommand({
      Bucket: bucket,
      Key: objectKey,
    }) as unknown as Parameters<typeof getSignedUrl>[1],
    {
      expiresIn: PRESIGNED_IMAGE_URL_EXPIRES_IN_SECONDS,
    },
  )
}

export type S3WriteCommand = PutObjectCommand
export type S3ReadCommand = GetObjectCommand
