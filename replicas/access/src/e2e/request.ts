import type { DefinitionServiceClient } from "@reside/api/access/definition.v1"
import type { PermissionRequestServiceClient } from "@reside/api/access/request.v1"
import type { PrismaClient } from "../database"
import type { AccessE2EScope } from "./scope"
import { type OperationServiceClient, OperationStatus } from "@reside/api/common/operation.v1"
import { logger } from "@reside/common"
import { strings } from "../locale"

const REQUEST_SCOPE = "report:e2e-request-scope"
const REQUEST_SCOPE_REUSE = "report:e2e-request-reuse"
const REQUEST_SCOPE_SUPERSEDE_A = "report:e2e-request-supersede-a"
const REQUEST_SCOPE_SUPERSEDE_B = "report:e2e-request-supersede-b"

export async function assertRequestApi(
  permissionRequestService: PermissionRequestServiceClient,
  operationStatusService: OperationServiceClient,
  definitionService: DefinitionServiceClient,
  prisma: PrismaClient,
  e2eApprovalEndpoint: string,
  scope: AccessE2EScope,
): Promise<void> {
  const scopedSubjectId = scope.requestScopedSubjectId
  const globalSubjectId = scope.requestGlobalSubjectId

  await prisma.realm.upsert({
    where: {
      name: scope.realmName,
    },
    create: {
      name: scope.realmName,
      title: "E2E realm",
      description: "Realm for access e2e approver filtering",
    },
    update: {
      title: "E2E realm",
      description: "Realm for access e2e approver filtering",
    },
  })

  await prisma.approver.upsert({
    where: {
      name: scope.approverName,
    },
    create: {
      name: scope.approverName,
      priority: scope.approverPriority,
      realms: {
        connect: scope.approverRealms.map(name => ({ name })),
      },
      title: strings.e2e.localApproverTitle,
      description: strings.e2e.localApproverDescription,
      callbackEndpoint: e2eApprovalEndpoint,
    },
    update: {
      priority: scope.approverPriority,
      realms: {
        set: scope.approverRealms.map(name => ({ name })),
      },
      title: strings.e2e.localApproverTitle,
      description: strings.e2e.localApproverDescription,
      callbackEndpoint: e2eApprovalEndpoint,
    },
  })

  await definitionService.putPermissions({
    permissions: [
      {
        name: scope.requestScopedPermissionName,
        title: "Request reports",
        description: "Scoped permission used for request api e2e validation",
        scoped: true,
      },
      {
        name: scope.requestGlobalPermissionName,
        title: "Request global reports",
        description: "Global permission used for request api e2e validation",
        scoped: false,
      },
    ],
  })

  const createdRequestResponse = await permissionRequestService.requestPermissions({
    subjectId: scopedSubjectId,
    items: [
      {
        permissionName: scope.requestScopedPermissionName,
        scope: REQUEST_SCOPE,
      },
    ],
    reason: "Need access for e2e request validation",
    permissionSetName: scope.requestScopedPermissionSetName,
  })

  if (!createdRequestResponse.operation) {
    throw new Error("Request operation must be returned when permissions are missing")
  }

  const completedRequestOperation = await waitForOperationCompletion(
    operationStatusService,
    createdRequestResponse.operation.id,
  )

  if (completedRequestOperation.status !== OperationStatus.COMPLETED) {
    throw new Error(
      `Permission request operation must be completed, got status=${OperationStatus[completedRequestOperation.status]}`,
    )
  }

  const storedRequestSet = await prisma.permissionRequestSet.findFirst({
    where: {
      permissionSetName: scope.requestScopedPermissionSetName,
      subjectId: scopedSubjectId,
    },
    include: {
      permissionSet: true,
      items: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  })

  if (!storedRequestSet) {
    throw new Error("Created permission request set was not stored in the replica database")
  }

  if (storedRequestSet.items.length !== 1 || storedRequestSet.items[0]?.scope !== REQUEST_SCOPE) {
    throw new Error("Stored request set must contain the requested scope-scoped permission")
  }

  if (!storedRequestSet.permissionSet) {
    throw new Error("Stored request set must be linked to a permission set")
  }

  const createdGlobalRequestResponse = await permissionRequestService.requestPermissions({
    subjectId: globalSubjectId,
    items: [
      {
        permissionName: scope.requestGlobalPermissionName,
      },
    ],
    reason: "Need global access for e2e request validation",
    permissionSetName: scope.requestGlobalPermissionSetName,
  })

  if (!createdGlobalRequestResponse.operation) {
    throw new Error("Global request operation must be returned when permissions are missing")
  }

  const completedGlobalRequestOperation = await waitForOperationCompletion(
    operationStatusService,
    createdGlobalRequestResponse.operation.id,
  )

  if (completedGlobalRequestOperation.status !== OperationStatus.COMPLETED) {
    throw new Error(
      `Global permission request operation must be completed, got status=${OperationStatus[completedGlobalRequestOperation.status]}`,
    )
  }

  const storedGlobalRequestSet = await prisma.permissionRequestSet.findFirst({
    where: {
      permissionSetName: scope.requestGlobalPermissionSetName,
      subjectId: globalSubjectId,
    },
    include: {
      permissionSet: true,
      items: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  })

  if (!storedGlobalRequestSet) {
    throw new Error("Created global permission request set was not stored in the replica database")
  }

  if (
    storedGlobalRequestSet.items.length !== 1 ||
    storedGlobalRequestSet.items[0]?.scope !== null
  ) {
    throw new Error("Global request set must be stored without a scope descriptor")
  }

  if (!storedGlobalRequestSet.permissionSet) {
    throw new Error("Stored global request set must be linked to a permission set")
  }

  const unreachableApproverEndpoint = "127.0.0.1:1"

  await prisma.approver.update({
    where: {
      name: scope.approverName,
    },
    data: {
      callbackEndpoint: unreachableApproverEndpoint,
    },
  })

  const firstReuseRequestResponse = await permissionRequestService.requestPermissions({
    subjectId: scope.requestReuseSubjectId,
    items: [
      {
        permissionName: scope.requestScopedPermissionName,
        scope: REQUEST_SCOPE_REUSE,
      },
    ],
    reason: "Need pending request reuse validation",
    permissionSetName: scope.requestReusePermissionSetName,
  })

  if (!firstReuseRequestResponse.operation) {
    throw new Error("First reuse request must return operation")
  }

  const secondReuseRequestResponse = await permissionRequestService.requestPermissions({
    subjectId: scope.requestReuseSubjectId,
    items: [
      {
        permissionName: scope.requestScopedPermissionName,
        scope: REQUEST_SCOPE_REUSE,
      },
    ],
    reason: "Need pending request reuse validation",
    permissionSetName: scope.requestReusePermissionSetName,
  })

  if (!secondReuseRequestResponse.operation) {
    throw new Error("Second reuse request must return operation")
  }

  if (firstReuseRequestResponse.operation.id !== secondReuseRequestResponse.operation.id) {
    throw new Error("Exact same pending permission request must reuse existing operation")
  }

  const reuseRequestSets = await prisma.permissionRequestSet.findMany({
    where: {
      permissionSetName: scope.requestReusePermissionSetName,
      subjectId: scope.requestReuseSubjectId,
    },
  })

  if (reuseRequestSets.length !== 1) {
    throw new Error("Exact same pending request must not create additional request sets")
  }

  const firstSupersedeRequestResponse = await permissionRequestService.requestPermissions({
    subjectId: scope.requestSupersedeSubjectId,
    items: [
      {
        permissionName: scope.requestScopedPermissionName,
        scope: REQUEST_SCOPE_SUPERSEDE_A,
      },
    ],
    reason: "Need supersede validation A",
    permissionSetName: scope.requestSupersedePermissionSetName,
  })

  if (!firstSupersedeRequestResponse.operation) {
    throw new Error("First supersede request must return operation")
  }

  const secondSupersedeRequestResponse = await permissionRequestService.requestPermissions({
    subjectId: scope.requestSupersedeSubjectId,
    items: [
      {
        permissionName: scope.requestScopedPermissionName,
        scope: REQUEST_SCOPE_SUPERSEDE_B,
      },
    ],
    reason: "Need supersede validation B",
    permissionSetName: scope.requestSupersedePermissionSetName,
  })

  if (!secondSupersedeRequestResponse.operation) {
    throw new Error("Second supersede request must return operation")
  }

  if (firstSupersedeRequestResponse.operation.id === secondSupersedeRequestResponse.operation.id) {
    throw new Error("Changed pending request must create a new operation")
  }

  const supersedeRequestSets = await prisma.permissionRequestSet.findMany({
    where: {
      permissionSetName: scope.requestSupersedePermissionSetName,
      subjectId: scope.requestSupersedeSubjectId,
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      id: true,
      status: true,
      supersededByRequestSetId: true,
      items: {
        select: {
          scope: true,
        },
      },
    },
  })

  if (supersedeRequestSets.length !== 2) {
    throw new Error("Supersede scenario must create exactly two request sets")
  }

  const firstSupersedeRequestSet = supersedeRequestSets[0]
  const secondSupersedeRequestSet = supersedeRequestSets[1]

  if (!firstSupersedeRequestSet || !secondSupersedeRequestSet) {
    throw new Error("Supersede scenario request sets were not found")
  }

  if (firstSupersedeRequestSet.status !== "SUPERSEDED") {
    throw new Error("First supersede request set must be marked as SUPERSEDED")
  }

  if (firstSupersedeRequestSet.supersededByRequestSetId !== secondSupersedeRequestSet.id) {
    throw new Error("First supersede request set must reference second request set as superseder")
  }

  if (secondSupersedeRequestSet.status !== "PENDING") {
    throw new Error("Second supersede request set must remain pending")
  }

  if (firstSupersedeRequestSet.items[0]?.scope !== REQUEST_SCOPE_SUPERSEDE_A) {
    throw new Error("First supersede request set must keep original requested scope")
  }

  if (secondSupersedeRequestSet.items[0]?.scope !== REQUEST_SCOPE_SUPERSEDE_B) {
    throw new Error("Second supersede request set must keep updated requested scope")
  }

  await operationStatusService.cancelOperation({
    operationId: firstReuseRequestResponse.operation.id,
  })

  await operationStatusService.cancelOperation({
    operationId: secondSupersedeRequestResponse.operation.id,
  })

  logger.info("permission request api e2e checks passed")
}

async function waitForOperationCompletion(
  operationStatusService: OperationServiceClient,
  operationId: number,
): Promise<{ status: OperationStatus }> {
  for (let attempt = 0; attempt < 120; attempt++) {
    const operationResponse = await operationStatusService.getOperation({ operationId })

    if (!operationResponse.operation) {
      throw new Error("Operation service must return operation payload")
    }

    if (
      operationResponse.operation.status === OperationStatus.COMPLETED ||
      operationResponse.operation.status === OperationStatus.FAILED
    ) {
      return {
        status: operationResponse.operation.status,
      }
    }

    await new Promise(resolve => setTimeout(resolve, 500))
  }

  return {
    status: OperationStatus.PENDING,
  }
}
