/**
 * The list of well-known permissions that can be used in the Access Replica.
 */
export enum WellKnownPermissions {
  /**
   * Allows to manage the specific permission in the Access Replica.
   * The scope is the name of the permission that can be managed.
   */
  ACCESS_PERMISSION_MANAGE = "access:permission:manage",

  /**
   * Allows to manage the specific realm in the Access Replica.
   * The scope is the name of the realm that can be managed.
   */
  ACCESS_REALM_MANAGE = "access:realm:manage",

  /**
   * Allows to manage the specific approver of permission requests in the Access Replica.
   * The scope is the name of the approver that can be managed.
   */
  ACCESS_APPROVER_MANAGE = "access:approver:manage",

  /**
   * Allows to resolve subject display information in the specific realm through the Access Replica.
   * The scope is the name of the realm whose subjects can be resolved.
   */
  ACCESS_SUBJECT_READ = "access:subject:read",

  /**
   * Allows to manage the specific command in the Telegram Replica.
   * The scope is the name of the command that can be managed.
   */
  TELEGRAM_COMMAND_MANAGE = "telegram:command:manage",

  /**
   * Allows to invoke the specific command in the Telegram Replica.
   * The scope is the name of the command that can be invoked.
   */
  TELEGRAM_COMMAND_INVOKE = "telegram:command:invoke",

  /**
   * Allows to approve requests from the specific replica.
   * The scope is the name of the replica for which the approver can approve requests.
   */
  TELEGRAM_APPROVE = "telegram:approve",

  /**
   * Allows to manage the specific notification channel in the Telegram Replica.
   * The scope is the name of the notification channel that can be managed.
   */
  TELEGRAM_NOTIFICATION_CHANNEL_MANAGE = "telegram:notification-channel:manage",

  /**
   * Allows to interact with notifications from specific channel types in the Telegram Replica.
   * The scope is the name of the notification channel.
   */
  TELEGRAM_NOTIFICATION_CHANNEL_INTERACT = "telegram:notification-channel:interact",

  /**
   * Allows to send notifications in the Telegram Replica on behalf of another subject.
   * The scope is the target subject identifier.
   */
  TELEGRAM_NOTIFICATION_SEND_AS_SUBJECT = "telegram:notification:send-as-subject",

  /**
   * Allows replica to have its own avatar (telegram bot) which will be used to send notifications and manage commands.
   * The scope is the name of the replica that can have its own bot.
   */
  TELEGRAM_AVATAR_OWN = "telegram:avatar:own",

  /**
   * Allows to load new replicas in the cluster.
   * The scope is the name of the replica that can be loaded.
   */
  ALPHA_REPLICA_LOAD = "alpha:replica:load",

  /**
   * Allows to define and update engineering tasks in the Engineer Replica.
   */
  ENGINEER_TASK_DEFINE = "engineer:task:define",

  /**
   * Allows subject-to-subject natural language ask calls.
   * The scope is "{to_subject_id}".
   */
  INTERACTION_NLS_ASK = "interaction:nls:ask",

  /**
   * Allows impersonating callers from a specific realm for NLS calls.
   * The scope is the realm name.
   */
  INTERACTION_NLS_IMPERSONATE = "interaction:nls:impersonate",

  /**
   * Allows clearing NLS context for any subject from a specific realm.
   * The scope is the realm name.
   */
  INTERACTION_NLS_CLEAR_SUBJECT_CONTEXT = "interaction:nls:clear-subject-context",

  /**
   * Allows to transfer encrypted content from a specific replica.
   * The scope is the name of the replica from which secrets can be transferred.
   */
  ENCRYPTION_TRANSFER = "encryption:transfer",

  /**
   * Allows to manage the specific gateway in the Infra Replica.
   * The scope is the name of the gateway.
   */
  INFRA_GATEWAY_MANAGE = "infra:gateway:manage",
}
