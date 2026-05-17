import type { Replica } from "@reside/registry"
import { RegistrationService } from "@reside/api/alpha/registration.v1"
import { alphaReplica, getAllDependencies } from "@reside/registry"
import { createChannel, createClient } from "./api"
import { getReplicaEndpoint } from "./kubernetes"
import { logger } from "./logger"

export type RegisterReplicaOptions<TReplica extends Replica = Replica> = {
  replica: TReplica
  title: string
  description: string
}

/**
 * Registers the current replica in Alpha using its current internal endpoint.
 *
 * If registration fails, the error is logged and not retried.
 *
 * @param options The registration options.
 */
export async function registerReplica<TReplica extends Replica>({
  replica,
  title,
  description,
}: RegisterReplicaOptions<TReplica>): Promise<void> {
  try {
    const channel = createChannel(alphaReplica.endpoint)

    const allDependencies = getAllDependencies(replica)
    const allEndpoints = replica.endpoints

    const replicaDependencies = Object.entries(allDependencies).map(
      ([name, dependencyReplica]) => ({
        name,
        defaultReplicaName: dependencyReplica.name,
      }),
    )

    const endpointDependencies = Object.entries(allEndpoints).map(([name, endpoint]) => ({
      name,
      defaultEndpoint: endpoint,
    }))

    const registrationService = createClient(RegistrationService, channel)

    logger.info('registering replica "%s" in alpha', replica.name)

    await registrationService.registerReplica({
      title,
      description,
      internalEndpoint: getReplicaEndpoint(),
      replicaDependencies,
      endpointDependencies,
    })

    logger.info('replica "%s" was registered in alpha successfully', replica.name)
  } catch (error) {
    logger.error(error, 'failed to register replica "%s" in alpha, not retrying', replica.name)
  }
}
