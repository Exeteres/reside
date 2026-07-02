import { waitForOperationSuccess } from "@reside/api"
import {
  bootstrapService,
  defineCommonResources,
  registerReplica,
  runPrismaMigrations,
} from "@reside/common"
import { engineerReplica, WellKnownPermissions } from "@reside/registry"
import { createTaskCommand, EngineerNotificationChannels } from "../definitions"
import { strings } from "../locale"
import { createServices } from "../shared"

await registerReplica({
  replica: engineerReplica,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
})

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

const temporaryDatabasePermission = await services.permissionRequestService.requestPermissions({
  reason:
    "Для создания временных баз данных PostgreSQL при выполнении инженерных задач и проверок.",
  permissionSetName: "engineer-temporary-postgres-databases",
  items: [
    {
      permissionName: WellKnownPermissions.INFRA_TEMPORARY_POSTGRES_DATABASE_CREATE,
    },
  ],
})

if (temporaryDatabasePermission.operation) {
  await waitForOperationSuccess(temporaryDatabasePermission.operation, {
    operationService: services.accessOperationService,
  })
}

await bootstrapService({ longRunning: true })
