import {
  block,
  defineCommandHandler,
  sendNotification,
  updateNotification,
} from "@reside/common/workflow"
import { proxyActivities } from "@temporalio/workflow"
import { createTaskCommand, EngineerNotificationChannels } from "../definitions"
import { strings } from "../locale"

type PlanningResult = {
  taskId: string
  issueTitle: string
  issueUrl: string
  repositoryUrl: string
  resultSummary: string
}

type ImplementationResult = {
  taskId: string
  status: "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED"
  resultSummary?: string
  errorMessage?: string
}

const activities = proxyActivities<{
  startPlanningInteraction: (input: {
    subjectId: string
    prompt: string
    progressNotificationId: string
  }) => Promise<PlanningResult>
  submitPlanningFeedbackInteraction: (input: {
    taskId: string
    feedback: string
    progressNotificationId: string
  }) => Promise<PlanningResult>
  approveTask: (input: { taskId: string }) => Promise<void>
  requestCancellation: (input: { taskId: string }) => Promise<void>
  runImplementationInteraction: (input: {
    taskId: string
    prompt: string
    progressNotificationId: string
  }) => Promise<ImplementationResult>
  reviveTaskFromFeedback: (input: { taskId: string }) => Promise<void>
}>({ scheduleToCloseTimeout: "30 minutes" })

export const createTaskCommandHandler = defineCommandHandler({
  command: createTaskCommand,
  async handler({ params, invocation }) {
    if (!invocation.subjectId) {
      throw new Error("Command invocation is missing subjectId")
    }

    let planning = await runPlanningInteraction({
      prompt: params.task,
      subjectId: invocation.subjectId,
    })

    while (true) {
      const planningReply = await updateNotification<
        {
          approve: { title: string }
          cancel: { title: string }
        },
        true
      >({
        notificationId: planning.notificationId,
        title: strings.notifications.taskPlanning.readyTitle,
        content: block(
          strings.notifications.taskPlanning.readyMessage(
            planning.result.repositoryUrl,
            planning.result.issueUrl,
            planning.result.issueTitle,
            planning.result.resultSummary,
          ),
        ),
        actions: {
          approve: {
            title: strings.notifications.taskPlanning.actions.approve,
          },
          cancel: {
            title: strings.notifications.taskPlanning.actions.cancel,
          },
        },
        requiresTextResponse: true,
      })

      if (planningReply.type === "action") {
        if (planningReply.actionName === "cancel") {
          await activities.requestCancellation({
            taskId: planning.result.taskId,
          })

          await updateNotification({
            notificationId: planning.notificationId,
            title: strings.notifications.taskExecution.doneTitle,
            content: block(strings.notifications.taskExecution.cancelledSummary),
          })

          return
        }

        await activities.approveTask({
          taskId: planning.result.taskId,
        })

        break
      }

      planning = await runPlanningFeedbackInteraction({
        taskId: planning.result.taskId,
        feedback: planningReply.text,
      })
    }

    let implementationPrompt = strings.notifications.taskExecution.initialPrompt
    const taskId = planning.result.taskId

    while (true) {
      const implementationNotification = await sendNotification({
        channel: EngineerNotificationChannels.TASKS,
        title: strings.notifications.taskExecution.inProgressTitle,
        message: block(strings.notifications.taskExecution.inProgressMessage),
      })

      let finished: ImplementationResult | undefined
      const runPromise = activities
        .runImplementationInteraction({
          taskId,
          prompt: implementationPrompt,
          progressNotificationId: implementationNotification.notificationId,
        })
        .then(result => {
          finished = result
          return result
        })

      while (!finished) {
        const runningReply = await updateNotification<
          {
            cancel: { title: string }
          },
          true,
          () => boolean
        >({
          notificationId: implementationNotification.notificationId,
          title: strings.notifications.taskExecution.inProgressTitle,
          content: block(strings.notifications.taskExecution.runningAwaitingInput),
          actions: {
            cancel: {
              title: strings.notifications.taskExecution.actions.cancel,
            },
          },
          requiresTextResponse: true,
          cancelWhen: () => finished !== undefined,
        })

        if (runningReply.type === "cancelled") {
          break
        }

        if (runningReply.type === "action") {
          await activities.requestCancellation({ taskId })

          await updateNotification({
            notificationId: implementationNotification.notificationId,
            title: strings.notifications.taskExecution.inProgressTitle,
            content: block(strings.notifications.taskExecution.cancellationRequested),
          })

          continue
        }

        await updateNotification({
          notificationId: implementationNotification.notificationId,
          title: strings.notifications.taskExecution.inProgressTitle,
          content: block(strings.notifications.taskExecution.changeRejectedWhileRunning),
        })
      }

      const implementationResult = finished ?? (await runPromise)

      if (implementationResult.status === "COMPLETED") {
        await updateNotification({
          notificationId: implementationNotification.notificationId,
          title: strings.notifications.taskExecution.doneTitle,
          content: block(
            implementationResult.resultSummary ??
              strings.notifications.taskExecution.defaultSummary,
          ),
        })
      } else {
        await updateNotification({
          notificationId: implementationNotification.notificationId,
          title: strings.notifications.taskExecution.failedTitle,
          content: block(
            implementationResult.errorMessage ?? strings.notifications.taskExecution.defaultFailure,
          ),
        })
      }

      const terminalReply = await updateNotification<
        {
          cancel: { title: string }
        },
        true
      >({
        notificationId: implementationNotification.notificationId,
        title: strings.notifications.taskExecution.awaitingNextActionTitle,
        content: block(strings.notifications.taskExecution.awaitingNextActionMessage),
        actions: {
          cancel: {
            title: strings.notifications.taskExecution.actions.cancel,
          },
        },
        requiresTextResponse: true,
      })

      if (terminalReply.type === "action") {
        await activities.requestCancellation({ taskId })
        continue
      }

      await activities.reviveTaskFromFeedback({ taskId })
      implementationPrompt = terminalReply.text
    }
  },
})

async function runPlanningInteraction(input: { subjectId: string; prompt: string }) {
  const notification = await sendNotification({
    channel: EngineerNotificationChannels.TASKS,
    title: strings.notifications.taskAnalysis.title,
    message: block(strings.notifications.taskAnalysis.creating),
  })

  const result = await activities.startPlanningInteraction({
    subjectId: input.subjectId,
    prompt: input.prompt,
    progressNotificationId: notification.notificationId,
  })

  return {
    notificationId: notification.notificationId,
    result,
  }
}

async function runPlanningFeedbackInteraction(input: { taskId: string; feedback: string }) {
  const notification = await sendNotification({
    channel: EngineerNotificationChannels.TASKS,
    title: strings.notifications.taskAnalysis.title,
    message: block(strings.notifications.taskAnalysis.updating),
  })

  const result = await activities.submitPlanningFeedbackInteraction({
    taskId: input.taskId,
    feedback: input.feedback,
    progressNotificationId: notification.notificationId,
  })

  return {
    notificationId: notification.notificationId,
    result,
  }
}
