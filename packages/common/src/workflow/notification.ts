import { create } from "@bufbuild/protobuf"
import type {
  NotificationAction,
  NotificationActionRow,
  NotificationActionIcon,
  NotificationResponseJson,
} from "@reside/api/interaction/notification.v1"
import {
  AcceptNotificationResponseRequestSchema,
  DeleteNotificationRequestSchema,
  NotificationActionRowSchema,
  NotificationActionSchema,
  SendNotificationRequestSchema,
  UpdateNotificationRequestSchema,
} from "@reside/api/interaction/notification.v1"
import {
  CloseTopicRequestSchema,
  CreateTopicRequestSchema,
  DeleteTopicRequestSchema,
  ReopenTopicRequestSchema,
  UpdateTopicRequestSchema,
} from "@reside/api/interaction/topic.v1"
import { waitForOperationResult } from "./operation"
import { condition, proxyActivities, workflowInfo } from "@temporalio/workflow"
import type { InlineFile } from "@reside/api/common/file.v1"
import type { InteractionActivities } from "../temporal"
import type { MessageContent } from "../telegram"
import { html } from "../telegram"

type NotificationResponseResult = NotificationResponseJson & {
  contextToken?: string
}

export type AcceptNotificationResponseInput<
  TActions extends NotificationActionsInput = Record<string, never>,
  TRequiresTextResponse extends boolean = boolean,
> = {
  /**
   * The identifier of the notification to accept more responses for.
   */
  notificationId: string

  /**
   * Optional cancellation predicate checked while waiting for notification response.
   */
  cancelWhen?: () => boolean
}

export type TopicOutput = {
  topicId: string
}

export type NotificationActionInput = {
  /**
   * The title of the action to be displayed to the user.
   */
  title: string

  /**
   * The optional icon to be displayed alongside the action title.
   */
  icon?: NotificationActionIcon

  /**
   * Optional URL for URL-based action.
   * If provided, action does not produce callback response.
   */
  url?: string
}

export type NotificationActionMap = Record<string, NotificationActionInput>

export type NotificationActionRowsMap = Record<string, NotificationActionMap>

export type NotificationActionsInput = NotificationActionMap | NotificationActionRowsMap

type CallbackActionNamesFromMap<T extends NotificationActionMap> = {
  [K in keyof T]: T[K] extends { url: string } ? never : K
}[keyof T]

type CallbackActionNamesFromRows<T extends NotificationActionRowsMap> = {
  [R in keyof T]: T[R] extends NotificationActionMap ? CallbackActionNamesFromMap<T[R]> : never
}[keyof T]

type CallbackActionNames<TActions extends NotificationActionsInput> =
  TActions extends NotificationActionRowsMap
    ? CallbackActionNamesFromRows<TActions>
    : TActions extends NotificationActionMap
      ? CallbackActionNamesFromMap<TActions>
      : never

type NotificationResponsePayload<
  TActions extends NotificationActionsInput,
  TRequiresTextResponse extends boolean,
> = [CallbackActionNames<TActions>] extends [never]
  ? TRequiresTextResponse extends true
    ? { type: "text"; text: string; contextToken?: string }
    : Record<never, never>
  : TRequiresTextResponse extends true
    ?
        | { type: "action"; actionName: CallbackActionNames<TActions>; contextToken?: string }
        | { type: "text"; text: string; contextToken?: string }
    : { type: "action"; actionName: CallbackActionNames<TActions>; contextToken?: string }

type NotificationCancelledPayload = {
  type: "cancelled"
}

type NotificationCancelableOutput<
  TActions extends NotificationActionsInput,
  TRequiresTextResponse extends boolean,
  TCancelWhen extends (() => boolean) | undefined,
> = {
  notificationId: string
  messageLink?: string
} & (
  | NotificationResponsePayload<TActions, TRequiresTextResponse>
  | (TCancelWhen extends undefined ? never : NotificationCancelledPayload)
)

type NotificationMetadataOutput = {
  notificationId: string
  messageLink?: string
}

