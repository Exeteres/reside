import type { CommandInvocationJson } from "@reside/api/interaction/command.v1"

export type TelegramCommandEvent = {
  managerToken: string
  chatId: number
  userId: number
  messageId: number
  text: string
  interactionContext: {
    token: string
    title: string
  }
}

export type PrepareCommandInvocationInvokeOutput = {
  /**
   * Indicates that the command should be invoked.
   */
  kind: "invoke"

  /**
   * The callback endpoint where command handler is available.
   */
  callbackEndpoint: string

  /**
   * The prepared invocation payload.
   */
  invocation: CommandInvocationJson
}

export type PrepareCommandInvocationReplyOutput = {
  /**
   * Indicates that an immediate reply should be sent.
   */
  kind: "reply"

  /**
   * The reply text for Telegram chat.
   */
  text: string
}

export type PrepareCommandInvocationOutput =
  | PrepareCommandInvocationInvokeOutput
  | PrepareCommandInvocationReplyOutput

export type InvokeReplicaCommandInput = {
  /**
   * The callback endpoint where command invocation is sent.
   */
  callbackEndpoint: string

  /**
   * The command invocation payload.
   */
  invocation: CommandInvocationJson
}

export type SendTelegramMessageInput = {
  /**
   * Manager bot token.
   */
  token: string

  /**
   * Telegram chat identifier.
   */
  chatId: number

  /**
   * Message identifier to reply to.
   */
  replyToMessageId: number

  /**
   * Message text in HTML mode.
   */
  text: string
}

export type ResolveNlsTargetInput = {
  /**
   * Mentioned username in the message.
   */
  mentionedUsername?: string

  /**
   * Username from replied message.
   */
  repliedUsername?: string

  /**
   * Current active replica name in dialog.
   */
  currentReplicaName?: string
}

export type ResolveNlsTargetFoundOutput = {
  /**
   * Indicates that a target replica was resolved.
   */
  found: true

  /**
   * The resolved replica name.
   */
  replicaName: string

  /**
   * Optional avatar token for replies.
   */
  avatarToken: string | null

  /**
   * Optional managed bot username.
   */
  managedBotUsername: string | null
}

export type ResolveNlsTargetNotFoundOutput = {
  /**
   * Indicates that no target replica was resolved.
   */
  found: false
}

export type ResolveNlsTargetOutput = ResolveNlsTargetFoundOutput | ResolveNlsTargetNotFoundOutput

export type EnsureNlsPermissionInput = {
  /**
   * The requesting subject identifier.
   */
  fromSubjectId: string

  /**
   * The target subject identifier.
   */
  toSubjectId: string
}

export type EnsureNlsPermissionOutput = {
  /**
   * Whether permission is granted.
   */
  authorized: boolean
}

export type SetNlsInProgressReactionInput = {
  /**
   * Manager bot token.
   */
  managerToken: string

  /**
   * Telegram chat identifier.
   */
  chatId: number

  /**
   * Telegram message identifier.
   */
  messageId: number

  /**
   * Optional avatar token for reaction sender.
   */
  avatarToken: string | null
}

export type AskReplicaNlsInput = {
  /**
   * Stable identifier of the user-level invocation that caused this prompt.
   */
  invocationId: string

  /**
   * Target subject identifier.
   */
  toSubjectId: string

  /**
   * Requesting subject identifier.
   */
  fromSubjectId: string

  /**
   * Prompt text to send.
   */
  prompt: string
}

export type AskReplicaNlsOutput = {
  /**
   * Response text returned by target replica.
   */
  text: string
}

export type SendNlsReplyInput = {
  /**
   * Manager bot token.
   */
  managerToken: string

  /**
   * Optional avatar token.
   */
  avatarToken: string | null

  /**
   * Telegram chat identifier.
   */
  chatId: number

  /**
   * Message identifier to reply to.
   */
  replyToMessageId: number

  /**
   * Reply text in HTML mode.
   */
  text: string
}

export type GetAvatarProvisionRequestInput = {
  /**
   * Avatar provisioning operation identifier.
   */
  operationId: number
}

export type GetAvatarProvisionRequestOutput = {
  /**
   * Avatar provisioning operation identifier.
   */
  operationId: number

  /**
   * Subject identifier for avatar owner.
   */
  subjectId: string

  /**
   * Replica name.
   */
  replicaName: string

  /**
   * Human-readable replica title.
   */
  replicaTitle: string

  /**
   * Expected managed bot username prefix.
   */
  expectedPrefix: string
}

