import { z } from "zod"

const replicaSchema = z.object({
  metadata: z.object({
    name: z.string().min(1),
    generation: z.number().int().nonnegative().optional().default(0),
  }),
  spec: z.object({
    image: z.string().min(1),
    endpoints: z.record(z.string(), z.string()).optional().default({}),
  }),
})

const customObjectListSchema = z.object({
  items: z.array(z.unknown()),
})

export type Replica = {
  name: string
  generation: number
  image: string
  endpoints: Record<string, string>
}

export function parseReplicaListResponse(listResponse: unknown): unknown[] {
  const parsedResponse = customObjectListSchema.safeParse(listResponse)
  if (!parsedResponse.success) {
    return []
  }

  return parsedResponse.data.items
}

export function parseReplica(value: unknown): Replica | undefined {
  const parsedReplica = replicaSchema.safeParse(value)
  if (!parsedReplica.success) {
    return undefined
  }

  return {
    name: parsedReplica.data.metadata.name,
    generation: parsedReplica.data.metadata.generation,
    image: parsedReplica.data.spec.image,
    endpoints: parsedReplica.data.spec.endpoints,
  }
}
