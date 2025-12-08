import { z } from "zod"

export const Config = z.object({
  /**
   * The domain to use for ingress resources.
   *
   * If not set, no TLS will be configured for ingresses.
   */
  RESIDE_DOMAIN: z.string().optional(),

  /**
   * The name of the cert-manager cluster issuer to use for all ingresses in the cluster.
   *
   * Must be set if RESIDE_DOMAIN is set.
   */
  RESIDE_CLUSTER_ISSUER: z.string().optional(),
})
