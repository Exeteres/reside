import type { AuthzServiceClient } from "@reside/api/access/authz.v1"
import type { PermissionRequestServiceClient } from "@reside/api/access/request.v1"
import { logger } from "@reside/common"
import { WellKnownPermissions } from "@reside/registry"
import { strings } from "../../locale"

export async function canInteractWithNotificationChannel(args: {
  authzService: AuthzServiceClient
  subjectId: string
  channelName: string | null
}): Promise<boolean> {
  if (!args.channelName) {
    return false
  }

  try {
    const permissionCheck = await args.authzService.checkPermission({
      permissionName: WellKnownPermissions.TELEGRAM_NOTIFICATION_CHANNEL_INTERACT,
      subjectId: args.subjectId,
      scope: args.channelName,
    })

    return permissionCheck.authorized
  } catch (error) {
    logger.warn(
      {
        subjectId: args.subjectId,
        channelName: args.channelName,
        error: error instanceof Error ? error : new Error(String(error)),
      },
      "failed to check notification interaction permission",
    )

    return false
  }
}

export async function canManageNotificationChannel(args: {
  authzService: AuthzServiceClient
  subjectId: string
  channelName: string
}): Promise<boolean> {
  try {
    const permissionCheck = await args.authzService.checkPermission({
      permissionName: WellKnownPermissions.TELEGRAM_NOTIFICATION_CHANNEL_MANAGE,
      subjectId: args.subjectId,
      scope: args.channelName,
    })

    return permissionCheck.authorized
  } catch (error) {
    logger.warn(
      {
        subjectId: args.subjectId,
        channelName: args.channelName,
        error: error instanceof Error ? error : new Error(String(error)),
      },
      "failed to check notification channel manage permission",
    )

    return false
  }
}

export async function canInvokeCommand(args: {
  authzService: AuthzServiceClient
  subjectId: string
  commandName: string
}): Promise<{
  authorized: boolean
  checked: boolean
}> {
  try {
    const permissionCheck = await args.authzService.checkPermission({
      permissionName: WellKnownPermissions.TELEGRAM_COMMAND_INVOKE,
      subjectId: args.subjectId,
      scope: args.commandName,
    })

    return {
      authorized: permissionCheck.authorized,
      checked: true,
    }
  } catch (error) {
    logger.warn(
      {
        subjectId: args.subjectId,
        commandName: args.commandName,
        error: error instanceof Error ? error : new Error(String(error)),
      },
      "failed to check command invoke permission",
    )

    return {
      authorized: false,
      checked: false,
    }
  }
}

export async function requestCommandInvokePermission(args: {
  permissionRequestService: PermissionRequestServiceClient
  subjectId: string
  commandName: string
}): Promise<void> {
  const permissionName = WellKnownPermissions.TELEGRAM_COMMAND_INVOKE
  const permissionSetName = `auto-request:${permissionName}:${args.commandName}`

  try {
    await args.permissionRequestService.requestPermissions({
      subjectId: args.subjectId,
      reason: strings.worker.authorization.autoRequestReason(args.commandName),
      permissionSetName,
      items: [
        {
          permissionName,
          scope: args.commandName,
        },
      ],
    })
  } catch (error) {
    logger.warn(
      {
        subjectId: args.subjectId,
        commandName: args.commandName,
        permissionName,
        permissionSetName,
        error: error instanceof Error ? error : new Error(String(error)),
      },
      "failed to auto-request command invoke permission",
    )
  }
}

export async function requestNotificationChannelInteractPermission(args: {
  permissionRequestService: PermissionRequestServiceClient
  subjectId: string
  channelName: string
}): Promise<void> {
  const permissionName = WellKnownPermissions.TELEGRAM_NOTIFICATION_CHANNEL_INTERACT
  const permissionSetName = `auto-request:${permissionName}:${args.channelName}`

  try {
    await args.permissionRequestService.requestPermissions({
      subjectId: args.subjectId,
      reason: strings.worker.authorization.autoRequestNotificationInteractReason(args.channelName),
      permissionSetName,
      items: [
        {
          permissionName,
          scope: args.channelName,
        },
      ],
    })
  } catch (error) {
    logger.warn(
      {
        subjectId: args.subjectId,
        channelName: args.channelName,
        permissionName,
        permissionSetName,
        error: error instanceof Error ? error : new Error(String(error)),
      },
      "failed to auto-request notification interaction permission",
    )
  }
}

export async function canAskNls(args: {
  authzService: AuthzServiceClient
  fromSubjectId: string
  toSubjectId: string
}): Promise<{
  authorized: boolean
  checked: boolean
}> {
  const scope = args.toSubjectId

  try {
    const permissionCheck = await args.authzService.checkPermission({
      permissionName: WellKnownPermissions.INTERACTION_NLS_ASK,
      subjectId: args.fromSubjectId,
      scope,
    })

    return {
      authorized: permissionCheck.authorized,
      checked: true,
    }
  } catch (error) {
    logger.warn(
      {
        fromSubjectId: args.fromSubjectId,
        toSubjectId: args.toSubjectId,
        scope,
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to check nls ask permission",
    )

    return {
      authorized: false,
      checked: false,
    }
  }
}

export async function requestNlsAskPermission(args: {
  permissionRequestService: PermissionRequestServiceClient
  fromSubjectId: string
  toSubjectId: string
}): Promise<void> {
  const scope = args.toSubjectId
  const permissionSetName = `auto-request:${WellKnownPermissions.INTERACTION_NLS_ASK}:${args.toSubjectId}`

  try {
    await args.permissionRequestService.requestPermissions({
      subjectId: args.fromSubjectId,
      reason: strings.worker.authorization.autoRequestNlsReason(args.toSubjectId),
      permissionSetName,
      items: [
        {
          permissionName: WellKnownPermissions.INTERACTION_NLS_ASK,
          scope,
        },
      ],
    })
  } catch (error) {
    logger.warn(
      {
        fromSubjectId: args.fromSubjectId,
        toSubjectId: args.toSubjectId,
        scope,
        permissionSetName,
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to auto-request nls ask permission",
    )
  }
}
