import {
  bootstrapService,
  defineCommonResources,
  getReplicaEndpoint,
  registerReplica,
  runPrismaMigrations,
  WellKnownPermissions,
} from "@reside/common"
import { alphaReplica } from "@reside/topology"
import { AlphaNotificationChannels, helloCommand } from "../definitions"
import { strings } from "../locale"
import { createServices } from "../shared"

await registerReplica({
  replica: alphaReplica,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
})

const {
  pool,
  accessRequestService,
  accessOperationService,
  accessDefinitionService,
  interactionDefinitionService,
} = await createServices()

await defineCommonResources({
  accessRequestService,
  accessOperationService,

  access: {
    definitionService: accessDefinitionService,
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
  },

  interaction: {
    definitionService: interactionDefinitionService,
    commands: [helloCommand],
    notificationsChannels: [
      {
        name: AlphaNotificationChannels.HELLO,
        title: "hiii",
      },
    ],
  },
})

await runPrismaMigrations(pool)
await bootstrapService({ longRunning: true })
