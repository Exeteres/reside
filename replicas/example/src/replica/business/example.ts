import type { ResideCrypto, StorageBucketService } from "@reside/common"
import type { PrismaClient } from "../../database"
import { randomUUID } from "node:crypto"
import { PutObjectCommand } from "@aws-sdk/client-s3"

type ExamplePrisma = Pick<PrismaClient, "exampleNote">

export type CreateExampleNoteInput = {
  title: string
  content: string
  source: string
}

export type CreateExampleNoteResult = {
  noteId: string
  objectKey: string
}

export type ExampleStatus = {
  noteCount: number
  storageConfigured: boolean
}

export async function createExampleNote(
  crypto: ResideCrypto,
  prisma: ExamplePrisma,
  storage: StorageBucketService,
  input: CreateExampleNoteInput,
): Promise<CreateExampleNoteResult> {
  const contentEcid = await crypto.encrypt({ content: input.content })
  const objectKey = `examples/${randomUUID()}.json`

  await storage.client.send(
    new PutObjectCommand({
      Bucket: storage.bucket,
      Key: objectKey,
      Body: JSON.stringify({ title: input.title, contentEcid }),
      ContentType: "application/json",
    }),
  )

  const note = await prisma.exampleNote.create({
    data: {
      title: input.title,
      source: input.source,
      contentEcid,
      objectKey,
    },
    select: {
      id: true,
    },
  })

  return {
    noteId: note.id,
    objectKey,
  }
}

export async function getExampleStatus(
  prisma: ExamplePrisma,
  storage: Pick<StorageBucketService, "bucket">,
): Promise<ExampleStatus> {
  const noteCount = await prisma.exampleNote.count()

  return {
    noteCount,
    storageConfigured: storage.bucket.length > 0,
  }
}
