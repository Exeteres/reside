import { isResideError } from "@reside/common/definitions"
import { defineCommandHandler, sendNotification } from "@reside/common/workflow"
import { proxyActivities } from "@temporalio/workflow"
import {
  AlphaNotificationChannels,
  NodeNotFoundError,
  type ReplicaManagementActivities,
  ReplicaNotFoundError,
  resetReplicaNodeCommand,
  setReplicaNodeCommand,
} from "../definitions"
import { strings } from "../locale"

const { resetReplicaNode, setReplicaNode } = proxyActivities<ReplicaManagementActivities>({
  startToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "1 second",
    maximumInterval: "30 seconds",
    nonRetryableErrorTypes: [NodeNotFoundError.name, ReplicaNotFoundError.name],
  },
})

export const setReplicaNodeCommandHandler = defineCommandHandler({
  command: setReplicaNodeCommand,
  async handler({ params }) {
    const replicaName = params.replica?.trim()
    const nodeName = params.node?.trim()

    if (!replicaName || !nodeName) {
      return
    }

    try {
      await setReplicaNode({
        replicaName,
        nodeName,
      })
    } catch (error) {
      await sendNodeCommandFailureNotification({
        replicaName,
        nodeName,
        error,
      })
      return
    }

    await sendNotification({
      channel: AlphaNotificationChannels.REPLICAS,
      title: strings.workflows.replicaNode.set.success.title,
      message: strings.workflows.replicaNode.set.success.message(replicaName, nodeName),
      expectImmediateFeedback: true,
    })
  },
})

export const resetReplicaNodeCommandHandler = defineCommandHandler({
  command: resetReplicaNodeCommand,
  async handler({ params }) {
    const replicaName = params.replica?.trim()

    if (!replicaName) {
      return
    }

    try {
      await resetReplicaNode({
        replicaName,
      })
    } catch (error) {
      await sendNodeCommandFailureNotification({
        replicaName,
        nodeName: undefined,
        error,
      })
      return
    }

    await sendNotification({
      channel: AlphaNotificationChannels.REPLICAS,
      title: strings.workflows.replicaNode.reset.success.title,
      message: strings.workflows.replicaNode.reset.success.message(replicaName),
      expectImmediateFeedback: true,
    })
  },
})

async function sendNodeCommandFailureNotification(args: {
  replicaName: string
  nodeName: string | undefined
  error: unknown
}): Promise<void> {
  const errorMessage = args.error instanceof Error ? args.error.message : String(args.error)

  if (isResideError(args.error, NodeNotFoundError.name) && args.nodeName) {
    await sendNotification({
      channel: AlphaNotificationChannels.REPLICAS,
      title: strings.workflows.replicaNode.failure.title,
      message: strings.workflows.replicaNode.failure.nodeNotFound(args.nodeName),
      expectImmediateFeedback: true,
    })
    return
  }

  if (isResideError(args.error, ReplicaNotFoundError.name)) {
    await sendNotification({
      channel: AlphaNotificationChannels.REPLICAS,
      title: strings.workflows.replicaNode.failure.title,
      message: strings.workflows.replicaNode.failure.replicaNotFound(args.replicaName),
      expectImmediateFeedback: true,
    })
    return
  }

  await sendNotification({
    channel: AlphaNotificationChannels.REPLICAS,
    title: strings.workflows.replicaNode.failure.title,
    message: strings.workflows.replicaNode.failure.generic(
      args.replicaName,
      args.nodeName,
      errorMessage,
    ),
    expectImmediateFeedback: true,
  })
}
