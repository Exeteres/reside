import { z } from "zod"

export const Config = z.object({
  /**
   * The name of the namespace where Seed Replica is located.
   */
  RESIDE_NAMESPACE: z.string().min(1),

  /**
   * The domain to use for Jazz ingress.
   *
   * If not set, ingress will not be created.
   */
  RESIDE_BOOTSTRAP_JAZZ_INGRESS_DOMAIN: z.string().optional(),

  /**
   * The service type to use for the Jazz service.
   *
   * Defaults to "ClusterIP".
   */
  RESIDE_BOOTSTRAP_JAZZ_SERVICE_TYPE: z.enum(["LoadBalancer", "ClusterIP"]).default("ClusterIP"),

  /**
   * The name of the cert-alpha cluster issuer to use for Jazz.
   *
   * If not set, no TLS certificates will be created.
   */
  RESIDE_BOOTSTRAP_JAZZ_CLUSTER_ISSUER: z.string().optional(),
})

export type Config = z.infer<typeof Config>
