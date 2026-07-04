import { z } from "zod"
import { defineTool, type SessionConfig } from "./tool"

const MEMORY_SEARCH_LIMIT = 10
const MEMORY_SEARCH_WORD_LIMIT = 12
const MEMORY_NOTE_TITLE_MAX_LENGTH = 20
const MEMORY_NOTE_TITLE_MAX_WORDS = 5
const MEMORY_NOTE_DESCRIPTION_MAX_LENGTH = 80
const MEMORY_TAG_MAX_LENGTH = 20
const MEMORY_TAG_PATTERN = /^[a-z][a-z0-9-]*$/
const MEMORY_SEARCH_WORD_PATTERN = /[\p{L}\p{N}]{2,}/gu

const memoryNoteTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(MEMORY_NOTE_TITLE_MAX_LENGTH)
  .refine(value => value.split(/\s+/).filter(Boolean).length <= MEMORY_NOTE_TITLE_MAX_WORDS, {
    message: `Title must be a few words (max ${MEMORY_NOTE_TITLE_MAX_WORDS} words)`,
  })
const memoryNoteDescriptionSchema = z.string().trim().min(1).max(MEMORY_NOTE_DESCRIPTION_MAX_LENGTH)
const memoryTagSchema = z
  .string()
  .trim()
  .min(1)
  .max(MEMORY_TAG_MAX_LENGTH)
  .regex(MEMORY_TAG_PATTERN, {
    message:
      "Tag must start with a lowercase english letter and contain only lowercase letters, digits, or dashes",
  })
const memoryTagListSchema = z.array(memoryTagSchema)

const languageMemorySystemPromptBase = [
  "Memory workflow:",
  "- use a short descriptive title (few words, max 20 chars); title does not need to be unique.",
  "- keep description concise (max 80 chars) and content factual.",
  "- write note title, description, and content in the same language as the user interaction that produced the note.",
  "- do not include the current timestamp in content; creation and update timestamps are stored automatically.",
  "- before adding new memory, search existing notes by passing separate important words to reside_find_notes and reuse/update when possible.",
  "- keep notes compact and practical: clear title, concise description, factual content.",
  "- read full note content before making decisions based on a note summary.",
  "- update stale notes when facts change; remove notes that are no longer useful.",
  "- after each interaction, do a quick memory housekeeping pass before returning the final response, but only when facts changed.",
]

export type MemoryToolTagDefinitions = Record<string, { description: string }>

export const languageMemorySystemPrompt = languageMemorySystemPromptBase.join("\n")

export function createLanguageMemorySystemPrompt(tags?: MemoryToolTagDefinitions): string {
  const lines = [...languageMemorySystemPromptBase]

  if (!tags || Object.keys(tags).length === 0) {
    lines.push("- do not use memory tags when creating or updating notes.")
    return lines.join("\n")
  }

  lines.push("- use only allowed memory tags listed below.")
  lines.push("Allowed memory tags:")

  const sortedEntries = Object.entries(tags).sort(([left], [right]) => left.localeCompare(right))
  for (const [tag, definition] of sortedEntries) {
    lines.push(`- ${tag}: ${definition.description.trim()}`)
  }

  return lines.join("\n")
}

type MemoryNotePreview = {
  id: number
  title: string
  description: string
  tags: string[]
  createdAt: Date
  updatedAt: Date
}

type MemoryNoteContent = {
  content: string
}

type MemoryNoteId = {
  id: number
}

export type MemorySearchWords = {
  words: string[]
  anyTermQuery: string
  likePatterns: string[]
}

type MemoryNoteUpdateData = {
  title?: string
  description?: string
  content?: string
  tags?: string[]
}

export type MemoryToolsPrisma = {
  $queryRaw: <T = unknown>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T>
  memoryNote: {
    findUnique: (args: {
      where: { id: number }
      select: { content: true }
    }) => Promise<MemoryNoteContent | null>
    create: (args: {
      data: { title: string; description: string; content: string; tags: string[] }
      select: { id: true }
    }) => Promise<MemoryNoteId>
    update: (args: {
      where: { id: number }
      data: MemoryNoteUpdateData
      select: { id: true }
    }) => Promise<MemoryNoteId>
    delete: (args: { where: { id: number }; select: { id: true } }) => Promise<MemoryNoteId>
  }
}

export type MemoryToolServices = {
  prisma: MemoryToolsPrisma
  tags?: MemoryToolTagDefinitions
}

const findNotesParametersSchema = z.object({
  words: z.array(z.string().trim().min(1)).min(1).max(MEMORY_SEARCH_WORD_LIMIT),
  tags: memoryTagListSchema.optional(),
})

const getNoteContentParametersSchema = z.object({
  id: z.number().int().positive(),
})

const createNoteParametersSchema = z.object({
  title: memoryNoteTitleSchema,
  description: memoryNoteDescriptionSchema,
  content: z.string().min(1),
  tags: memoryTagListSchema.optional(),
})

const updateNoteParametersSchema = z
  .object({
    id: z.number().int().positive(),
    title: memoryNoteTitleSchema.optional(),
    description: memoryNoteDescriptionSchema.optional(),
    content: z.string().min(1).optional(),
    tags: memoryTagListSchema.optional(),
  })
  .refine(
    input =>
      input.title !== undefined ||
      input.description !== undefined ||
      input.content !== undefined ||
      input.tags !== undefined,
    {
      message: "At least one of title, description, content, or tags must be specified",
      path: ["title"],
    },
  )

const deleteNoteParametersSchema = z.object({
  id: z.number().int().positive(),
})

