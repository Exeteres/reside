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
const EXISTENCE_ACTION_HINT = "REAPER_ACTION_HINT_EXISTENCE"
const CRITICAL_ACTION_HINT = "REAPER_ACTION_HINT_CRITICAL"

type PlannedAction = ReaperPlannedAction & {
  handler: RegisteredReaperHandler
}

type TrackedActionStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "SKIPPED"

type ReaperNotificationTaskStatus = "PLANNED" | TrackedActionStatus

type TrackedAction = PlannedAction & {
  status: TrackedActionStatus
  operation?: StartedReaperExecution["operation"]
}

type ReaperActionPlan = {
  notificationId: string
  trackedActions: TrackedAction[]
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
    const targetHandlers = handlers.filter(
      handler => handler.resourceReplicaName === targetReplicaName,
    )
    const otherHandlers = handlers.filter(
      handler => handler.resourceReplicaName !== targetReplicaName,
    )
    const plans: ReaperActionPlan[] = []

    const targetPlan = await requestHandlerActionPlan({
      handlers: targetHandlers,
      targetReplicaName,
      contextToken: invocation.context?.token,
    })
    if (targetPlan) {
      plans.push(targetPlan)
      applyActionHintSelectionRules(targetPlan.trackedActions)
      await executeActionPhase({
        targetReplicaName,
        notificationId: targetPlan.notificationId,
        trackedActions: targetPlan.trackedActions,
        actions: targetPlan.trackedActions.filter(action => isPendingRegularAction(action)),
      })
    }

    const otherPlan = await requestHandlerActionPlan({
      handlers: otherHandlers,
      targetReplicaName,
      contextToken: invocation.context?.token,
    })
    if (otherPlan) {
      plans.push(otherPlan)
    }

    const trackedActions = plans.flatMap(plan => plan.trackedActions)
    applyActionHintSelectionRules(trackedActions)

    if (trackedActions.length === 0) {
      await sendNotification({
        contextToken: invocation.context?.token,
        system: invocation.context?.token === undefined,
        channel: ReaperNotificationChannels.COMMAND,
        title: strings.notifications.kill.emptyTitle(targetReplicaName),
      })
      return
    }

    if (otherPlan) {
      await executeActionPhase({
        targetReplicaName,
        notificationId: otherPlan.notificationId,
        trackedActions: otherPlan.trackedActions,
        actions: otherPlan.trackedActions.filter(action => isPendingRegularAction(action)),
      })
    }

    await executeExistenceActions({
      targetReplicaName,
      plans,
      trackedActions,
    })
  },
})

async function requestHandlerActionPlan(input: {
  handlers: RegisteredReaperHandler[]
  targetReplicaName: string
  contextToken: string | undefined
}): Promise<ReaperActionPlan | undefined> {
  const plannedActions = await previewAllHandlers(input.handlers, input.targetReplicaName)
  if (plannedActions.length === 0) {
    return undefined
  }

  const selectedTaskIds = await requestActionSelection({
    targetReplicaName: input.targetReplicaName,
    plannedActions,
    contextToken: input.contextToken,
  })

  const trackedActions = plannedActions.map(action => ({
    ...action,
    status: selectedTaskIds.has(action.id) ? "PENDING" : "SKIPPED",
  })) satisfies TrackedAction[]

  return {
    notificationId: selectedTaskIds.notificationId,
    trackedActions,
  }
}

async function executeActionPhase(input: {
  targetReplicaName: string
  notificationId: string
  trackedActions: TrackedAction[]
  actions: TrackedAction[]
}): Promise<void> {
  if (input.actions.length === 0) {
    return
  }

  const notification = await updateNotification({
    notificationId: input.notificationId,
    title: strings.notifications.kill.executingTitle(input.targetReplicaName),
    content: block(strings.notifications.kill.planningMessage),
    status: NotificationStatus.IN_PROGRESS,
    taskGroups: buildTaskGroups(input.trackedActions),
    expectImmediateFeedback: true,
  })

  await executeActions(input.actions)
  await pollOperations({
    targetReplicaName: input.targetReplicaName,
    notificationId: notification.notificationId,
    trackedActions: input.trackedActions,
    pollActions: input.actions,
  })
}

