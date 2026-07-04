import type { StorageBucketService } from "../database"
import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3"
import { restoreSessionArchive, uploadSessionArchive } from "./engine"

describe("nls session archive storage", () => {
  test("skips empty session state archives", async () => {
    await withTempArchiveStore(async ({ service, root }) => {
      await mkdir(join(root, "state", "session-state", "ses_empty"), { recursive: true })

      const uploaded = await uploadSessionArchive(
        service,
        join(root, "state"),
        "sessions",
        "storage-empty",
        "ses_empty",
      )

      expect(uploaded).toBe(false)
      expect(await service.hasObject("nls/sessions/storage-empty.tgz")).toBe(false)
    })
  })

  test("uploads and restores opencode session state", async () => {
    await withTempArchiveStore(async ({ service, root }) => {
      const sourceState = join(root, "source", "session-state", "ses_demo")
      const restoredState = join(root, "restored")
      await mkdir(join(sourceState, "storage", "session"), { recursive: true })
      await writeFile(join(sourceState, "storage", "session", "data.json"), '{"ok":true}')

      const uploaded = await uploadSessionArchive(
        service,
        join(root, "source"),
        "sessions",
        "storage-demo",
        "ses_demo",
      )

      expect(uploaded).toBe(true)

      const restoredSessionId = await restoreSessionArchive(
        service,
        restoredState,
        "sessions",
        "storage-demo",
      )

      expect(restoredSessionId).toBe("ses_demo")
      await expect(
        readFile(
          join(restoredState, "session-state", "ses_demo", "storage", "session", "data.json"),
          "utf8",
        ),
      ).resolves.toBe('{"ok":true}')
    })
  })
})

type TempArchiveStore = {
  root: string
  service: StorageBucketService & {
    hasObject: (key: string) => Promise<boolean>
  }
}

async function withTempArchiveStore(testBody: (store: TempArchiveStore) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "reside-nls-archive-"))

  try {
    await testBody({
      root,
      service: createTempStorageBucketService(root),
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function createTempStorageBucketService(root: string): TempArchiveStore["service"] {
  return {
    bucket: "test",
    client: {
      send: async (command: unknown): Promise<unknown> => {
        if (command instanceof PutObjectCommand) {
          const input = command.input
          const objectPath = join(root, String(input.Key))
          await mkdir(dirname(objectPath), { recursive: true })
          await writeFile(objectPath, input.Body as Buffer)
          return {}
        }

        if (command instanceof GetObjectCommand) {
          const input = command.input
          const bytes = await readFile(join(root, String(input.Key)))
          return {
            Body: {
              transformToByteArray: async () => bytes,
            },
          }
        }

        if (command instanceof DeleteObjectCommand) {
          const input = command.input
          await rm(join(root, String(input.Key)), { force: true })
          return {}
        }

        throw new Error("Unsupported command")
      },
    } as unknown as S3Client,
    hasObject: async (key: string) => {
      try {
        await readFile(join(root, key))
        return true
      } catch {
        return false
      }
    },
  }
}
