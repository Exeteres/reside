import { waitForOperationSuccess } from "@reside/api"
import {
  bootstrapService,
  defineCommonResources,
  registerReplica,
  runPrismaMigrations,
} from "@reside/common"
import { engineerReplica, WellKnownPermissions } from "@reside/registry"
import {
  createTaskCommand,
  ENGINEER_FACTORY_NAME,
  EngineerNotificationChannels,
} from "../definitions"
import { strings } from "../locale"
import { createServices } from "../shared"
import { bootstrapFactory } from "./factory"

const services = await createServices()

await runPrismaMigrations(services.pool)

await defineCommonResources({
  services,
  permissions: [
    {
      name: WellKnownPermissions.ENGINEER_TASK_DEFINE,
      title: strings.bootstrap.permissions.taskDefine.title,
      description: strings.bootstrap.permissions.taskDefine.description,
      scoped: false,
    },
  ],
  avatarTitle: strings.bootstrap.registration.title,
  commands: [createTaskCommand],
  notificationsChannels: [
    {
      name: EngineerNotificationChannels.TASKS,
      title: strings.notifications.channels.tasks.title,
      description: strings.notifications.channels.tasks.description,
    },
  ],
  reaperHandlers: [
    {
      resourceReplicaName: "engineer",
      title: strings.reaper.title,
    },
  ],
})

const infraBootstrapPermission = await services.permissionRequestService.requestPermissions({
  reason: "Для создания временных баз данных PostgreSQL и управления шлюзом инженерной фабрики.",
  permissionSetName: "engineer-bootstrap-infra",
  items: [
    {
      permissionName: WellKnownPermissions.INFRA_TEMPORARY_POSTGRES_DATABASE_CREATE,
    },
    {
      permissionName: WellKnownPermissions.INFRA_GATEWAY_MANAGE,
      scope: ENGINEER_FACTORY_NAME,
    },
  ],
})

if (infraBootstrapPermission.operation) {
  await waitForOperationSuccess(infraBootstrapPermission.operation, {
    operationService: services.accessOperationService,
  })
}

await bootstrapFactory({ services })

await bootstrapService({ longRunning: true })

await registerReplica({
  replica: engineerReplica,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
})
