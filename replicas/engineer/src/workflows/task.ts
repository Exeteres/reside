import {
  block,
  defineCommandHandler,
  sendNotification,
  updateNotification,
} from "@reside/common/workflow"
import { proxyActivities } from "@temporalio/workflow"
import { createTaskCommand, EngineerNotificationChannels } from "../definitions"
import { strings } from "../locale"

type CreateTaskResult = {
  taskId: string
  issueTitle: string
  issueUrl: string
  repositoryUrl: string
}

type DraftTaskResult = {
  draftId: string
  taskId: string
  issueTitle: string
  issueBody: string
}

type DraftFeedbackResult = {
  issueTitle: string
  issueBody: string
}

const {
  analyzeTaskForIssue,
  createTaskFromDraft,
  analyzeTaskFeedback,
  applyTaskFeedback,
  confirmTask,
  closeTask,
} = proxyActivities<{
  analyzeTaskForIssue: (input: {
    subjectId: string
    task: string
    progressNotificationId: string
  }) => Promise<DraftTaskResult>
  createTaskFromDraft: (input: {
    draftId: string
    taskId: string
    issueTitle: string
    issueBody: string
  }) => Promise<CreateTaskResult>
  analyzeTaskFeedback: (input: {
    taskId: string
    feedback: string
    progressNotificationId: string
  }) => Promise<DraftFeedbackResult>
  applyTaskFeedback: (input: {
    taskId: string
    feedback: string
    issueTitle: string
    issueBody: string
  }) => Promise<CreateTaskResult>
  confirmTask: (taskId: string) => Promise<void>
  closeTask: (taskId: string) => Promise<void>
}>({ scheduleToCloseTimeout: "10 minutes" })

export const createTaskCommandHandler = defineCommandHandler({
  command: createTaskCommand,
  async handler({ params, invocation }) {
    const progressNotification = await sendNotification({
      channel: EngineerNotificationChannels.TASKS,
      title: strings.notifications.taskAnalysis.title,
      message: block(strings.notifications.taskAnalysis.creating),
    })

    const initialDraft = await analyzeTaskForIssue({
      subjectId: invocation.subjectId,
      task: params.task,
      progressNotificationId: progressNotification.notificationId,
    })

    let task = await createTaskFromDraft({
      draftId: initialDraft.draftId,
      taskId: initialDraft.taskId,
      issueTitle: initialDraft.issueTitle,
      issueBody: initialDraft.issueBody,
    })

    while (true) {
      const response = await updateNotification<
        {
          confirmImplementation: { title: string }
          closeTask: { title: string }
        },
        true
      >({
        notificationId: progressNotification.notificationId,
        title: strings.notifications.taskCreated.title,
        content: block(
          strings.notifications.taskCreated.message(
            task.repositoryUrl,
            task.issueUrl,
            task.issueTitle,
          ),
        ),
        actions: {
          confirmImplementation: {
            title: strings.notifications.taskCreated.actions.confirm,
          },
          closeTask: {
            title: strings.notifications.taskCreated.actions.close,
          },
        },
        requiresTextResponse: true,
      })

      if (response.type === "action") {
        if (response.actionName === "confirmImplementation") {
          await confirmTask(task.taskId)
          return
        }

        await closeTask(task.taskId)
        return
      }

      await updateNotification({
        notificationId: progressNotification.notificationId,
        title: strings.notifications.taskAnalysis.title,
        content: block(strings.notifications.taskAnalysis.updating),
      })

      const updatedDraft = await analyzeTaskFeedback({
        taskId: task.taskId,
        feedback: response.text,
        progressNotificationId: progressNotification.notificationId,
      })

      task = await applyTaskFeedback({
        taskId: task.taskId,
        feedback: response.text,
        issueTitle: updatedDraft.issueTitle,
        issueBody: updatedDraft.issueBody,
      })
    }
  },
})
