import type {
  NotificationActionIcon,
  NotificationResponse,
} from "@reside/api/interaction/notification.v1"
import { waitForOperationResult } from "./operation"
import { proxyActivities, workflowInfo } from "@temporalio/workflow"
import type { InlineFile } from "@reside/api/common/file.v1"
import type { InteractionActivities } from "../temporal"
import type { MessageContent } from "../telegram"
import { html } from "../telegram"

export type NotificationActionInput = {
  /**
   * The title of the action to be displayed to the user.
   */
  title: string

  /**
   * The optional icon to be displayed alongside the action title.
   */
  icon?: NotificationActionIcon
}

export type NotificationInput<
  TActions extends Record<string, NotificationActionInput> = Record<
    string,
    NotificationActionInput
  >,
  TRequiresTextResponse extends boolean = boolean,
> = {
  /**
   * The interaction context to send the notification to.
   * If not provided, the notification will be sent to the current workflow's interaction context.
   */
  contextId?: string

  /**
   * The name of the channel to send the notification to.
   */
  channel: string

  /**
   * The name of the partition in the channel to send the notification to.
   * If not provided, the notification will be sent to the default partition of the channel.
   */
  partition?: string

  /**
   * The title of the notification to be displayed to the user.
   */
  title: string

  /**
   * The optional message of the notification to be displayed to the user.
   */
  message?: MessageContent

  /**
   * The optional actions to be displayed to the user.
   */
  actions?: TActions

  /**
   * The attachments to be included in the notification.
   */
  attachments?: InlineFile[]

  /**
   * The images to be included in the notification.
   */
  images?: InlineFile[]

  /**
   * Whether the notification requires a text response from the user.
   */
  requiresTextResponse?: TRequiresTextResponse

  /**
   * Whether interaction responses should be protected by implementation-specific authorization.
   */
  protected?: boolean

  /**
   * Optional subject identifier to send the notification on behalf of.
   */
  sendAsSubjectId?: string
}

export type NotificationOutput<
  TActions extends Record<string, NotificationActionInput>,
  TRequiresTextResponse extends boolean,
> = {
  notificationId: string
} & (TActions extends Record<string, never>
  ? TRequiresTextResponse extends true
    ? { type: "text"; text: string }
    : Record<never, never>
  : TRequiresTextResponse extends true
    ? { type: "action"; actionName: keyof TActions } | { type: "text"; text: string }
    : { type: "action"; actionName: keyof TActions })

export type UpdateNotificationInput = {
  /**
   * The identifier of the notification to update.
   */
  notificationId: string

  /**
   * The updated title of the notification.
   */
  title: string

  /**
   * The updated content of the notification.
   */
  content: MessageContent

  /**
   * The updated actions to be displayed to the user.
   */
  actions?: Record<string, NotificationActionInput>

  /**
   * Whether the updated notification requires a text response from the user.
   */
  requiresTextResponse?: boolean
}

/**
 * Sends a notification to the user with the specified input.
 *
 * If at least one action is provided or `requiresTextResponse` is true,
 * the workflow will be suspended until the user interacts with the notification by either clicking an action or submitting a text response.
 *
 * If there only actions are provided, the response will be the name of the action clicked by the user.
 * If only `requiresTextResponse` is true, the response will be the text submitted by the user.
 * If both actions and `requiresTextResponse` are provided, the response will be union of the two cases above.
 *
 * If neither actions nor `requiresTextResponse` are provided, the workflow will not be suspended and the response will be void.
 *
 * @param input The input for the notification to be sent.
 */
export async function sendNotification<
  TActions extends Record<string, NotificationActionInput> = Record<string, never>,
  TRequiresTextResponse extends boolean = false,
>(
  input: NotificationInput<TActions, TRequiresTextResponse>,
): Promise<NotificationOutput<TActions, TRequiresTextResponse>> {
  const { sendNotification } = proxyActivities<InteractionActivities>({
    startToCloseTimeout: "5 minutes",
    retry: {
      initialInterval: "10 seconds",
    },
  })

  let contextId = input.contextId
  if (!contextId) {
    contextId = workflowInfo().memo?.interactionContextId as string | undefined

    if (!contextId) {
      throw new Error(
        "No contextId provided for notification and no interactionContextId found in workflow memo",
      )
    }
  }

  const response = await sendNotification({
    contextId,
    channel: input.channel,
    partition: input.partition,
    title: input.title,
    content: input.message === undefined ? undefined : html(input.message),
    actions: input.actions
      ? Object.entries(input.actions).map(([name, { title, icon }]) => ({
          name,
          title,
          icon,
        }))
      : [],
    requiresTextResponse: input.requiresTextResponse,
    protected: input.protected,
    sendAsSubjectId: input.sendAsSubjectId,
    attachments: input.attachments,
    images: input.images,
  })

  if (!response.operation) {
    return {
      notificationId: response.notificationId,
    } as NotificationOutput<TActions, TRequiresTextResponse>
  }

  return await waitNotificationOutput<TActions, TRequiresTextResponse>(
    response.notificationId,
    response.operation.id,
  )
}

/**
 * Updates an existing notification content by its identifier.
 *
 * @param input The notification update payload.
 */
export async function updateNotification<
  TActions extends Record<string, NotificationActionInput> = Record<string, never>,
  TRequiresTextResponse extends boolean = false,
>(input: UpdateNotificationInput): Promise<NotificationOutput<TActions, TRequiresTextResponse>> {
  const { updateNotification } = proxyActivities<InteractionActivities>({
    startToCloseTimeout: "5 minutes",
    retry: {
      initialInterval: "10 seconds",
    },
  })

  const response = await updateNotification({
    notificationId: input.notificationId,
    title: input.title,
    content: html(input.content),
    actions: input.actions
      ? Object.entries(input.actions).map(([name, { title, icon }]) => ({
          name,
          title,
          icon,
        }))
      : [],
    requiresTextResponse: input.requiresTextResponse,
  })

  if (!response.operation) {
    return {
      notificationId: input.notificationId,
    } as NotificationOutput<TActions, TRequiresTextResponse>
  }

  return await waitNotificationOutput<TActions, TRequiresTextResponse>(
    input.notificationId,
    response.operation.id,
  )
}

async function waitNotificationOutput<
  TActions extends Record<string, NotificationActionInput>,
  TRequiresTextResponse extends boolean,
>(
  notificationId: string,
  operationId: number,
): Promise<NotificationOutput<TActions, TRequiresTextResponse>> {
  const { subscribeToOperationCompletion } = proxyActivities<InteractionActivities>({
    startToCloseTimeout: "5 minutes",
    retry: {
      initialInterval: "10 seconds",
    },
  })

  const operation = await waitForOperationResult<NotificationResponse>(
    operationId,
    subscribeToOperationCompletion,
  )

  if (operation.response?.$case === "actionName") {
    return {
      notificationId,
      type: "action",
      actionName: operation.response.value as keyof TActions,
    } as unknown as NotificationOutput<TActions, TRequiresTextResponse>
  }

  if (operation.response?.$case === "textResponse") {
    return {
      notificationId,
      type: "text",
      text: operation.response.value,
    } as unknown as NotificationOutput<TActions, TRequiresTextResponse>
  }

  throw new Error(`Unexpected operation response for notification: ${JSON.stringify(operation)}`)
}
