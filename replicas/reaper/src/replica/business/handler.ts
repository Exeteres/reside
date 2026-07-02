import type { PrismaClient, ReaperHandler } from "../../database"
import { Code, ConnectError } from "@connectrpc/connect"

type ReaperHandlerPrisma = Pick<PrismaClient, "reaperHandler">

export type ReaperHandlerUpsertRequest = {
  resourceReplicaName: string
  title: string
  callbackEndpoint: string
}

export async function putReaperHandlers(
  prisma: ReaperHandlerPrisma,
  handlers: ReaperHandlerUpsertRequest[],
): Promise<ReaperHandler[]> {
  validateUniqueResourceReplicaNames(handlers)

  return await Promise.all(
    handlers.map(async handler => {
      const resourceReplicaName = normalizeReplicaName(handler.resourceReplicaName)
      const title = normalizeRequiredText(handler.title, "title")
      const callbackEndpoint = normalizeRequiredText(handler.callbackEndpoint, "callbackEndpoint")

      return await prisma.reaperHandler.upsert({
        where: {
          resourceReplicaName,
        },
        create: {
          resourceReplicaName,
          title,
          callbackEndpoint,
        },
        update: {
          title,
          callbackEndpoint,
        },
      })
    }),
  )
}

export async function listReaperHandlers(prisma: ReaperHandlerPrisma): Promise<ReaperHandler[]> {
  return await prisma.reaperHandler.findMany({
    orderBy: [{ resourceReplicaName: "asc" }],
  })
}

function validateUniqueResourceReplicaNames(handlers: ReaperHandlerUpsertRequest[]): void {
  const names = new Set<string>()
  for (const handler of handlers) {
    const name = normalizeReplicaName(handler.resourceReplicaName)
    if (names.has(name)) {
      throw new ConnectError(`Duplicate reaper handler "${name}"`, Code.InvalidArgument)
    }

    names.add(name)
  }
}

function normalizeReplicaName(replicaName: string): string {
  const normalizedReplicaName = replicaName.trim()
  if (/^[a-z][a-z0-9-]*$/.test(normalizedReplicaName)) {
    return normalizedReplicaName
  }

  throw new ConnectError("Resource replica name is invalid", Code.InvalidArgument)
}

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalizedValue = value.trim()
  if (normalizedValue.length > 0) {
    return normalizedValue
  }

  throw new ConnectError(`Field "${fieldName}" is required`, Code.InvalidArgument)
}
