import {
  acceptNotificationResponse,
  block,
  closeNotificationTopic,
  createNotificationTopic,
  defineCommandHandler,
  renderMarkdownAsTelegramHtml,
  reopenNotificationTopic,
  sendNotification,
  updateNotification,
  updateNotificationTopic,
} from "@reside/common/workflow"
import {
  log,
  ParentClosePolicy,
  proxyActivities,
  setHandler,
  startChild,
  uuid4,
} from "@temporalio/workflow"
import {
  createTaskCommand,
  EngineerNotificationChannels,
  type EngineerTaskActivities,
  type PrepareTaskWorkflowInput,
  type PrepareTaskWorkflowOutput,
  type RunImplementationInteractionOutput,
  type StartPlanningInteractionOutput,
  type TaskFeedbackSignalInput,
  type TaskWorkflowInput,
  taskFeedbackSignal,
  taskStartImplementationSignal,
} from "../definitions"
import { strings } from "../locale"

const {
  generateTaskPreviewTitle,
  startPlanningInteraction,
  submitPlanningFeedbackInteraction,
  approveTask,
  requestCancellation,
  runImplementationInteraction,
  retryTask,
} = proxyActivities<EngineerTaskActivities>({
  scheduleToCloseTimeout: "30 minutes",
  retry: {
    maximumAttempts: 2,
  },
})

export const createTaskCommandHandler = defineCommandHandler({
  command: createTaskCommand,
  async handler({ params, invocation }) {
    if (!invocation.subjectId) {
      throw new Error("Command invocation is missing subjectId")
    }

    const mode = invocation.parameters?.mode === "implement" ? "implement" : "plan"
    let preparation: PrepareTaskWorkflowOutput
    try {
      preparation = await startTaskPreparationChild({
        subjectId: invocation.subjectId,
        prompt: params.task,
        mode,
      })
    } catch (error) {
      await sendNotification({
        contextToken: invocation.context?.token,
        system: invocation.context?.token === undefined,
        channel: EngineerNotificationChannels.TASKS,
        title: strings.notifications.taskCreationFailed.title,
        message: block(
          strings.notifications.taskCreationFailed.message(normalizeWorkflowErrorMessage(error)),
        ),
      })

      throw error
    }

    await sendNotification({
      contextToken: invocation.context?.token,
      system: invocation.context?.token === undefined,
      channel: EngineerNotificationChannels.TASKS,
      title: strings.notifications.taskCreated.title,
      actions: {
        open: {
          title: strings.notifications.taskCreated.actions.open,
          url: preparation.messageLink,
        },
      },
    })

    await startTaskWorkflowChild({
      subjectId: invocation.subjectId,
      prompt: params.task,
      mode,
      ...preparation,
    })
  },
})

export async function prepareTaskWorkflow({
  subjectId: _subjectId,
  prompt,
  mode,
}: PrepareTaskWorkflowInput): Promise<PrepareTaskWorkflowOutput> {
  const title = (await generateTaskPreviewTitle({ prompt })).title
  const topic = await createNotificationTopic({
    channel: EngineerNotificationChannels.TASKS,
    title,
    createAsSubjectId: "replica:engineer",
  })
  const progress = await sendNotification({
    topicId: topic.topicId,
    acquireTopic: true,
    waitForResponse: false,
    title:
      mode === "implement"
        ? strings.notifications.taskExecution.inProgressTitle
        : strings.notifications.taskPlanning.inProgressTitle,
    actions: {
      cancel: {
        title: strings.notifications.taskExecution.actions.cancel,
      },
    },
  })

  return {
    topicId: topic.topicId,
    notificationId: progress.notificationId,
    messageLink: progress.messageLink,
    previewTitle: title,
  }
}

