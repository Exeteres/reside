import { prettifyError, type z } from "zod"

/**
 * Loads and validates configuration from environment variables using the provided Zod schema.
 *
 * @param schema The Zod schema to validate the configuration against.
 * @returns The validated configuration object.
 * @throws Will throw an error if the configuration is invalid.
 */
export function loadConfig<T>(schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${prettifyError(parsed.error)}`)
  }

  return parsed.data
}