async function executeExistenceActions(input: {
  targetReplicaName: string
  plans: ReaperActionPlan[]
  trackedActions: TrackedAction[]
}): Promise<void> {
  const existenceActions = input.trackedActions.filter(action => isPendingExistenceAction(action))
  if (existenceActions.length === 0) {
    return
  }

  if (canExecuteExistenceActions(input.trackedActions)) {
    await executeActions(existenceActions)
    for (const plan of input.plans) {
      const planExistenceActions = plan.trackedActions.filter(action =>
        isSelectedExistenceAction(action),
      )
      if (planExistenceActions.length === 0) {
        continue
      }

      const notification = await updateNotification({
        notificationId: plan.notificationId,
        title: strings.notifications.kill.executingTitle(input.targetReplicaName),
        content: block(strings.notifications.kill.planningMessage),
        status: NotificationStatus.IN_PROGRESS,
        taskGroups: buildTaskGroups(plan.trackedActions),
        expectImmediateFeedback: true,
      })

      await pollOperations({
        targetReplicaName: input.targetReplicaName,
        notificationId: notification.notificationId,
        trackedActions: plan.trackedActions,
        pollActions: planExistenceActions,
      })
    }
    return
  }

  skipPendingActions(existenceActions)
  for (const plan of input.plans) {
    await updateProgressNotification({
      targetReplicaName: input.targetReplicaName,
      notificationId: plan.notificationId,
      trackedActions: plan.trackedActions,
    })
  }
}

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
    taskGroups: buildTaskGroups(input.plannedActions, "PLANNED"),
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

async function executeActions(selectedActions: TrackedAction[]): Promise<void> {
  if (selectedActions.length === 0) {
    return
  }

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
  pollActions: TrackedAction[]
}): Promise<void> {
  let previousStatusKey = ""

  while (hasActiveActions(input.pollActions)) {
    await sleep(OPERATION_POLL_DELAY_MS)
    await Promise.all(
      input.pollActions
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

export function buildTaskGroups(
  actions: (PlannedAction | TrackedAction)[],
  defaultStatus: ReaperNotificationTaskStatus = "PENDING",
): NotificationTaskGroupInput[] {
  const groups = new Map<string, NotificationTaskGroupInput>()
  for (const action of actions) {
    const group = groups.get(action.handler.resourceReplicaName) ?? {
      id: action.handler.resourceReplicaName,
      title: action.handler.title,
      tasks: [],
    }
    const status = "status" in action ? action.status : defaultStatus

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

function toNotificationTaskStatus(status: ReaperNotificationTaskStatus): NotificationTaskStatus {
  switch (status) {
    case "PLANNED":
      return NotificationTaskStatus.PLANNED
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

export function applyActionHintSelectionRules(actions: TrackedAction[]): void {
  for (const action of actions) {
    if (!isSelectedExistenceAction(action)) {
      continue
    }

    if (hasSkippedCriticalAction(actions)) {
      action.status = "SKIPPED"
    }
  }
}

function canExecuteExistenceActions(actions: TrackedAction[]): boolean {
  const existenceActions = actions.filter(action => isSelectedExistenceAction(action))
  if (existenceActions.length === 0) {
    return false
  }

  if (hasSkippedCriticalAction(actions)) {
    return false
  }

  return actions.every(action => {
    if (isExistenceAction(action)) {
      return true
    }

    if (action.status === "SKIPPED" && !isCriticalAction(action)) {
      return true
    }

    return action.status === "COMPLETED"
  })
}

function hasSkippedCriticalAction(actions: TrackedAction[]): boolean {
  return actions.some(action => isCriticalAction(action) && action.status === "SKIPPED")
}

function skipPendingActions(actions: TrackedAction[]): void {
  for (const action of actions) {
    if (action.status === "PENDING") {
      action.status = "SKIPPED"
    }
  }
}

function isPendingRegularAction(action: TrackedAction): boolean {
  return action.status === "PENDING" && !isExistenceAction(action)
}

function isPendingExistenceAction(action: TrackedAction): boolean {
  return action.status === "PENDING" && isExistenceAction(action)
}

function isSelectedExistenceAction(action: TrackedAction): boolean {
  return action.status !== "SKIPPED" && isExistenceAction(action)
}

function isExistenceAction(action: PlannedAction): boolean {
  return action.hints.includes(EXISTENCE_ACTION_HINT)
}

function isCriticalAction(action: PlannedAction): boolean {
  return action.hints.includes(CRITICAL_ACTION_HINT)
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
