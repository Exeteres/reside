import type { NotificationTaskGroupInput } from "@reside/common/workflow"
import type {
  ReaperActivities,
  ReaperPlannedAction,
  RegisteredReaperHandler,
  StartedReaperExecution,
} from "../definitions"
import {
  NotificationActionIcon,
  NotificationStatus,
  NotificationTaskStatus,
} from "@reside/api/interaction/notification.v1"
import {
  acceptNotificationResponse,
  block,
  defineCommandHandler,
  sendNotification,
  updateNotification,
} from "@reside/common/workflow"
import { proxyActivities, sleep } from "@temporalio/workflow"
import { killCommand, ReaperNotificationChannels } from "../definitions"
import { strings } from "../locale"

const OPERATION_POLL_DELAY_MS = 2_000

type PlannedAction = ReaperPlannedAction & {
  handler: RegisteredReaperHandler
}

type TrackedActionStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "SKIPPED"

type TrackedAction = PlannedAction & {
  status: TrackedActionStatus
  operation?: StartedReaperExecution["operation"]
}

const { listReaperHandlers, previewHandlerActions, executeHandlerActions, getResourceOperation } =
  proxyActivities<ReaperActivities>({
    scheduleToCloseTimeout: "5 minutes",
    retry: {
      initialInterval: "3 seconds",
      backoffCoefficient: 2,
      maximumAttempts: 3,
    },
  })

export const killCommandHandler = defineCommandHandler({
  command: killCommand,
  async handler({ params, invocation }) {
    const targetReplicaName = normalizeReplicaName(params.replicaName)
    const { handlers } = await listReaperHandlers()
    const plannedActions = await previewAllHandlers(handlers, targetReplicaName)

    if (plannedActions.length === 0) {
      await sendNotification({
        contextToken: invocation.context?.token,
        system: invocation.context?.token === undefined,
        channel: ReaperNotificationChannels.COMMAND,
        title: strings.notifications.kill.emptyTitle(targetReplicaName),
      })
      return
    }

    const selectedTaskIds = await requestActionSelection({
      targetReplicaName,
      plannedActions,
      contextToken: invocation.context?.token,
    })

    const trackedActions = plannedActions.map(action => ({
      ...action,
      status: selectedTaskIds.has(action.id) ? "PENDING" : "SKIPPED",
    })) satisfies TrackedAction[]

    const notification = await updateNotification({
      notificationId: selectedTaskIds.notificationId,
      title: strings.notifications.kill.executingTitle(targetReplicaName),
      content: block(strings.notifications.kill.planningMessage),
      status: NotificationStatus.IN_PROGRESS,
      taskGroups: buildTaskGroups(trackedActions),
      expectImmediateFeedback: true,
    })

    await executeSelectedActions(trackedActions)
    await pollOperations({
      targetReplicaName,
      notificationId: notification.notificationId,
      trackedActions,
    })
  },
})

type SelectedTaskIds = Set<string> & {
  notificationId: string
}

async function previewAllHandlers(
  handlers: RegisteredReaperHandler[],
  targetReplicaName: string,
): Promise<PlannedAction[]> {
  const previews = await Promise.all(
    handlers.map(async handler => {
      const preview = await previewHandlerActions({
        callbackEndpoint: handler.callbackEndpoint,
        resourceReplicaName: handler.resourceReplicaName,
        targetReplicaName,
      })

      return preview.actions.map(action => ({
        ...action,
        handler,
      }))
    }),
  )

  return previews.flat()
}

async function requestActionSelection(input: {
  targetReplicaName: string
  plannedActions: PlannedAction[]
  contextToken: string | undefined
}): Promise<SelectedTaskIds> {
  const planning = await sendNotification({
    contextToken: input.contextToken,
    system: input.contextToken === undefined,
    channel: ReaperNotificationChannels.COMMAND,
    title: strings.notifications.kill.planningTitle(input.targetReplicaName),
    message: block(strings.notifications.kill.planningMessage),
    actions: {
      apply: {
        title: strings.notifications.kill.apply,
        icon: NotificationActionIcon.CONFIRMATION_ACTION_ICON_CHECK,
      },
    },
    status: NotificationStatus.PLANNING,
    taskGroups: buildTaskGroups(
      input.plannedActions.map(action => ({ ...action, status: "PENDING" })),
    ),
    protected: true,
    expectImmediateFeedback: true,
  })

  let response = planning
  while (response.type === "task_update") {
    response = await acceptNotificationResponse({
      notificationId: planning.notificationId,
    })
  }

  const skippedTaskIds = collectSkippedTaskIds(response.notification?.taskGroups ?? [])
  const selectedTaskIds = new Set(
    input.plannedActions.filter(action => !skippedTaskIds.has(action.id)).map(action => action.id),
  ) as SelectedTaskIds
  selectedTaskIds.notificationId = planning.notificationId

  return selectedTaskIds
}

