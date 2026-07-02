import { defineSignal } from "@temporalio/workflow"

export type TaskCreationMode = "plan" | "implement"

export type PrepareTaskWorkflowInput = {
  /**
   * The subject identifier that requested task creation.
   */
  subjectId: string

  /**
   * The original user task prompt.
   */
  prompt: string

  /**
   * The requested task creation mode.
   */
  mode: TaskCreationMode
}

export type PrepareTaskWorkflowOutput = {
  /**
   * The created notification topic identifier.
   */
  topicId: string

  /**
   * The progress notification identifier created inside the topic.
   */
  notificationId: string

  /**
   * The external link to the progress notification message.
   */
  messageLink?: string

  /**
   * The generated preview title used for the topic.
   */
  previewTitle: string
}

export type TaskWorkflowInput = PrepareTaskWorkflowInput & PrepareTaskWorkflowOutput

export type DeleteSourceCodeWorkflowInput = {
  operationId: number
  replicaName: string
}

export type TaskFeedbackSignalInput = {
  /**
   * The feedback text provided by the user.
   */
  text: string

  /**
   * Optional response context token from the interaction implementation.
   */
  contextToken?: string
}

export const taskFeedbackSignal = defineSignal<[TaskFeedbackSignalInput]>("taskFeedback")

export const taskStartImplementationSignal = defineSignal("taskStartImplementation")
export const taskCancelSignal = defineSignal("taskCancel")
