import type { GenericOperationService } from "@reside/common"
import type { Operation as AccessOperation, PrismaClient } from "../../database"
import { Code, ConnectError } from "@connectrpc/connect"
import { status as GrpcStatus } from "@grpc/grpc-js"
import { DEFAULT_TEMPORAL_TASK_QUEUE, logger } from "@reside/common"
import { type Client, isGrpcServiceError, WorkflowIdReusePolicy } from "@temporalio/client"
import { strings } from "../../locale"

type RequestedPermissionItem = {
  permissionName: string
  scope: string | undefined
}

export type PermissionRequestInput = {
  subjectId: string | undefined
  permissionSetName: string | undefined
  reason: string
  items: RequestedPermissionItem[]
}

export async function requestPermissions(
  prisma: PrismaClient,
  operationService: GenericOperationService<AccessOperation>,
  temporalClient: Client,
  requesterSubjectId: string | undefined,
  request: PermissionRequestInput,
) {
  const effectiveSubjectId = request.subjectId ?? requesterSubjectId
  if (effectiveSubjectId === undefined) {
    throw new ConnectError(
      "subject_id is missing and requester subject id is unavailable",
      Code.InvalidArgument,
    )
  }

  assertValidSubjectId(effectiveSubjectId, "subject_id")
  const effectivePermissionSetName =
    request.permissionSetName !== undefined && request.permissionSetName.trim().length > 0
      ? request.permissionSetName
      : "default"

  const effectiveRequestedBySubjectId = requesterSubjectId ?? effectiveSubjectId

  logger.info(
    'request.requestPermissions subject="%s" requestedBy="%s" items=%d set="%s"',
    effectiveSubjectId,
    effectiveRequestedBySubjectId,
    request.items.length,
    effectivePermissionSetName,
  )
  logger.info(
    'request.requestPermissions requestedPermissions="%s"',
    formatRequestedPermissionsForLog(request.items),
  )

  const requestedPermissionNames = [...new Set(request.items.map(item => item.permissionName))]
  const permissions = await prisma.permission.findMany({
    where: {
      name: {
        in: requestedPermissionNames,
      },
    },
    select: {
      id: true,
      name: true,
      scoped: true,
    },
  })

  const permissionsByName = new Map(permissions.map(permission => [permission.name, permission]))
  const permissionNamesById = new Map(
    permissions.map(permission => [permission.id, permission.name]),
  )
  const missingPermissionNames = requestedPermissionNames.filter(
    name => !permissionsByName.has(name),
  )
  if (missingPermissionNames.length > 0) {
    throw new ConnectError(
      `Permissions not found: ${missingPermissionNames.join(", ")}`,
      Code.NotFound,
    )
  }

  const normalizedItems = request.items.map(item => {
    const permission = permissionsByName.get(item.permissionName)
    if (!permission) {
      throw new ConnectError(`Permission "${item.permissionName}" was not found`, Code.NotFound)
    }

    if (permission.scoped && item.scope === undefined) {
      throw new ConnectError(
        `Permission "${item.permissionName}" requires scope descriptor`,
        Code.InvalidArgument,
      )
    }

    if (!permission.scoped && item.scope !== undefined) {
      throw new ConnectError(
        `Permission "${item.permissionName}" is not scoped and does not accept scope descriptor`,
        Code.InvalidArgument,
      )
    }

    return {
      permissionId: permission.id,
      scope: item.scope,
    }
  })

  const deduplicatedItems = deduplicatePermissionItems(normalizedItems)

  const restrictionPredicates = deduplicatedItems.map(item => ({
    permissionId: item.permissionId,
    subjectId: effectiveSubjectId,
    OR: item.scope === undefined ? [{ scope: null }] : [{ scope: item.scope }, { scope: null }],
  }))

  if (restrictionPredicates.length > 0) {
    const restricted = await prisma.permissionRestriction.findFirst({
      where: {
        OR: restrictionPredicates,
      },
      select: {
        id: true,
      },
    })

    if (restricted !== null) {
      throw new ConnectError(
        "At least one requested permission is explicitly restricted",
        Code.PermissionDenied,
      )
    }
  }

  const requestOutcome = await prisma.$transaction(async tx => {
    const permissionSet = await tx.permissionSet.upsert({
      where: {
        subjectId_managedBySubjectId_name: {
          subjectId: effectiveSubjectId,
          managedBySubjectId: effectiveRequestedBySubjectId,
          name: effectivePermissionSetName,
        },
      },
      create: {
        subjectId: effectiveSubjectId,
        managedBySubjectId: effectiveRequestedBySubjectId,
        name: effectivePermissionSetName,
      },
      update: {},
      select: {
        id: true,
      },
    })

    const existingSetItems = await tx.permissionSetItem.findMany({
      where: {
        permissionSetId: permissionSet.id,
      },
      select: {
        id: true,
        permissionId: true,
        scope: true,
      },
    })

    const requestedKeys = new Set(
      deduplicatedItems.map(item => toPermissionItemKey(item.permissionId, item.scope)),
    )
    const staleItems = existingSetItems.filter(
      item => !requestedKeys.has(toPermissionItemKey(item.permissionId, item.scope)),
    )

    if (staleItems.length > 0) {
      await tx.permissionBinding.deleteMany({
        where: {
          permissionSetId: permissionSet.id,
          OR: staleItems.map(item => ({
            permissionId: item.permissionId,
            scope: item.scope,
          })),
        },
      })

      await tx.permissionSetItem.deleteMany({
        where: {
          id: {
            in: staleItems.map(item => item.id),
          },
        },
      })
    }

    const existingBindings = deduplicatedItems.length
      ? await tx.permissionBinding.findMany({
          where: {
            subjectId: effectiveSubjectId,
            OR: deduplicatedItems.map(item => ({
              permissionId: item.permissionId,
              OR:
                item.scope === undefined
                  ? [{ scope: null }]
                  : [{ scope: item.scope }, { scope: null }],
            })),
          },
          select: {
            permissionId: true,
            scope: true,
          },
        })
      : []

    const missingItems = deduplicatedItems.filter(
      item => !hasMatchingBinding(existingBindings, item),
    )

    logger.info(
      'request.requestPermissions missingApprovalPermissions="%s"',
      formatMissingPermissionItemsForLog(missingItems, permissionNamesById),
    )

    if (missingItems.length === 0) {
      return {
        operationId: undefined,
        shouldStartWorkflow: false,
        supersededOperationIds: [] as number[],
      }
    }

    const activeRequestSets = await tx.permissionRequestSet.findMany({
      where: {
        permissionSetId: permissionSet.id,
        status: "PENDING",
      },
      select: {
        id: true,
        createdAt: true,
        operation: {
          select: {
            id: true,
            status: true,
          },
        },
        items: {
          select: {
            permissionId: true,
            scope: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    })

    const existingMatchingRequestSet = activeRequestSets.find(requestSet =>
      hasExactPermissionItems(requestSet.items, missingItems),
    )

    if (existingMatchingRequestSet?.operation?.status === "PENDING") {
      return {
        operationId: existingMatchingRequestSet.operation.id,
        shouldStartWorkflow: false,
        supersededOperationIds: [] as number[],
      }
    }

    const supersededOperationIds = activeRequestSets
      .map(item => (item.operation?.status === "PENDING" ? item.operation.id : undefined))
      .filter((operationId): operationId is number => operationId !== undefined)

    const operationRecord = await tx.operation.create({
      data: {
        title: strings.operations.requestPermissionSet.title,
        description: strings.operations.requestPermissionSet.description,
        status: "PENDING",
      },
    })

    const requestSet = await tx.permissionRequestSet.create({
      data: {
        permissionSetId: permissionSet.id,
        subjectId: effectiveSubjectId,
        requestedBySubjectId: effectiveRequestedBySubjectId,
        permissionSetName: effectivePermissionSetName,
        reason: request.reason,
        status: "PENDING",
        items: {
          createMany: {
            data: missingItems,
          },
        },
        operation: {
          connect: {
            id: operationRecord.id,
          },
        },
      },
      select: {
        id: true,
      },
    })

    if (activeRequestSets.length > 0) {
      await tx.permissionRequestSet.updateMany({
        where: {
          id: {
            in: activeRequestSets.map(item => item.id),
          },
        },
        data: {
          status: "SUPERSEDED",
          resolvedAt: new Date(),
          supersededByRequestSetId: requestSet.id,
        },
      })

      if (supersededOperationIds.length > 0) {
        await tx.operation.updateMany({
          where: {
            id: {
              in: supersededOperationIds,
            },
            status: "PENDING",
          },
          data: {
            status: "FAILED",
            failureReason: "PERMISSION_REQUEST_SUPERSEDED",
            failureMessage: "Permission request was superseded by a newer request",
            resolvedAt: new Date(),
          },
        })
      }
    }

    return {
      operationId: operationRecord.id,
      shouldStartWorkflow: true,
      supersededOperationIds,
    }
  })

  if (requestOutcome.supersededOperationIds.length > 0) {
    for (const supersededOperationId of requestOutcome.supersededOperationIds) {
      try {
        await temporalClient.workflow
          .getHandle(`approve-permission-request-set-${supersededOperationId}`)
          .cancel()
      } catch (error) {
        if (isGrpcServiceError(error) && error.code === GrpcStatus.NOT_FOUND) {
          continue
        }

        throw error
      }
    }
  }

  if (requestOutcome.operationId === undefined) {
    logger.info(
      'request.requestPermissions subject="%s" resolved immediately with existing bindings',
      effectiveSubjectId,
    )

    return {
      operation: undefined,
    }
  }

  if (!requestOutcome.shouldStartWorkflow) {
    logger.info(
      "reusing existing pending permission request operation %d",
      requestOutcome.operationId,
    )

    return {
      operation: await operationService.toApiOperation(requestOutcome.operationId),
    }
  }

  logger.info(
    "starting approval workflow for permission request operation %d",
    requestOutcome.operationId,
  )

  await temporalClient.workflow.start("approvePermissionRequestSetWorkflow", {
    args: [{ operationId: requestOutcome.operationId }],
    workflowId: `approve-permission-request-set-${requestOutcome.operationId}`,
    workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
    taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
  })

  return {
    operation: await operationService.toApiOperation(requestOutcome.operationId),
  }
}

function deduplicatePermissionItems(
  items: Array<{
    permissionId: number
    scope: string | undefined
  }>,
): Array<{
  permissionId: number
  scope: string | undefined
}> {
  const deduplicatedItems = new Map<string, { permissionId: number; scope: string | undefined }>()

  for (const item of items) {
    deduplicatedItems.set(toPermissionItemKey(item.permissionId, item.scope), item)
  }

  return [...deduplicatedItems.values()]
}

function toPermissionItemKey(permissionId: number, scope: string | null | undefined): string {
  return `${permissionId}|${scope ?? ""}`
}

function hasMatchingBinding(
  bindings: Array<{
    permissionId: number
    scope: string | null
  }>,
  item: {
    permissionId: number
    scope: string | undefined
  },
): boolean {
  const exactMatch = bindings.some(
    binding => binding.permissionId === item.permissionId && binding.scope === (item.scope ?? null),
  )
  if (exactMatch) {
    return true
  }

  if (item.scope === undefined) {
    return false
  }

  return bindings.some(
    binding => binding.permissionId === item.permissionId && binding.scope === null,
  )
}

function hasExactPermissionItems(
  existingItems: Array<{
    permissionId: number
    scope: string | null
  }>,
  requestedItems: Array<{
    permissionId: number
    scope: string | undefined
  }>,
): boolean {
  if (existingItems.length !== requestedItems.length) {
    return false
  }

  const existingKeys = new Set(
    existingItems.map(item => toPermissionItemKey(item.permissionId, item.scope)),
  )

  return requestedItems.every(item =>
    existingKeys.has(toPermissionItemKey(item.permissionId, item.scope)),
  )
}

function assertValidSubjectId(value: string, fieldName: string): void {
  if (!isSubjectId(value)) {
    throw new ConnectError(`${fieldName} must be in format "{realm}:{name}"`, Code.InvalidArgument)
  }
}

function isSubjectId(value: string): boolean {
  const segments = value.split(":")
  if (segments.length !== 2) {
    return false
  }

  const realm = segments[0]
  const name = segments[1]
  if (realm === undefined || name === undefined) {
    return false
  }

  return realm.length > 0 && name.length > 0
}

function formatRequestedPermissionsForLog(
  items: Array<{
    permissionName: string
    scope?: string
  }>,
): string {
  if (items.length === 0) {
    return "[]"
  }

  return items
    .map(item => {
      const scope = item.scope ?? "<global>"
      return `${item.permissionName}[${scope}]`
    })
    .join(", ")
}

function formatMissingPermissionItemsForLog(
  items: Array<{
    permissionId: number
    scope: string | undefined
  }>,
  permissionNamesById: Map<number, string>,
): string {
  if (items.length === 0) {
    return "[]"
  }

  return items
    .map(item => {
      const permissionName =
        permissionNamesById.get(item.permissionId) ?? `<unknown:${item.permissionId}>`
      const scope = item.scope ?? "<global>"
      return `${permissionName}[${scope}]`
    })
    .join(", ")
}