async function executeSelectedActions(trackedActions: TrackedAction[]): Promise<void> {
  const selectedActions = trackedActions.filter(action => action.status !== "SKIPPED")
  const actionsByHandler = new Map<string, TrackedAction[]>()

  for (const action of selectedActions) {
    const actions = actionsByHandler.get(action.handler.resourceReplicaName) ?? []
    actions.push(action)
    actionsByHandler.set(action.handler.resourceReplicaName, actions)
  }

  const executions = await Promise.all(
    Array.from(actionsByHandler.values()).map(async actions => {
      const handler = actions[0]!.handler
      return await executeHandlerActions({
        callbackEndpoint: handler.callbackEndpoint,
        payloads: actions.map(action => action.payload),
      })
    }),
  )

  const executionByPayload = new Map(
    executions.flatMap(execution =>
      execution.executions.map(
        actionExecution => [actionExecution.payload, actionExecution] as const,
      ),
    ),
  )

  for (const action of selectedActions) {
    const execution = executionByPayload.get(action.payload)
    if (!execution) {
      action.status = "FAILED"
      continue
    }

    if (execution.completed) {
      action.status = "COMPLETED"
      continue
    }

    if (!execution.operation) {
      action.status = "FAILED"
      continue
    }

    action.operation = execution.operation
    action.status = mapOperationStatus(execution.operation.status)
  }
}

async function pollOperations(input: {
  targetReplicaName: string
  notificationId: string
  trackedActions: TrackedAction[]
}): Promise<void> {
  let previousStatusKey = ""

  while (hasActiveActions(input.trackedActions)) {
    await sleep(OPERATION_POLL_DELAY_MS)
    await Promise.all(
      input.trackedActions
        .filter(action => isActiveAction(action) && action.operation !== undefined)
        .map(async action => {
          const operation = await getResourceOperation({
            callbackEndpoint: action.handler.callbackEndpoint,
            operationId: getOperationId(action.operation),
          })
          action.operation = operation.operation
          action.status = mapOperationStatus(operation.operation.status)
        }),
    )

    const statusKey = buildStatusKey(input.trackedActions)
    if (statusKey === previousStatusKey) {
      continue
    }

    previousStatusKey = statusKey
    await updateProgressNotification(input)
  }

  await updateProgressNotification(input)
}

async function updateProgressNotification(input: {
  targetReplicaName: string
  notificationId: string
  trackedActions: TrackedAction[]
}): Promise<void> {
  const failed = input.trackedActions.some(action => action.status === "FAILED")
  const completed = !hasActiveActions(input.trackedActions)

  await updateNotification({
    notificationId: input.notificationId,
    title: failed
      ? strings.notifications.kill.failedTitle(input.targetReplicaName)
      : completed
        ? strings.notifications.kill.completedTitle(input.targetReplicaName)
        : strings.notifications.kill.executingTitle(input.targetReplicaName),
    content: block(strings.notifications.kill.planningMessage),
    status: failed
      ? NotificationStatus.FAILED
      : completed
        ? NotificationStatus.COMPLETED
        : NotificationStatus.IN_PROGRESS,
    taskGroups: buildTaskGroups(input.trackedActions),
    expectImmediateFeedback: true,
  })
}

function buildTaskGroups(actions: (PlannedAction | TrackedAction)[]): NotificationTaskGroupInput[] {
  const groups = new Map<string, NotificationTaskGroupInput>()
  for (const action of actions) {
    const group = groups.get(action.handler.resourceReplicaName) ?? {
      id: action.handler.resourceReplicaName,
      title: action.handler.title,
      tasks: [],
    }
    const status = "status" in action ? action.status : "PENDING"

    group.tasks.push({
      id: action.id,
      title: action.title,
      status: toNotificationTaskStatus(status),
    })
    groups.set(action.handler.resourceReplicaName, group)
  }

  return Array.from(groups.values())
}

function collectSkippedTaskIds(
  taskGroups: { tasks?: { id?: string; status?: string }[] }[],
): Set<string> {
  const skippedTaskIds = new Set<string>()
  for (const group of taskGroups) {
    for (const task of group.tasks ?? []) {
      if (task.id && task.status === "NOTIFICATION_TASK_STATUS_SKIPPED") {
        skippedTaskIds.add(task.id)
      }
    }
  }

  return skippedTaskIds
}

function mapOperationStatus(status: string | undefined): TrackedActionStatus {
  switch (status) {
    case "OPERATION_STATUS_PENDING":
      return "PENDING"
    case "OPERATION_STATUS_IN_PROGRESS":
      return "IN_PROGRESS"
    case "OPERATION_STATUS_COMPLETED":
      return "COMPLETED"
    case "OPERATION_STATUS_FAILED":
      return "FAILED"
    default:
      return "PENDING"
  }
}

function toNotificationTaskStatus(status: TrackedActionStatus): NotificationTaskStatus {
  switch (status) {
    case "PENDING":
      return NotificationTaskStatus.PENDING
    case "IN_PROGRESS":
      return NotificationTaskStatus.IN_PROGRESS
    case "COMPLETED":
      return NotificationTaskStatus.COMPLETED
    case "FAILED":
      return NotificationTaskStatus.FAILED
    case "SKIPPED":
      return NotificationTaskStatus.SKIPPED
  }
}

function getOperationId(operation: StartedReaperExecution["operation"] | undefined): number {
  if (operation?.id !== undefined) {
    return operation.id
  }

  throw new Error("Tracked reaper operation is missing operation id")
}

function hasActiveActions(actions: TrackedAction[]): boolean {
  return actions.some(action => isActiveAction(action))
}

function isActiveAction(action: TrackedAction): boolean {
  return action.status === "PENDING" || action.status === "IN_PROGRESS"
}

function buildStatusKey(actions: TrackedAction[]): string {
  return actions.map(action => `${action.id}:${action.status}`).join("|")
}

function normalizeReplicaName(replicaName: string): string {
  const normalizedReplicaName = replicaName.trim()
  if (/^[a-z][a-z0-9-]*$/.test(normalizedReplicaName)) {
    return normalizedReplicaName
  }

  throw new Error(`Invalid replica name "${replicaName}"`)
}
