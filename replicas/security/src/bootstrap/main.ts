import { waitForOperationSuccess } from "@reside/api"
import {
  bootstrapService,
  defineCommonResources,
  getReplicaCallbackEndpoint,
  registerReplica,
  runPrismaMigrations,
} from "@reside/common"
import { securityReplica, WellKnownPermissions } from "@reside/registry"
import { strings } from "../locale"
import { createServices } from "../shared"

await registerReplica({
  replica: securityReplica,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
})

const services = await createServices()

await runPrismaMigrations(services.pool)

await defineCommonResources({
  services,
  avatarTitle: strings.bootstrap.registration.title,
})

{
  const { operation } = await services.permissionRequestService.requestPermissions({
    reason: strings.bootstrap.approver.permissionRequestReason,
    permissionSetName: "setup-security-approver",
    items: [
      {
        permissionName: WellKnownPermissions.ACCESS_APPROVER_MANAGE,
        scope: "security:40:replica:telegram",
      },
    ],
  })

  if (operation) {
    await waitForOperationSuccess(operation, {
      operationService: services.accessOperationService,
    })
  }
}

await services.accessDefinitionService.putApprover({
  name: "security",
  priority: 40,
  realms: ["replica", "telegram"],
  title: strings.bootstrap.approver.title,
  description: strings.bootstrap.approver.description,
  callbackEndpoint: getReplicaCallbackEndpoint(),
})

await bootstrapService()
