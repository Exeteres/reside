import { createCommonServices, createTemporalClient } from "@reside/common"
import { helloReplica } from "@reside/registry"

export async function createServices() {
  const services = await createCommonServices(helloReplica.endpoints)
  const temporalClient = await createTemporalClient(services)

  return {
    ...services,
    temporalClient,
  }
}