export async function taskWorkflow(input: TaskWorkflowInput): Promise<void> {
  const feedbackQueue: TaskFeedbackSignalInput[] = []
  let startImplementationRequested = input.mode === "implement"

  setHandler(taskFeedbackSignal, feedback => {
    feedbackQueue.push(feedback)
  })
  setHandler(taskStartImplementationSignal, () => {
    startImplementationRequested = true
  })

  let lastPlanning = await runPlanningCycle({
    progressNotificationId: input.notificationId,
    prompt: input.prompt,
    subjectId: input.subjectId,
    topicId: input.topicId,
    previewTitle: input.previewTitle,
    first: true,
    feedbackQueue,
  })
  let taskId = lastPlanning.taskId
  let planningPromptForRetry = input.prompt

  while (lastPlanning.status === "FAILED") {
    await waitForFailedIterationRetry({
      topicId: input.topicId,
      errorMessage: lastPlanning.errorMessage,
    })
    await reopenTaskForRetry(input.topicId, taskId)

    const notification = await sendPlanningProgressNotification(input.topicId)
    lastPlanning = await runPlanningFeedbackCycle({
      notificationId: notification.notificationId,
      taskId,
      feedback: planningPromptForRetry,
      feedbackQueue,
    })
    taskId = lastPlanning.taskId
  }

  let readyPlanning = requireReadyPlanning(lastPlanning)

  if (readyPlanning.issueTitle !== input.previewTitle) {
    await updateNotificationTopic({ topicId: input.topicId, title: readyPlanning.issueTitle })
  }

  while (true) {
    const reply = await updateNotification({
      notificationId: readyPlanning.notificationId,
      title: strings.notifications.taskPlanning.readyTitle,
      content: renderMarkdownAsTelegramHtml(readyPlanning.resultSummary),
      actions: {
        issue: {
          title: strings.notifications.taskPlanning.actions.issue,
          url: readyPlanning.issueUrl,
        },
        approve: {
          title: strings.notifications.taskPlanning.actions.approve,
        },
        cancel: {
          title: strings.notifications.taskPlanning.actions.cancel,
        },
      },
      requiresTextResponse: true,
    })

    if (reply.type === "action" && reply.actionName === "cancel") {
      await requestCancellation({ taskId })
      await closeTaskTopic(input.topicId)
      return
    }

    if (reply.type === "action" && reply.actionName === "approve") {
      startImplementationRequested = true
    }

    if (reply.type === "text") {
      feedbackQueue.push({ text: reply.text, contextToken: reply.contextToken })
    }

    if (!startImplementationRequested) {
      const feedback = consumeQueuedFeedback(feedbackQueue)
      if (feedback === undefined) {
        continue
      }
      planningPromptForRetry = feedback

      const notification = await sendPlanningProgressNotification(input.topicId)

      let planningResult = await runPlanningFeedbackCycle({
        notificationId: notification.notificationId,
        taskId,
        feedback,
        feedbackQueue,
      })
      taskId = planningResult.taskId

      while (planningResult.status === "FAILED") {
        await waitForFailedIterationRetry({
          topicId: input.topicId,
          errorMessage: planningResult.errorMessage,
        })
        await reopenTaskForRetry(input.topicId, taskId)

        const retryNotification = await sendPlanningProgressNotification(input.topicId)
        planningResult = await runPlanningFeedbackCycle({
          notificationId: retryNotification.notificationId,
          taskId,
          feedback: planningPromptForRetry,
          feedbackQueue,
        })
        taskId = planningResult.taskId
      }

      readyPlanning = requireReadyPlanning(planningResult)
      if (readyPlanning.issueTitle !== input.previewTitle) {
        await updateNotificationTopic({ topicId: input.topicId, title: readyPlanning.issueTitle })
      }
      continue
    }

    await approveTask({ taskId })

    let implementationPrompt = strings.notifications.taskExecution.initialPrompt
    const queuedFeedback = consumeQueuedFeedback(feedbackQueue)
    if (queuedFeedback !== undefined) {
      implementationPrompt = queuedFeedback
    }

    while (true) {
      const notification = await sendNotification({
        topicId: input.topicId,
        acquireTopic: true,
        waitForResponse: false,
        title: strings.notifications.taskExecution.inProgressTitle,
        actions: {
          cancel: {
            title: strings.notifications.taskExecution.actions.cancel,
          },
        },
      })

      const result = await runImplementationCycle({
        notificationId: notification.notificationId,
        taskId,
        prompt: implementationPrompt,
        feedbackQueue,
      })

      if (result.status === "CANCELLED") {
        await updateNotification({
          notificationId: notification.notificationId,
          title: strings.notifications.taskExecution.doneTitle,
          content: block(strings.notifications.taskExecution.cancelledSummary),
          actions: {},
          requiresTextResponse: false,
        })
        await closeTaskTopic(input.topicId)
        return
      }

      if (result.status === "COMPLETED") {
        await updateNotification({
          notificationId: notification.notificationId,
          title: strings.notifications.taskExecution.doneTitle,
          content: renderMarkdownAsTelegramHtml(
            result.resultSummary ?? strings.notifications.taskExecution.defaultSummary,
          ),
          actions: {},
          requiresTextResponse: false,
        })
        await closeTaskTopic(input.topicId)
        return
      }

      await updateNotification({
        notificationId: notification.notificationId,
        title: strings.notifications.taskExecution.failedTitle,
        content: renderMarkdownAsTelegramHtml(
          result.errorMessage ?? strings.notifications.taskExecution.defaultFailure,
        ),
        actions: {},
        requiresTextResponse: false,
      })

      await waitForFailedIterationRetry({
        topicId: input.topicId,
        errorMessage: result.errorMessage,
      })
      await reopenTaskForRetry(input.topicId, taskId)
    }
  }
}