export type GetAvatarProvisioningPromptLinkInput = {
  /**
   * Avatar provisioning operation identifier.
   */
  operationId: number
}

export type GetAvatarProvisioningPromptLinkOutput = {
  /**
   * Telegram deep-link for managed bot provisioning flow.
   */
  link: string
}

export type CompleteAvatarProvisionOperationInput = {
  /**
   * Avatar provisioning operation identifier.
   */
  operationId: number

  /**
   * Managed bot identifier.
   */
  managedBotId: string

  /**
   * Managed bot username.
   */
  managedBotUsername: string
}

export type DeleteAvatarInput = {
  /**
   * Avatar deletion operation identifier.
   */
  operationId: number

  /**
   * The avatar record identifier, if an avatar exists.
   */
  avatarId: number | null

  /**
   * Replica name whose avatar resources are deleted.
   */
  replicaName: string

  /**
   * Provisioning request identifiers deleted with the avatar.
   */
  avatarProvisionRequestIds: number[]
}

export type FailOperationInput = {
  /**
   * Operation identifier.
   */
  operationId: number

  /**
   * Failure reason code.
   */
  reason: string

  /**
   * Failure message text.
   */
  message: string
}

export type ActivityRewardInterval = {
  /**
   * Internal Telegram replica user record identifier.
   */
  userId: number

  /**
   * First message number included in this reward interval.
   */
  fromMessageNumber: number

  /**
   * Last message number included in this reward interval.
   */
  toMessageNumber: number

  /**
   * Number of messages included in this reward interval.
   */
  messageCount: number
}

export type ListActivityRewardIntervalsOutput = {
  /**
   * Reward intervals fixed for this workflow iteration.
   */
  intervals: ActivityRewardInterval[]
}

export type TelegramActivities = {
  /**
   * Validates a Telegram command message and prepares invocation payload.
   */
  prepareCommandInvocation: (input: TelegramCommandEvent) => Promise<PrepareCommandInvocationOutput>

  /**
   * Invokes a replica command using command handler service.
   */
  invokeReplicaCommand: (input: InvokeReplicaCommandInput) => Promise<void>

  /**
   * Sends a Telegram message using manager bot token.
   */
  sendTelegramMessage: (input: SendTelegramMessageInput) => Promise<void>

  /**
   * Resolves the active NLS target replica from dialog context.
   */
  resolveNlsTarget: (input: ResolveNlsTargetInput) => Promise<ResolveNlsTargetOutput>

  /**
   * Ensures a caller has NLS permission for target replica.
   */
  ensureNlsPermission: (input: EnsureNlsPermissionInput) => Promise<EnsureNlsPermissionOutput>

  /**
   * Sets an in-progress reaction on an NLS request message.
   */
  setNlsInProgressReaction: (input: SetNlsInProgressReactionInput) => Promise<void>

  /**
   * Sends an NLS prompt to target replica and returns the response text.
   */
  askReplicaNls: (input: AskReplicaNlsInput) => Promise<AskReplicaNlsOutput>

  /**
   * Sends NLS response message to Telegram chat.
   */
  sendNlsReply: (input: SendNlsReplyInput) => Promise<void>

  /**
   * Loads avatar provisioning request details by operation id.
   */
  getAvatarProvisionRequest: (
    input: GetAvatarProvisionRequestInput,
  ) => Promise<GetAvatarProvisionRequestOutput>

  /**
   * Builds a prompt link for avatar provisioning flow.
   */
  getAvatarProvisioningPromptLink: (
    input: GetAvatarProvisioningPromptLinkInput,
  ) => Promise<GetAvatarProvisioningPromptLinkOutput>

  /**
   * Finalizes avatar provisioning and completes the operation.
   */
  completeAvatarProvisionOperation: (input: CompleteAvatarProvisionOperationInput) => Promise<void>

  /**
   * Deletes a replica avatar and related provisioning requests.
   */
  deleteAvatar: (input: DeleteAvatarInput) => Promise<void>

  /**
   * Marks avatar provisioning operation as failed.
   */
  failAvatarProvisionOperation: (input: FailOperationInput) => Promise<void>

  /**
   * Lists fixed user message intervals that should be rewarded.
   */
  listActivityRewardIntervals: () => Promise<ListActivityRewardIntervalsOutput>

  /**
   * Rewards one fixed user message interval.
   */
  rewardActivityInterval: (input: ActivityRewardInterval) => Promise<void>
}