export type NotificationInput<
  TActions extends NotificationActionsInput = Record<string, never>,
  TRequiresTextResponse extends boolean = boolean,
> = {
  /**
   * The opaque interaction context token to send the notification to.
   * If not provided, the notification will be sent to the current workflow's interaction context token.
   */
  contextToken?: string

  /**
   * Whether to send notification to system chat.
   * When true, helper omits interaction context from API request.
   */
  system?: boolean

  /**
   * The name of the channel to send the notification to.
   * Omit this when routing by topic identifier.
   */
  channel?: string

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

  /**
   * Whether callback interactions should avoid delayed accepted/chosen suffix rendering.
   */
  expectImmediateFeedback?: boolean

  /**
   * Optional opaque topic identifier to send the notification into.
   */
  topicId?: string

  /**
   * Whether messages sent into the target topic should be treated as text responses.
   */
  acquireTopic?: boolean

  /**
   * Optional cancellation predicate checked while waiting for notification response.
   * If it becomes true first, helper returns `type: "cancelled"`.
   */
  cancelWhen?: () => boolean

  /**
   * Whether to wait for a user response operation returned by the notification service.
   * Defaults to true.
   */
  waitForResponse?: boolean
}

export type NotificationOutput<
  TActions extends NotificationActionsInput,
  TRequiresTextResponse extends boolean,
> = {
  notificationId: string
  messageLink?: string
} & NotificationResponsePayload<TActions, TRequiresTextResponse>

export type CreateTopicInput = {
  /**
   * The name of the channel where the topic should be created.
   */
  channel: string

  /**
   * The human-readable topic title.
   */
  title: string

  /**
   * Optional subject identifier to create the topic on behalf of.
   */
  createAsSubjectId?: string
}

export type UpdateTopicInput = {
  /**
   * The opaque topic identifier.
   */
  topicId: string

  /**
   * The updated human-readable topic title.
   */
  title: string
}

export type UpdateNotificationInput<
  TActions extends NotificationActionsInput = Record<string, never>,
  TRequiresTextResponse extends boolean = boolean,
