import type { HandlerContext } from "@connectrpc/connect"
import type {
  EnsureGatewayRequest,
  GatewayServiceImplementation,
} from "@reside/api/infra/gateway.v1"
import type { GenericOperationService } from "@reside/common"
import type { Client } from "@temporalio/client"
import type { Operation, PrismaClient } from "../../database"
import { create } from "@bufbuild/protobuf"
import { Code, ConnectError } from "@connectrpc/connect"
import { CoreV1Api } from "@kubernetes/client-node"
import { EnsureGatewayResponseSchema } from "@reside/api/infra/gateway.v1"
import { authenticateReplica, type CommonServices, kubeConfig } from "@reside/common"
import { WellKnownPermissions } from "@reside/registry"
import { OperationStatus, OperationType } from "../../database"
import { strings } from "../../locale"
import { loadInfraGatewayConfig, resolveGatewayFqdn } from "../../shared"
import {
  assertValidGatewayRequest,
  ensureGatewayRegistrationOrThrow,
  startEnsureGatewayWorkflow,
} from "../business/gateway"

export function createGatewayService({
  prisma,
  operationService,
  authzService,
  temporalClient,
}: CommonServices<"access"> & {
  prisma: PrismaClient
  operationService: GenericOperationService<Operation>
  temporalClient: Client
}): GatewayServiceImplementation {
  return {
    async ensureGateway(request: EnsureGatewayRequest, context: HandlerContext) {
      const { name: replicaName } = await authenticateReplica(context)
      const subjectId = `replica:${replicaName}`

      assertValidGatewayRequest(request)
      const normalizedGatewayName = request.name.trim()

      const authz = await authzService.checkPermission({
        permissionName: WellKnownPermissions.INFRA_GATEWAY_MANAGE,
        subjectId,
        scope: normalizedGatewayName,
      })

      if (!authz.authorized) {
        throw new ConnectError(
          `Subject "${subjectId}" is not allowed to manage gateway "${normalizedGatewayName}"`,
          Code.PermissionDenied,
        )
      }

      const registration = await ensureGatewayRegistrationOrThrow(prisma, request, replicaName)

      const latestOperation = await prisma.operation.findFirst({
        where: {
          type: OperationType.ENSURE_GATEWAY,
          gateway: {
            name: registration.name,
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          status: true,
        },
      })

      if (!registration.changed) {
        if (latestOperation?.status === OperationStatus.PENDING) {
          return create(EnsureGatewayResponseSchema, {
            response: {
              case: "operation",
              value: await operationService.toApiOperation(latestOperation.id),
            },
          })
        }

        const coreApi = kubeConfig.makeApiClient(CoreV1Api)
        const infraGatewayConfig = await loadInfraGatewayConfig(coreApi)

        return create(EnsureGatewayResponseSchema, {
          response: {
            case: "result",
            value: {
              endpoint: resolveGatewayFqdn(registration.name, infraGatewayConfig.clusterDomain),
            },
          },
        })
      }

      const pendingOperation =
        latestOperation?.status === OperationStatus.PENDING ? latestOperation : null

      if (pendingOperation !== null) {
        return create(EnsureGatewayResponseSchema, {
          response: {
            case: "operation",
            value: await operationService.toApiOperation(pendingOperation.id),
          },
        })
      }

      const operation = await prisma.operation.create({
        data: {
          title: strings.operations.gateway.title(registration.name),
          description: strings.operations.gateway.description(registration.name),
          type: OperationType.ENSURE_GATEWAY,
          status: OperationStatus.PENDING,
          failureReason: null,
          failureMessage: null,
          callbackEndpoint: null,
          resolvedAt: null,
          gatewayId: registration.id,
        },
        select: {
          id: true,
        },
      })

      await startEnsureGatewayWorkflow(temporalClient, operation.id)

      return create(EnsureGatewayResponseSchema, {
        response: {
          case: "operation",
          value: await operationService.toApiOperation(operation.id),
        },
      })
    },
  }
}
