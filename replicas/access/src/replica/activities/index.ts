import type { Operation, PrismaClient } from "../../database"
import { create } from "@bufbuild/protobuf"
import {
  type ApprovalRequest,
  ApprovalRequestSchema,
  ApprovalService,
  type ApprovalServiceClient,
} from "@reside/api/common/approval.v1"
import {
  OperationService,
  type SubscribeToOperationCompletionResponseJson,
} from "@reside/api/common/operation.v1"
import { SubjectService, type SubjectServiceClient } from "@reside/api/common/subject.v1"
import {
  block,
  bold,
  createChannel,
  createClient,
  createOperationActivities,
  type GenericOperationService,
  inline,
  type OperationActivities,
  SPACE,
} from "@reside/common"
import { strings } from "../../locale"

type ApprovalContext = {
  requestSetId: number
  operationId: number
  subjectId: string
  title: string
  content: string
  approvers: Array<{
    id: number
    name: string
    priority: number
    realms: string[]
  }>
}

type EndpointClients = {
  approvalService: ApprovalServiceClient
  operationActivities: OperationActivities
}

const PERMISSION_REQUEST_DENIED_FAILURE_REASON = "PERMISSION_REQUEST_DENIED"
const PERMISSION_REQUEST_WORKFLOW_FAILED_REASON = "PERMISSION_REQUEST_WORKFLOW_FAILED"

export type AccessActivities = ReturnType<typeof createAccessActivities>