> = {
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
  actions?: TActions

  /**
   * Whether the updated notification requires a text response from the user.
   */
  requiresTextResponse?: TRequiresTextResponse

  /**
   * Whether callback interactions should avoid delayed accepted/chosen suffix rendering.
   */
  expectImmediateFeedback?: boolean

  /**
   * Optional cancellation predicate checked while waiting for notification response.
   * If it becomes true first, helper returns `type: "cancelled"`.
   */
  cancelWhen?: () => boolean
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
  TActions extends NotificationActionsInput = Record<string, never>,
  TRequiresTextResponse extends boolean = false,
  TCancelWhen extends (() => boolean) | undefined = undefined,
  TWaitForResponse extends boolean = true,
>(
  input: NotificationInput<TActions, TRequiresTextResponse> & {
    cancelWhen?: TCancelWhen
    waitForResponse?: TWaitForResponse
  },
): Promise<
  TWaitForResponse extends false
    ? NotificationMetadataOutput
    : NotificationCancelableOutput<TActions, TRequiresTextResponse, TCancelWhen>
> {
  const { sendNotification } = proxyActivities<InteractionActivities>({
    startToCloseTimeout: "5 minutes",
    retry: {
      initialInterval: "10 seconds",
    },
  })

  const contextToken = resolveNotificationContext(input)

  if (input.topicId !== undefined) {
    if (input.channel !== undefined) {
      throw new Error("Topic-routed notification must not specify channel")
    }

    if (input.contextToken !== undefined || input.system !== undefined) {
      throw new Error("Topic-routed notification must not specify interaction context")
    }
  } else if (input.channel === undefined) {
    throw new Error("Notification channel is required when topicId is not provided")
  }

  const actionRows = toApiActionRows(input.actions)

  const request = create(SendNotificationRequestSchema, {
    contextToken,
    channel: input.channel,
    partition: input.partition,
    title: input.title,
    content: input.message === undefined ? undefined : html(input.message),
    actionRows,
    requiresTextResponse: input.requiresTextResponse,
    protected: input.protected,
    sendAsSubjectId: input.sendAsSubjectId,
    expectImmediateFeedback: input.expectImmediateFeedback,
    topicId: input.topicId,
    acquireTopic: input.acquireTopic,
    attachments: input.attachments ?? [],
    images: input.images ?? [],
  })

  const response = await sendNotification(request)
  const notificationId = response.notificationId
  const messageLink = response.messageLink

  if (!notificationId) {
    throw new Error("Notification service response is missing notificationId")
  }

  if (!response.operation) {
    return {
      notificationId,
      messageLink,
    } as TWaitForResponse extends false
      ? NotificationMetadataOutput
      : NotificationCancelableOutput<TActions, TRequiresTextResponse, TCancelWhen>
  }

  if (input.waitForResponse === false) {
    return {
      notificationId,
      messageLink,
    } as TWaitForResponse extends false
      ? NotificationMetadataOutput
      : NotificationCancelableOutput<TActions, TRequiresTextResponse, TCancelWhen>
  }

  if (response.operation.id === undefined) {
    throw new Error("Notification operation response is missing operation id")
  }

  const responsePromise = waitNotificationOutput<TActions, TRequiresTextResponse>(
    notificationId,
    response.operation.id,
    messageLink,
  )

  if (input.cancelWhen === undefined) {
    return (await responsePromise) as NotificationCancelableOutput<
      TActions,
      TRequiresTextResponse,
      TCancelWhen
    >
  }

  const cancelPromise = condition(input.cancelWhen).then(() => {
    return {
      notificationId,
      messageLink,
      type: "cancelled" as const,
    }
  })

  return (await Promise.race([responsePromise, cancelPromise])) as NotificationCancelableOutput<
    TActions,
    TRequiresTextResponse,
    TCancelWhen
  >
}

function resolveNotificationContext(
  input: Pick<NotificationInput, "contextToken" | "system" | "topicId">,
): string | undefined {
  if (input.topicId !== undefined) {
    return undefined
  }

  if (input.system === true) {
    return undefined
  }

  if (input.contextToken) {
    return input.contextToken
  }

  const memoContext = workflowInfo().memo?.interactionContextToken as string | undefined
  if (memoContext) {
    return memoContext
  }

  throw new Error(
    "No context token provided for notification and no interactionContextToken found in workflow memo",
  )
}

/**
 * Updates an existing notification content by its identifier.
 *
 * @param input The notification update payload.
 */
export async function updateNotification<
  TActions extends NotificationActionsInput = Record<string, never>,
  TRequiresTextResponse extends boolean = false,
  TCancelWhen extends (() => boolean) | undefined = undefined,
>(
  input: UpdateNotificationInput<TActions, TRequiresTextResponse> & { cancelWhen?: TCancelWhen },
): Promise<NotificationCancelableOutput<TActions, TRequiresTextResponse, TCancelWhen>> {
  const { updateNotification } = proxyActivities<InteractionActivities>({
    startToCloseTimeout: "5 minutes",
    retry: {
      initialInterval: "10 seconds",
    },
  })

  const actionRows = toApiActionRows(input.actions)

  const request = create(UpdateNotificationRequestSchema, {
    notificationId: input.notificationId,
    title: input.title,
    content: html(input.content),
    actionRows,
    requiresTextResponse: input.requiresTextResponse,
    expectImmediateFeedback: input.expectImmediateFeedback,
  })

  const response = await updateNotification(request)

  if (!response.operation) {
    return {
      notificationId: input.notificationId,
    } as NotificationCancelableOutput<TActions, TRequiresTextResponse, TCancelWhen>
  }

  if (response.operation.id === undefined) {
    throw new Error("Notification operation response is missing operation id")
  }

  const responsePromise = waitNotificationOutput<TActions, TRequiresTextResponse>(
    input.notificationId,
    response.operation.id,
    undefined,
  )

  if (input.cancelWhen === undefined) {
    return (await responsePromise) as NotificationCancelableOutput<
      TActions,
      TRequiresTextResponse,
      TCancelWhen
    >
  }

  const cancelPromise = condition(input.cancelWhen).then(() => {
    return {
      notificationId: input.notificationId,
      type: "cancelled" as const,
    }
  })

  return (await Promise.race([responsePromise, cancelPromise])) as NotificationCancelableOutput<
    TActions,
    TRequiresTextResponse,
    TCancelWhen
  >
}

/**
 * Accepts the next response for an existing interactive notification.
 *
 * If the notification already has a pending response operation, that operation is reused.
 * Otherwise, a new response operation is created without editing the notification.
 *
 * @param input The notification response acceptance payload.
 */
export async function acceptNotificationResponse<
  TActions extends NotificationActionsInput = Record<string, never>,
  TRequiresTextResponse extends boolean = true,
  TCancelWhen extends (() => boolean) | undefined = undefined,
>(
  input: AcceptNotificationResponseInput<TActions, TRequiresTextResponse> & {
    cancelWhen?: TCancelWhen
  },
): Promise<NotificationCancelableOutput<TActions, TRequiresTextResponse, TCancelWhen>> {
  const { acceptNotificationResponse } = proxyActivities<InteractionActivities>({
    startToCloseTimeout: "5 minutes",
    retry: {
      initialInterval: "10 seconds",
    },
  })

  const response = await acceptNotificationResponse(
    create(AcceptNotificationResponseRequestSchema, {
      notificationId: input.notificationId,
    }),
  )

  if (!response.operation) {
    throw new Error("Accept response operation is missing")
  }

  if (response.operation.id === undefined) {
    throw new Error("Accept response operation id is missing")
  }

  const responsePromise = waitNotificationOutput<TActions, TRequiresTextResponse>(
    input.notificationId,
    response.operation.id,
    undefined,
  )

  if (input.cancelWhen === undefined) {
    return (await responsePromise) as NotificationCancelableOutput<
      TActions,
      TRequiresTextResponse,
      TCancelWhen
    >
  }

  const cancelPromise = condition(input.cancelWhen).then(() => {
    return {
      notificationId: input.notificationId,
      type: "cancelled" as const,
    }
  })

  return (await Promise.race([responsePromise, cancelPromise])) as NotificationCancelableOutput<
    TActions,
    TRequiresTextResponse,
    TCancelWhen
  >
}

/**
 * Deletes an existing notification by its identifier.
 *
 * @param notificationId The notification identifier to delete.
 */
export async function deleteNotification(notificationId: string): Promise<void> {
  const { deleteNotification } = proxyActivities<InteractionActivities>({
    startToCloseTimeout: "5 minutes",
    retry: {
      initialInterval: "10 seconds",
    },
  })

  const request = create(DeleteNotificationRequestSchema, {
    notificationId,
  })

  await deleteNotification(request)
}

/**
 * Creates a notification topic inside a channel.
 *
 * @param input The input for the topic to create.
 * @returns The opaque identifier of the created topic.
 */
export async function createNotificationTopic(input: CreateTopicInput): Promise<TopicOutput> {
  const { createTopic } = proxyActivities<InteractionActivities>({
    startToCloseTimeout: "5 minutes",
    retry: {
      initialInterval: "10 seconds",
    },
  })

  const response = await createTopic(
    create(CreateTopicRequestSchema, {
      channel: input.channel,
      title: input.title,
      createAsSubjectId: input.createAsSubjectId,
    }),
  )

  if (!response.topicId) {
    throw new Error("Topic service response is missing topicId")
  }

  return {
    topicId: response.topicId,
  }
}

/**
 * Updates an existing notification topic.
 *
 * @param input The topic update input.
 */
export async function updateNotificationTopic(input: UpdateTopicInput): Promise<void> {
  const { updateTopic } = proxyActivities<InteractionActivities>({
    startToCloseTimeout: "5 minutes",
    retry: {
      initialInterval: "10 seconds",
    },
  })

  await updateTopic(
    create(UpdateTopicRequestSchema, {
      topicId: input.topicId,
      title: input.title,
    }),
  )
}

/**
 * Deletes an existing notification topic.
 *
 * @param topicId The opaque topic identifier.
 */
export async function deleteNotificationTopic(topicId: string): Promise<void> {
  const { deleteTopic } = proxyActivities<InteractionActivities>({
    startToCloseTimeout: "5 minutes",
    retry: {
      initialInterval: "10 seconds",
    },
  })

  await deleteTopic(
    create(DeleteTopicRequestSchema, {
      topicId,
    }),
  )
}

/**
 * Closes an existing notification topic while preserving its records.
 *
 * @param topicId The opaque topic identifier.
 */
export async function closeNotificationTopic(topicId: string): Promise<void> {
  const { closeTopic } = proxyActivities<InteractionActivities>({
    startToCloseTimeout: "5 minutes",
    retry: {
      initialInterval: "10 seconds",
    },
  })

  await closeTopic(
    create(CloseTopicRequestSchema, {
      topicId,
    }),
  )
}

/**
 * Reopens an existing notification topic.
 *
 * @param topicId The opaque topic identifier.
 */
export async function reopenNotificationTopic(topicId: string): Promise<void> {
  const { reopenTopic } = proxyActivities<InteractionActivities>({
    startToCloseTimeout: "5 minutes",
    retry: {
      initialInterval: "10 seconds",
    },
  })

  await reopenTopic(
    create(ReopenTopicRequestSchema, {
      topicId,
    }),
  )
}

async function waitNotificationOutput<
  TActions extends NotificationActionsInput,
  TRequiresTextResponse extends boolean,
>(
  notificationId: string,
  operationId: number,
  messageLink: string | undefined,
): Promise<NotificationOutput<TActions, TRequiresTextResponse>> {
  const { subscribeToOperationCompletion } = proxyActivities<InteractionActivities>({
    startToCloseTimeout: "5 minutes",
    retry: {
      initialInterval: "10 seconds",
    },
  })

  const operation = await waitForOperationResult<NotificationResponseResult>(
    operationId,
    subscribeToOperationCompletion,
  )

  if (operation.actionName) {
    return {
      notificationId,
      messageLink,
      type: "action",
      actionName: operation.actionName as keyof TActions,
      contextToken: operation.contextToken,
    } as unknown as NotificationOutput<TActions, TRequiresTextResponse>
  }

  if (operation.textResponse) {
    return {
      notificationId,
      messageLink,
      type: "text",
      text: operation.textResponse,
      contextToken: operation.contextToken,
    } as unknown as NotificationOutput<TActions, TRequiresTextResponse>
  }

  throw new Error(`Unexpected operation response for notification: ${JSON.stringify(operation)}`)
}

function toApiActionRows(actions: NotificationActionsInput | undefined): NotificationActionRow[] {
  if (!actions) {
    return []
  }

  if (isActionMap(actions)) {
    return Object.entries(actions).map(([name, action]) =>
      create(NotificationActionRowSchema, {
        actions: [
          create(NotificationActionSchema, {
            name,
            title: action.title,
            icon: action.icon,
            url: action.url,
          }) as NotificationAction,
        ],
      }),
    )
  }

  return Object.values(actions).map(row =>
    create(NotificationActionRowSchema, {
      actions: Object.entries(row).map(([name, action]) =>
        create(NotificationActionSchema, {
          name,
          title: action.title,
          icon: action.icon,
          url: action.url,
        }),
      ),
    }),
  )
}

function isActionMap(actions: NotificationActionsInput): actions is NotificationActionMap {
  const values = Object.values(actions)
  if (values.length === 0) {
    return true
  }

  return values.every(value => {
    if (typeof value !== "object" || value === null) {
      return false
    }

    return "title" in value
  })
}
