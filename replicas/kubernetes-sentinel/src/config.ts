import { z } from "zod"

export const Config = z.object({
  /**
   * The name of the namespace where replica is located.
   */
  RESIDE_NAMESPACE: z.string().min(1),
})

export type Config = z.infer<typeof Config>