export function createAccessActivities(
  prisma: PrismaClient,
  operationService: GenericOperationService<Operation>,
) {
  const clientsByEndpoint = new Map<string, EndpointClients>()
  const subjectServiceClientsByEndpoint = new Map<string, SubjectServiceClient>()

  function getEndpointClients(endpoint: string): EndpointClients {
    const cachedClients = clientsByEndpoint.get(endpoint)
    if (cachedClients) {
      return cachedClients
    }

    const channel = createChannel(endpoint)
    const nextClients = {
      approvalService: createClient(ApprovalService, channel),
      operationActivities: createOperationActivities(createClient(OperationService, channel)),
    }

    clientsByEndpoint.set(endpoint, nextClients)
    return nextClients
  }

  function getSubjectServiceClient(endpoint: string): SubjectServiceClient {
    const cachedClient = subjectServiceClientsByEndpoint.get(endpoint)
    if (cachedClient) {
      return cachedClient
    }

    const nextClient = createClient(SubjectService, createChannel(endpoint))
    subjectServiceClientsByEndpoint.set(endpoint, nextClient)
    return nextClient
  }

  return {
    async getApprovalContext(operationId: number): Promise<ApprovalContext> {
      const operation = await prisma.operation.findUnique({
        where: {
          id: operationId,
        },
        include: {
          permissionRequestSet: {
            include: {
              items: {
                include: {
                  permission: {
                    select: {
                      id: true,
                      name: true,
                      title: true,
                      description: true,
                    },
                  },
                },
              },
            },
          },
        },
      })

      if (operation === null || operation.permissionRequestSet === null) {
        throw new Error(`Operation "${operationId}" has no permission request set result`)
      }

      const requestSet = operation.permissionRequestSet
      const approverSubject = parseSubjectId(requestSet.subjectId)
      const approvers =
        approverSubject === null
          ? []
          : await prisma.approver.findMany({
              where: {
                realms: {
                  some: {
                    name: approverSubject.realmName,
                  },
                },
              },
              include: {
                realms: {
                  select: {
                    name: true,
                  },
                },
              },
              orderBy: [{ priority: "asc" }, { name: "asc" }],
            })

      const subjectDisplay = await resolveSubjectDisplayInfo(
        prisma,
        requestSet.subjectId,
        getSubjectServiceClient,
      )

      const requestedByDisplay = await resolveSubjectDisplayInfo(
        prisma,
        requestSet.requestedBySubjectId,
        getSubjectServiceClient,
        {
          includeSubjectId: false,
        },
      )

      const requestedPermissions = block(
        deduplicateApprovalItems(requestSet.items).map((item, index) => {
          const permissionTitle =
            item.permission.title.length > 0 ? item.permission.title : item.permission.name

          return inline(
            `${index + 1}. `,
            permissionTitle,
            SPACE,
            `(${toApprovalScopeText(item.scope)})`,
          )
        }),
      )

      const approvalContent = block(
        inline(bold(strings.approvalMessage.requestNumberLabel), SPACE, String(requestSet.id)),
        inline(bold(strings.approvalMessage.subjectLabel), SPACE, subjectDisplay),
        inline(bold(strings.approvalMessage.requestedByLabel), SPACE, requestedByDisplay),
        "",
        bold(strings.approvalMessage.permissionsHeader),
        requestedPermissions,
        "",
        bold(strings.approvalMessage.reasonHeader),
        { html: requestSet.reason },
      ).html

      return {
        requestSetId: requestSet.id,
        operationId,
        subjectId: requestSet.subjectId,
        title: strings.common.requestSetApprovalTitle,
        content: approvalContent,
        approvers: approvers.map(approver => ({
          id: approver.id,
          name: approver.name,
          priority: approver.priority,
          realms: approver.realms.map(realm => realm.name),
        })),
      }
    },

    async requestApproverDecision(input: {
      approverId: number
      title: string
      content: string
    }): Promise<number> {
      const callbackEndpoint = await resolveApproverCallbackEndpoint(prisma, input.approverId)
      const clients = getEndpointClients(callbackEndpoint)

      const requestPayload: ApprovalRequest = create(ApprovalRequestSchema, {
        title: input.title,
        content: input.content,
      })

      const operation = await clients.approvalService.approve(requestPayload)

      return operation.id
    },

    async subscribeToExternalOperationCompletion(input: {
      approverId: number
      operationId: number
      workflowId: string
    }): Promise<SubscribeToOperationCompletionResponseJson> {
      const callbackEndpoint = await resolveApproverCallbackEndpoint(prisma, input.approverId)
      const clients = getEndpointClients(callbackEndpoint)

      return await clients.operationActivities.subscribeToOperationCompletion(
        input.operationId,
        input.workflowId,
      )
    },

    async cancelApproverOperation(input: {
      approverId: number
      operationId: number
    }): Promise<void> {
      const callbackEndpoint = await resolveApproverCallbackEndpoint(prisma, input.approverId)
      const clients = getEndpointClients(callbackEndpoint)

      await clients.operationActivities.cancelOperation(input.operationId)
    },

    async approvePermissionRequestSet(input: {
      operationId: number
      resolution: string
      resolvedBySubjectId: string | null
    }): Promise<void> {
      const operation = await prisma.operation.findUnique({
        where: {
          id: input.operationId,
        },
        include: {
          permissionRequestSet: {
            include: {
              permissionSet: {
                select: {
                  id: true,
                },
              },
              items: true,
            },
          },
        },
      })

      if (operation === null || operation.permissionRequestSet === null) {
        throw new Error(`Operation "${input.operationId}" has no permission request set result`)
      }

      const requestSet = operation.permissionRequestSet
      const permissionSetId = requestSet.permissionSet.id

      await prisma.$transaction(async tx => {
        await tx.permissionSetItem.createMany({
          data: requestSet.items.map(item => ({
            permissionSetId,
            permissionId: item.permissionId,
            scope: item.scope,
          })),
          skipDuplicates: true,
        })

        for (const item of requestSet.items) {
          if (item.scope === null) {
            const existingBinding = await tx.permissionBinding.findFirst({
              where: {
                permissionId: item.permissionId,
                subjectId: requestSet.subjectId,
                scope: null,
              },
              select: {
                id: true,
              },
            })

            if (existingBinding !== null) {
              await tx.permissionBinding.update({
                where: {
                  id: existingBinding.id,
                },
                data: {
                  permissionSetId,
                },
              })
            } else {
              await tx.permissionBinding.create({
                data: {
                  permissionId: item.permissionId,
                  subjectId: requestSet.subjectId,
                  scope: null,
                  permissionSetId,
                },
              })
            }

            continue
          }

          await tx.permissionBinding.upsert({
            where: {
              permissionId_subjectId_scope: {
                permissionId: item.permissionId,
                subjectId: requestSet.subjectId,
                scope: item.scope,
              },
            },
            create: {
              permissionId: item.permissionId,
              subjectId: requestSet.subjectId,
              scope: item.scope,
              permissionSetId,
            },
            update: {
              permissionSetId,
            },
          })
        }

        await tx.permissionRequestSet.update({
          where: {
            id: requestSet.id,
          },
          data: {
            status: "APPROVED",
            resolution: input.resolution,
            resolvedBySubjectId: input.resolvedBySubjectId,
            resolvedAt: new Date(),
          },
        })
      })

      await operationService.setCompleted(input.operationId, {
        permissionRequestSetId: requestSet.id,
      })
    },

    async rejectPermissionRequestSet(input: {
      operationId: number
      resolution: string
      resolvedBySubjectId: string | null
    }): Promise<void> {
      const operation = await prisma.operation.findUnique({
        where: {
          id: input.operationId,
        },
        include: {
          permissionRequestSet: true,
        },
      })

      if (operation === null || operation.permissionRequestSet === null) {
        throw new Error(`Operation "${input.operationId}" has no permission request set result`)
      }

      await prisma.permissionRequestSet.update({
        where: {
          id: operation.permissionRequestSet.id,
        },
        data: {
          status: "DENIED",
          resolution: input.resolution,
          resolvedBySubjectId: input.resolvedBySubjectId,
          resolvedAt: new Date(),
        },
      })

      await operationService.setFailed(
        input.operationId,
        PERMISSION_REQUEST_DENIED_FAILURE_REASON,
        input.resolution,
      )
    },

    async failPermissionRequestSetWorkflowIfPending(input: {
      operationId: number
      resolution: string
    }): Promise<void> {
      const operation = await prisma.operation.findUnique({
        where: {
          id: input.operationId,
        },
        include: {
          permissionRequestSet: true,
        },
      })

      if (operation === null || operation.permissionRequestSet === null) {
        throw new Error(`Operation "${input.operationId}" has no permission request set result`)
      }

      if (operation.status !== "PENDING") {
        return
      }

      if (operation.permissionRequestSet.status === "PENDING") {
        await prisma.permissionRequestSet.update({
          where: {
            id: operation.permissionRequestSet.id,
          },
          data: {
            status: "DENIED",
            resolution: input.resolution,
            resolvedBySubjectId: null,
            resolvedAt: new Date(),
          },
        })
      }

      await operationService.setFailed(
        input.operationId,
        PERMISSION_REQUEST_WORKFLOW_FAILED_REASON,
        input.resolution,
      )
    },
  }
}

