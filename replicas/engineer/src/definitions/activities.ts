export type GenerateTaskPreviewTitleInput = {
  /**
   * The original user task prompt.
   */
  prompt: string
}

export type GenerateTaskPreviewTitleOutput = {
  /**
   * The generated short Russian preview title.
   */
  title: string
}

export type StartPlanningInteractionInput = {
  /**
   * The subject identifier that requested planning.
   */
  subjectId: string

  /**
   * The planning prompt text.
   */
  prompt: string

  /**
   * The notification identifier used for progress updates.
   */
  progressNotificationId: string

  /**
   * The notification topic identifier associated with the task.
   */
  topicId: string

  /**
   * The generated preview title from task preparation.
   */
  previewTitle: string
}

export type SubmitPlanningFeedbackInteractionInput = {
  /**
   * The task identifier.
   */
  taskId: string

  /**
   * The user feedback text.
   */
  feedback: string

  /**
   * The notification identifier used for progress updates.
   */
  progressNotificationId: string
}

export type StartImplementationOnlyTaskInput = {
  /**
   * The subject identifier that requested implementation.
   */
  subjectId: string

  /**
   * The notification identifier used for progress updates.
   */
  progressNotificationId: string

  /**
   * The notification topic identifier associated with the task.
   */
  topicId: string

  /**
   * The generated preview title from task preparation.
   */
  previewTitle: string
}

export type StartImplementationOnlyTaskOutput = {
  /**
   * The task identifier.
   */
  taskId: string
}

export type ApproveTaskInput = {
  /**
   * The task identifier.
   */
  taskId: string
}

export type RequestCancellationInput = {
  /**
   * The task identifier.
   */
  taskId: string
}

export type RunImplementationInteractionInput = {
  /**
   * The task identifier.
   */
  taskId: string

  /**
   * The implementation prompt text.
   */
  prompt: string

  /**
   * The notification identifier used for progress updates.
   */
  progressNotificationId: string
}

export type RetryTaskInput = {
  /**
   * The task identifier.
   */
  taskId: string
}

export type GetTaskSnapshotInput = {
  /**
   * The task identifier.
   */
  taskId: string
}

export type PlanningInteractionStatus = "PLAN_READY" | "FAILED"

export type StartPlanningInteractionOutput = {
  /**
   * The task identifier.
   */
  taskId: string

  /**
   * The planning status.
   */
  status: PlanningInteractionStatus

  /**
   * The issue title.
   */
  issueTitle?: string

  /**
   * The issue URL.
   */
  issueUrl?: string

  /**
   * The repository URL.
   */
  repositoryUrl?: string

  /**
   * The planning summary.
   */
  resultSummary?: string

  /**
   * The optional planning failure message.
   */
  errorMessage?: string
}

export type SubmitPlanningFeedbackInteractionOutput = StartPlanningInteractionOutput

export type RunImplementationInteractionStatus =
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"

export type GetTaskSnapshotPhase = "PLANNING" | "IMPLEMENTATION"

export type GetTaskSnapshotStatus =
  | "PLANNING"
  | "PLAN_READY"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "REQUESTED_CANCELLATION"
  | "CANCELLED"

export type RunImplementationInteractionOutput = {
  /**
   * The task identifier.
   */
  taskId: string

  /**
   * The implementation status.
   */
  status: RunImplementationInteractionStatus

  /**
   * The optional implementation summary.
   */
  resultSummary?: string

  /**
   * The optional error message.
   */
  errorMessage?: string
}

export type GetTaskSnapshotOutput = {
  /**
   * The task identifier.
   */
  taskId: string

  /**
   * The current task phase.
   */
  phase: GetTaskSnapshotPhase

  /**
   * The current task status.
   */
  status: GetTaskSnapshotStatus

  /**
   * The issue title.
   */
  issueTitle: string

  /**
   * The issue URL.
   */
  issueUrl: string

  /**
   * The repository URL.
   */
  repositoryUrl: string
}

export type EngineerTaskActivities = {
  /**
   * Generates a short preview title for task preparation.
   */
  generateTaskPreviewTitle: (
    input: GenerateTaskPreviewTitleInput,
  ) => Promise<GenerateTaskPreviewTitleOutput>

  /**
   * Starts a planning interaction for a task.
   */
  startPlanningInteraction: (
    input: StartPlanningInteractionInput,
  ) => Promise<StartPlanningInteractionOutput>

  /**
   * Submits feedback for an existing planning interaction.
   */
  submitPlanningFeedbackInteraction: (
    input: SubmitPlanningFeedbackInteractionInput,
  ) => Promise<SubmitPlanningFeedbackInteractionOutput>

  /**
   * Starts an implementation-only task without creating a planning issue.
   */
  startImplementationOnlyTask: (
    input: StartImplementationOnlyTaskInput,
  ) => Promise<StartImplementationOnlyTaskOutput>

  /**
   * Approves a task for implementation.
   */
  approveTask: (input: ApproveTaskInput) => Promise<void>

  /**
   * Requests cancellation for a task.
   */
  requestCancellation: (input: RequestCancellationInput) => Promise<void>

  /**
   * Runs one implementation interaction iteration.
   */
  runImplementationInteraction: (
    input: RunImplementationInteractionInput,
  ) => Promise<RunImplementationInteractionOutput>

  /**
   * Reopens a failed task for another iteration.
   */
  retryTask: (input: RetryTaskInput) => Promise<void>

  /**
   * Returns the latest task snapshot.
   */
  getTaskSnapshot: (input: GetTaskSnapshotInput) => Promise<GetTaskSnapshotOutput>
}