export function createMemoryTools({
  prisma,
  tags,
}: MemoryToolServices): NonNullable<SessionConfig["tools"]> {
  const allowedTags = tags ? new Set(Object.keys(tags)) : undefined

  return [
    defineTool("reside_find_notes", {
      description:
        "Finds memory notes containing any of the provided important words. Pass separate meaningful words from the request; do not build a search query or full sentence.",
      parameters: findNotesParametersSchema,
      handler: async ({ words, tags }) => {
        const searchWords = createMemorySearchWords(words)
        const normalizedTags = normalizeTags(tags, allowedTags)
        if (searchWords.words.length === 0) {
          return {
            notes: [] as MemoryNotePreview[],
          }
        }

        const notes = await prisma.$queryRaw<MemoryNotePreview[]>`
          SELECT
            m.id,
            m.title,
            m.description,
            m.tags,
            m."createdAt",
            m."updatedAt"
          FROM "MemoryNote" AS m
          WHERE
            (
              setweight(to_tsvector('simple', coalesce(m.title, '')), 'A') ||
              setweight(to_tsvector('simple', coalesce(m.description, '')), 'B') ||
              setweight(to_tsvector('simple', coalesce(m.content, '')), 'C')
              @@ to_tsquery('simple', ${searchWords.anyTermQuery})
              OR EXISTS (
                SELECT 1
                FROM unnest(${searchWords.likePatterns}::text[]) AS pattern(value)
                WHERE lower(concat_ws(' ', m.title, m.description, m.content)) LIKE pattern.value ESCAPE '\'
              )
            )
            AND (
              COALESCE(array_length(${normalizedTags}::text[], 1), 0) = 0
              OR m.tags && ${normalizedTags}::text[]
            )
          ORDER BY
            ts_rank_cd(
              setweight(to_tsvector('simple', coalesce(m.title, '')), 'A') ||
              setweight(to_tsvector('simple', coalesce(m.description, '')), 'B') ||
              setweight(to_tsvector('simple', coalesce(m.content, '')), 'C'),
              to_tsquery('simple', ${searchWords.anyTermQuery})
            ) DESC,
            (
              SELECT count(*)
              FROM unnest(${searchWords.likePatterns}::text[]) AS pattern(value)
              WHERE lower(concat_ws(' ', m.title, m.description, m.content)) LIKE pattern.value ESCAPE '\'
            ) DESC,
            m.id DESC
          LIMIT ${MEMORY_SEARCH_LIMIT}
        `

        return {
          notes,
        }
      },
    }),
    defineTool("reside_get_note_content", {
      description: "Returns full content for a note by id.",
      parameters: getNoteContentParametersSchema,
      handler: async ({ id }) => {
        const note = await prisma.memoryNote.findUnique({
          where: { id },
          select: { content: true },
        })

        if (!note) {
          throw new Error(`Memory note "${id}" is not found`)
        }

        return {
          content: note.content,
        }
      },
    }),
    defineTool("reside_create_note", {
      description: "Creates a new memory note.",
      parameters: createNoteParametersSchema,
      handler: async ({ title, description, content, tags }) => {
        const normalizedTags = normalizeTags(tags, allowedTags)

        const note = await prisma.memoryNote.create({
          data: {
            title: title.trim(),
            description: description.trim(),
            content: content.trim(),
            tags: normalizedTags,
          },
          select: {
            id: true,
          },
        })

        return {
          id: note.id,
        }
      },
    }),
    defineTool("reside_update_note", {
      description: "Updates one or more text fields of a memory note.",
      parameters: updateNoteParametersSchema,
      handler: async ({ id, title, description, content, tags }) => {
        const data: MemoryNoteUpdateData = {}

        if (title !== undefined) {
          data.title = title.trim()
        }

        if (description !== undefined) {
          data.description = description.trim()
        }

        if (content !== undefined) {
          data.content = content.trim()
        }

        if (tags !== undefined) {
          data.tags = normalizeTags(tags, allowedTags)
        }

        const note = await prisma.memoryNote.update({
          where: { id },
          data,
          select: { id: true },
        })

        return {
          id: note.id,
        }
      },
    }),
    defineTool("reside_delete_note", {
      description: "Deletes a memory note by id.",
      parameters: deleteNoteParametersSchema,
      handler: async ({ id }) => {
        const note = await prisma.memoryNote.delete({
          where: { id },
          select: { id: true },
        })

        return {
          id: note.id,
        }
      },
    }),
  ]
}

function normalizeTags(tags: string[] | undefined, allowedTags: Set<string> | undefined): string[] {
  const normalized = Array.from(new Set((tags ?? []).map(tag => tag.trim())))

  if (!allowedTags) {
    if (normalized.length > 0) {
      throw new Error("Tags are not allowed for this language engine")
    }

    return []
  }

  for (const tag of normalized) {
    if (!allowedTags.has(tag)) {
      throw new Error(`Unknown memory tag "${tag}"`)
    }
  }

  return normalized
}

export function createMemorySearchWords(words: string[]): MemorySearchWords {
  const normalizedWords = words.flatMap(word =>
    Array.from(word.toLowerCase().matchAll(MEMORY_SEARCH_WORD_PATTERN), match => match[0]),
  )
  const uniqueWords = Array.from(new Set(normalizedWords)).slice(0, MEMORY_SEARCH_WORD_LIMIT)

  return {
    words: uniqueWords,
    anyTermQuery: uniqueWords.join(" | "),
    likePatterns: uniqueWords.map(word => `%${escapeLikePattern(word)}%`),
  }
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`)
}
