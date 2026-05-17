import { AuthzService, type AuthzServiceClient } from "@reside/api/access/authz.v1"
import {
  PermissionRequestService,
  type PermissionRequestServiceClient,
} from "@reside/api/access/request.v1"
import {
  DefinitionService as AccessDefinitionService,
  type DefinitionServiceClient as AccessDefinitionServiceClient,
} from "@reside/api/access/definition.v1"
import { OperationService, type OperationServiceClient } from "@reside/api/common/operation.v1"
import { GatewayService, type GatewayServiceClient } from "@reside/api/infra/gateway.v1"
import {
  ObservabilityService,
  type ObservabilityServiceClient,
} from "@reside/api/infra/observability.v1"
import { ProvisionService, type ProvisionServiceClient } from "@reside/api/infra/provision.v1"
import {
  NotificationService,
  type NotificationServiceClient,
} from "@reside/api/interaction/notification.v1"
import { AvatarService, type AvatarServiceClient } from "@reside/api/interaction/avatar.v1"
import {
  DefinitionService as InteractionDefinitionService,
  type DefinitionServiceClient as InteractionDefinitionServiceClient,
} from "@reside/api/interaction/definition.v1"
import {
  RegistrationService,
  type RegistrationServiceClient,
} from "@reside/api/alpha/registration.v1"
import type { TracerProvider } from "@opentelemetry/api"
import { createChannels, createClient } from "./api"
import { TimerService, type TimerServiceClient } from "@reside/api/infra/timer.v1"
import { setupTelemetry } from "./telemetry"
import type { SubjectServiceClient } from "@reside/api/common/subject.v1"

/**
 * The rules for naming services in the topology are the following:
 *
 * - use the name of the API group (and endpoint name in the topology), not the replica ("interaction" instead of "telegram"), though most of them will match the replica name;
 * - add the "Service" suffix;
 * - add the API name as a prefix for services with conflicting names (e.g., "accessOperationService" and "interactionOperationService").
 */

type CommonServiceMap<TEndpoints extends Record<string, string>> = Record<never, never> &
  (TEndpoints extends Record<"infra", string>
    ? {
        provisionService: ProvisionServiceClient
        observabilityService: ObservabilityServiceClient
        gatewayService: GatewayServiceClient
        timerService: TimerServiceClient
        infraOperationService: OperationServiceClient
        tracerProvider?: TracerProvider
      }
    : Record<never, never>) &
  (TEndpoints extends Record<"access", string>
    ? {
        permissionRequestService: PermissionRequestServiceClient
        authzService: AuthzServiceClient
        subjectService: SubjectServiceClient
        accessOperationService: OperationServiceClient
        accessDefinitionService: AccessDefinitionServiceClient
      }
    : Record<never, never>) &
  (TEndpoints extends Record<"interaction", string>
    ? {
        notificationService: NotificationServiceClient
        avatarService: AvatarServiceClient
        interactionDefinitionService: InteractionDefinitionServiceClient
        interactionOperationService: OperationServiceClient
      }
    : Record<never, never>) &
  (TEndpoints extends Record<"alpha", string>
    ? {
        registrationService: RegistrationServiceClient
        alphaOperationService: OperationServiceClient
      }
    : Record<never, never>)

export type CommonServices<TApiGroups extends string = string> = CommonServiceMap<
  Record<TApiGroups, string>
>

type AllServices = CommonServices<"infra" | "access" | "interaction" | "alpha">

export type CommonServicesOptions<TEndpoints extends Record<string, string>> = {
  endpoints: TEndpoints
}

/**
 * Creates clients for all services defined in the topology, based on the provided endpoints.
 * Services for which no endpoint is provided will be omitted from the result.
 *
 * @param endpionts The endpoints to use for creating service clients. The keys of this object determine which services will be included in the result.
 * @return An object containing the created service clients, as well as the channels used to create them.
 */
export async function createCommonServices<TEndpoints extends Record<string, string>>(
  endpoints: TEndpoints,
) {
  const services: Partial<AllServices> = {}
  const channels = await createChannels(endpoints)

  if (channels.infra) {
    services.provisionService = createClient(ProvisionService, channels.infra)
    services.observabilityService = createClient(ObservabilityService, channels.infra)
    services.gatewayService = createClient(GatewayService, channels.infra)
    services.timerService = createClient(TimerService, channels.infra)
    services.infraOperationService = createClient(OperationService, channels.infra)

    const telemetry = await setupTelemetry(services.observabilityService)
    services.tracerProvider = telemetry.tracerProvider
  }

  if (channels.access) {
    services.permissionRequestService = createClient(PermissionRequestService, channels.access)
    services.authzService = createClient(AuthzService, channels.access)
    services.accessOperationService = createClient(OperationService, channels.access)
    services.accessDefinitionService = createClient(AccessDefinitionService, channels.access)
  }

  if (channels.interaction) {
    services.notificationService = createClient(NotificationService, channels.interaction)
    services.avatarService = createClient(AvatarService, channels.interaction)
    services.interactionDefinitionService = createClient(
      InteractionDefinitionService,
      channels.interaction,
    )
    services.interactionOperationService = createClient(OperationService, channels.interaction)
  }

  if (channels.alpha) {
    services.registrationService = createClient(RegistrationService, channels.alpha)
    services.alphaOperationService = createClient(OperationService, channels.alpha)
  }

  return {
    ...(services as CommonServiceMap<TEndpoints>),
    channels,
  }
}
