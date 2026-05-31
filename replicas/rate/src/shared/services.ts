import { createCommonServices, createTemporalClient } from "@reside/common"
import { rateReplica } from "@reside/registry"

export async function createServices() {
  const services = await createCommonServices(rateReplica.endpoints)
  const temporalClient = await createTemporalClient(services)

  return {
    ...services,
    temporalClient,
  }
}
