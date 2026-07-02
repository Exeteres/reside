import {
  bootstrapService,
  defineCommonResources,
  getReplicaEndpoint,
  registerReplica,
  runPrismaMigrations,
} from "@reside/common"
import { alphaReplica, WellKnownPermissions } from "@reside/registry"
import {
  AlphaNotificationChannels,
  replicasCommand,
  resetReplicaNodeCommand,
  setReplicaNodeCommand,
} from "../definitions"
import { strings } from "../locale"
import { createServices } from "../shared"

await registerReplica({
  replica: alphaReplica,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
})

const services = await createServices()

await defineCommonResources({
  services,
  realms: [
    {
      name: "replica",
      title: "Replica",
      description: strings.bootstrap.realm.description,
      subjectServiceEndpoint: `${getReplicaEndpoint()}:80`,
    },
  ],
  permissions: [
    {
      name: WellKnownPermissions.ALPHA_REPLICA_LOAD,
      title: strings.bootstrap.permissions.loadReplica.title,
      description: strings.bootstrap.permissions.loadReplica.description,
      scoped: true,
    },
  ],
  avatarTitle: strings.bootstrap.registration.title,
  commands: [replicasCommand, setReplicaNodeCommand, resetReplicaNodeCommand],
  notificationsChannels: [
    {
      name: AlphaNotificationChannels.REPLICAS,
      title: strings.bootstrap.channels.replicas.title,
    },
    {
      name: AlphaNotificationChannels.RELEASE_NOTES,
      title: strings.bootstrap.channels.releaseNotes.title,
    },
  ],
  reaperHandlers: [
    {
      resourceReplicaName: "alpha",
      title: strings.reaper.title,
    },
  ],
})

await runPrismaMigrations(services.pool)
await bootstrapService({ longRunning: true })