async function closeTaskTopic(topicId: string): Promise<void> {
  try {
    await closeNotificationTopic(topicId)
  } catch (error) {
    log.error("failed to close task topic", {
      topicId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function reopenTaskForRetry(topicId: string, taskId: string): Promise<void> {
  await reopenNotificationTopic(topicId)
  await retryTask({ taskId })
}

async function waitForFailedIterationRetry(input: {
  topicId: string
  errorMessage?: string
}): Promise<void> {
  const notification = await sendNotification({
    topicId: input.topicId,
    waitForResponse: false,
    title: strings.notifications.taskExecution.failedTitle,
    message: renderMarkdownAsTelegramHtml(
      input.errorMessage ?? strings.notifications.taskExecution.defaultFailure,
    ),
    actions: {
      retry: {
        title: strings.notifications.taskExecution.actions.retry,
      },
    },
  })

  await closeTaskTopic(input.topicId)

  const reply = await acceptNotificationResponse<{
    retry: { title: string }
  }>({
    notificationId: notification.notificationId,
  })

  if (reply.type !== "action" || reply.actionName !== "retry") {
    throw new Error("Unexpected failed iteration retry response")
  }
}

async function sendPlanningProgressNotification(topicId: string) {
  return await sendNotification({
    topicId,
    acquireTopic: true,
    waitForResponse: false,
    title: strings.notifications.taskPlanning.inProgressTitle,
    actions: {
      cancel: {
        title: strings.notifications.taskExecution.actions.cancel,
      },
    },
  })
}

function requireReadyPlanning(result: StartPlanningInteractionOutput & { notificationId: string }) {
  if (result.status !== "PLAN_READY") {
    throw new Error("Planning interaction is not ready")
  }

  const issueTitle = result.issueTitle
  const issueUrl = result.issueUrl
  const repositoryUrl = result.repositoryUrl
  const resultSummary = result.resultSummary
  if (!issueTitle || !issueUrl || !repositoryUrl || !resultSummary) {
    throw new Error("Planning interaction result is missing issue details")
  }

  return {
    ...result,
    issueTitle,
    issueUrl,
    repositoryUrl,
    resultSummary,
  }
}

async function startTaskPreparationChild(
  input: PrepareTaskWorkflowInput,
): Promise<PrepareTaskWorkflowOutput> {
  const handle = await startChild(prepareTaskWorkflow, {
    workflowId: `prepare-task-${uuid4()}`,
    args: [input],
  })

  return await handle.result()
}

async function startTaskWorkflowChild(input: TaskWorkflowInput): Promise<void> {
  await startChild(taskWorkflow, {
    workflowId: `task-${input.topicId}`,
    args: [input],
    parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_ABANDON,
  })
}

async function runPlanningCycle(input: {
  progressNotificationId: string
  prompt: string
  subjectId: string
  topicId: string
  previewTitle: string
  first: true
  feedbackQueue: TaskFeedbackSignalInput[]
}) {
  let finished = false
  const runPromise = startPlanningInteraction({
    subjectId: input.subjectId,
    prompt: input.prompt,
    progressNotificationId: input.progressNotificationId,
    topicId: input.topicId,
    previewTitle: input.previewTitle,
  }).finally(() => {
    finished = true
  })

  await collectBusyFeedback(input.progressNotificationId, input.feedbackQueue, () => finished)

  return {
    notificationId: input.progressNotificationId,
    ...(await runPromise),
  }
}

async function runPlanningFeedbackCycle(input: {
  notificationId: string
  taskId: string
  feedback: string
  feedbackQueue: TaskFeedbackSignalInput[]
}) {
  let finished = false
  const runPromise = submitPlanningFeedbackInteraction({
    progressNotificationId: input.notificationId,
    taskId: input.taskId,
    feedback: input.feedback,
  }).finally(() => {
    finished = true
  })

  await collectBusyFeedback(
    input.notificationId,
    input.feedbackQueue,
    () => finished,
    async () => {
      await requestCancellation({ taskId: input.taskId })
    },
  )

  return {
    notificationId: input.notificationId,
    ...(await runPromise),
  }
}

async function runImplementationCycle(input: {
  notificationId: string
  taskId: string
  prompt: string
  feedbackQueue: TaskFeedbackSignalInput[]
}): Promise<RunImplementationInteractionOutput> {
  let finished = false
  const runPromise = runImplementationInteraction({
    progressNotificationId: input.notificationId,
    taskId: input.taskId,
    prompt: input.prompt,
  }).finally(() => {
    finished = true
  })

  await collectBusyFeedback(
    input.notificationId,
    input.feedbackQueue,
    () => finished,
    async () => {
      await requestCancellation({ taskId: input.taskId })
    },
  )

  return await runPromise
}

async function collectBusyFeedback(
  notificationId: string,
  feedbackQueue: TaskFeedbackSignalInput[],
  isFinished: () => boolean,
  onCancel?: () => Promise<void>,
): Promise<void> {
  while (!isFinished()) {
    const reply = await acceptNotificationResponse<
      { cancel: { title: string } },
      true,
      () => boolean
    >({
      notificationId,
      cancelWhen: isFinished,
    })

    if (reply.type === "cancelled") {
      return
    }

    if (reply.type === "action" && reply.actionName === "cancel") {
      await onCancel?.()
      return
    }

    if (reply.type === "text") {
      feedbackQueue.push({ text: reply.text, contextToken: reply.contextToken })
    }
  }
}

function consumeQueuedFeedback(feedbackQueue: TaskFeedbackSignalInput[]): string | undefined {
  if (feedbackQueue.length === 0) {
    return undefined
  }

  const text = feedbackQueue
    .map(feedback => feedback.text.trim())
    .filter(Boolean)
    .join("\n\n")
  feedbackQueue.splice(0, feedbackQueue.length)

  return text.length === 0 ? undefined : text
}

function normalizeWorkflowErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim()
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim()
  }

  return strings.notifications.taskCreationFailed.defaultMessage
}
