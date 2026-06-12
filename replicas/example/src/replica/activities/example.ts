import type { ExampleActivities } from "../../definitions"
import type { ExampleServices } from "../../shared"
import { crypto } from "@reside/common"
import { createExampleNote } from "../business"

type ExampleActivityServices = Pick<ExampleServices, "prisma" | "storage">

export function createExampleActivities({
  prisma,
  storage,
}: ExampleActivityServices): ExampleActivities {
  return {
    async createExampleNote(input) {
      const note = await createExampleNote(crypto, prisma, storage, input)

      return {
        noteId: note.noteId,
      }
    },
  }
}
