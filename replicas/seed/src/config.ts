import { z } from "zod"

export const Config = z.object({
  /**
   * The name of the namespace where Seed Replica is located.
   */
  RESIDE_NAMESPACE: z.string().min(1),

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

  /**
   * The default placement group for all components and replicas in the cluster.
   *
   * If not specified, components and replicas will be placed on any available nodes by default.
   */
  RESIDE_DEFAULT_PLACEMENT_GROUP: z.string().optional(),
})

export type Config = z.infer<typeof Config>
