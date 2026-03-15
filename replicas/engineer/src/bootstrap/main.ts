import {
  bootstrapService,
  defineCommonResources,
  registerReplica,
  runPrismaMigrations,
  WellKnownPermissions,
} from "@reside/common"
import { engineerReplica } from "@reside/topology"
import { createTaskCommand, EngineerNotificationChannels } from "../definitions"
import { strings } from "../locale"
import { createServices } from "../shared"

await registerReplica({
  replica: engineerReplica,
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

await runPrismaMigrations(pool)

await defineCommonResources({
  accessRequestService,
  accessOperationService,
  access: {
    definitionService: accessDefinitionService,
    permissions: [
      {
        name: WellKnownPermissions.ENGINEER_TASK_DEFINE,
        title: strings.bootstrap.permissions.taskDefine.title,
        description: strings.bootstrap.permissions.taskDefine.description,
        scoped: false,
      },
    ],
  },
  interaction: {
    definitionService: interactionDefinitionService,
    commands: [createTaskCommand],
    notificationsChannels: [
      {
        name: EngineerNotificationChannels.TASKS,
        title: strings.notifications.channels.tasks.title,
        description: strings.notifications.channels.tasks.description,
      },
    ],
  },
})

await bootstrapService({ longRunning: true })