function deduplicateApprovalItems(
  items: Array<{
    permission: {
      id: number
      name: string
      title: string
    }
    scope: string | null
  }>,
): Array<{
  permission: {
    id: number
    name: string
    title: string
  }
  scope: string | null
}> {
  const deduplicated = new Map<string, (typeof items)[number]>()

  for (const item of items) {
    deduplicated.set(`${item.permission.id}|${item.scope ?? ""}`, item)
  }

  return [...deduplicated.values()]
}

function toApprovalScopeText(scope: string | null): string {
  const normalizedScope = scope?.trim()
  if (normalizedScope && normalizedScope.length > 0) {
    return normalizedScope
  }

  return "*"
}

async function resolveApproverCallbackEndpoint(
  prisma: PrismaClient,
  approverId: number,
): Promise<string> {
  const approver = await prisma.approver.findUnique({
    where: {
      id: approverId,
    },
    select: {
      callbackEndpoint: true,
    },
  })

  if (approver === null) {
    throw new Error(`Approver "${approverId}" not found`)
  }

  if (approver.callbackEndpoint.length === 0) {
    throw new Error(`Approver "${approverId}" has empty callback endpoint`)
  }

  return approver.callbackEndpoint
}

async function resolveSubjectDisplayInfo(
  prisma: PrismaClient,
  subjectId: string,
  getSubjectServiceClient: (endpoint: string) => SubjectServiceClient,
  options?: {
    includeSubjectId?: boolean
  },
): Promise<string> {
  const parsedSubjectId = parseSubjectId(subjectId)
  if (parsedSubjectId === null) {
    return subjectId
  }

  const realm = await prisma.realm.findUnique({
    where: {
      name: parsedSubjectId.realmName,
    },
    select: {
      subjectServiceEndpoint: true,
    },
  })

  if (realm === null) {
    return subjectId
  }

  if (realm.subjectServiceEndpoint === null || realm.subjectServiceEndpoint.length === 0) {
    return subjectId
  }

  try {
    const subjectDisplayInfo = await getSubjectServiceClient(
      realm.subjectServiceEndpoint,
    ).getSubjectDisplayInfo({
      subjectId,
    })

    if (subjectDisplayInfo.title.length === 0) {
      return subjectId
    }

    if (options?.includeSubjectId === false) {
      return subjectDisplayInfo.title
    }

    return `${subjectDisplayInfo.title} (${subjectId})`
  } catch {
    return subjectId
  }
}

function parseSubjectId(subjectId: string): { realmName: string } | null {
  const segments = subjectId.split(":")
  if (segments.length !== 2) {
    return null
  }

  const realmName = segments[0]
  const subjectName = segments[1]
  if (!realmName || !subjectName) {
    return null
  }

  return {
    realmName,
  }
}
