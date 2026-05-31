import { defineCommandHandler, sendNotification, updateNotification } from "@reside/common/workflow"
import { proxyActivities } from "@temporalio/workflow"
import {
  AlphaNotificationChannels,
  type RegisteredReplicaSummary,
  type ReplicaManagementActivities,
  replicasCommand,
} from "../definitions"
import { strings } from "../locale"

const { listRegisteredReplicas } = proxyActivities<ReplicaManagementActivities>({
  startToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "1 second",
    maximumInterval: "30 seconds",
  },
})

const BACK_ACTION_NAME = "back"

export const replicasCommandHandler = defineCommandHandler({
  command: replicasCommand,
  async handler() {
    let { replicas } = await listRegisteredReplicas()

    if (replicas.length === 0) {
      await sendNotification({
        channel: AlphaNotificationChannels.REPLICAS,
        title: strings.workflows.replicas.empty.title,
        message: strings.workflows.replicas.empty.message,
        expectImmediateFeedback: true,
      })
      return
    }

    let listActions = buildReplicaListActions(replicas)

    let response = await sendNotification({
      channel: AlphaNotificationChannels.REPLICAS,
      title: strings.workflows.replicas.list.title,
      message: strings.workflows.replicas.list.message(replicas.length),
      actions: listActions,
      expectImmediateFeedback: true,
    })

    while (response.type === "action") {
      const selectedIndex = parseReplicaActionIndex(response.actionName)
      if (selectedIndex === undefined) {
        return
      }

      const selectedReplica = replicas[selectedIndex]
      if (!selectedReplica) {
        return
      }

      const replicaDetails = renderReplicaDetails(selectedReplica)

      response = await updateNotification({
        notificationId: response.notificationId,
        title: strings.workflows.replicas.details.title(selectedReplica.title),
        content: replicaDetails,
        actions: {
          [BACK_ACTION_NAME]: {
            title: strings.workflows.replicas.details.back,
          },
        },
        expectImmediateFeedback: true,
      })

      if (response.type !== "action" || response.actionName !== BACK_ACTION_NAME) {
        return
      }

      ;({ replicas } = await listRegisteredReplicas())
      if (replicas.length === 0) {
        await updateNotification({
          notificationId: response.notificationId,
          title: strings.workflows.replicas.empty.title,
          content: strings.workflows.replicas.empty.message,
          actions: {},
          expectImmediateFeedback: true,
        })
        return
      }

      listActions = buildReplicaListActions(replicas)

      response = await updateNotification({
        notificationId: response.notificationId,
        title: strings.workflows.replicas.list.title,
        content: strings.workflows.replicas.list.message(replicas.length),
        actions: listActions,
        expectImmediateFeedback: true,
      })
    }
  },
})

function buildReplicaListActions(
  replicas: RegisteredReplicaSummary[],
): Record<string, { title: string }> {
  return Object.fromEntries(
    replicas.map((replica, index) => [
      getReplicaActionName(index),
      {
        title: replica.title,
      },
    ]),
  )
}

function getReplicaActionName(index: number): string {
  return `replica_${index}`
}

function parseReplicaActionIndex(actionName: string): number | undefined {
  if (!actionName.startsWith("replica_")) {
    return undefined
  }

  const suffix = actionName.slice("replica_".length)
  const index = Number(suffix)

  if (!Number.isInteger(index) || index < 0) {
    return undefined
  }

  return index
}

function renderReplicaDetails(replica: RegisteredReplicaSummary): string {
  const lines = [
    strings.workflows.replicas.details.name(replica.name),
    strings.workflows.replicas.details.internalEndpoint(replica.internalEndpoint),
  ]

  if (replica.description !== null) {
    lines.push(strings.workflows.replicas.details.description(replica.description))
  }

  if (replica.image !== null) {
    lines.push(strings.workflows.replicas.details.image(replica.image))
  }

  if (replica.publicEndpoint !== null) {
    lines.push(strings.workflows.replicas.details.publicEndpoint(replica.publicEndpoint))
  }

  if (replica.node !== null) {
    lines.push(strings.workflows.replicas.details.node(replica.node))
  }

  return lines.join("\n")
}
