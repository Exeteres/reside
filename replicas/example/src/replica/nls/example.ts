import type { ExampleServices } from "../../shared"
import { defineTool } from "@reside/common"
import { z } from "zod"
import { getExampleStatus } from "../business"

type ExampleToolServices = Pick<ExampleServices, "prisma" | "storage">

export function createExampleTools({ prisma, storage }: ExampleToolServices) {
  return [
    defineTool("reside_get_example_status", {
      description: "Gets non-sensitive example replica status and storage configuration.",
      parameters: z.object({}),
      handler: async () => {
        const status = await getExampleStatus(prisma, storage)

        return {
          ...status,
          response: `Example replica has ${status.noteCount} note(s).`,
        }
      },
    }),
  ]
}
