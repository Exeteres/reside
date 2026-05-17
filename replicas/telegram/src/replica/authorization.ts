import type { AuthzServiceClient } from "@reside/api/access/authz.v1"
import type { PermissionRequestServiceClient } from "@reside/api/access/request.v1"
import { logger } from "@reside/common"
import { WellKnownPermissions } from "@reside/registry"
import { strings } from "../locale"

export async function canInteractWithNotificationChannel(args: {
  authzService: AuthzServiceClient
  userId: number
  channelName: string | null
}): Promise<boolean> {
  if (!args.channelName) {
    return false
  }

  const telegramUserId = String(args.userId)
  const subjectId = `telegram:${telegramUserId}`

  try {
    const permissionCheck = await args.authzService.checkPermission({
      permissionName: WellKnownPermissions.TELEGRAM_NOTIFICATION_CHANNEL_INTERACT,
      subjectId,
      scope: args.channelName,
    })

    return permissionCheck.authorized
  } catch (error) {
    logger.warn(
      {
        userId: telegramUserId,
        subjectId,
        channelName: args.channelName,
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to check notification interaction permission",
    )

    return false
  }
}

export async function canInvokeCommand(args: {
  authzService: AuthzServiceClient
  userId: number
  commandName: string
}): Promise<{
  authorized: boolean
  checked: boolean
}> {
  const telegramUserId = String(args.userId)
  const subjectId = `telegram:${telegramUserId}`

  try {
    const permissionCheck = await args.authzService.checkPermission({
      permissionName: WellKnownPermissions.TELEGRAM_COMMAND_INVOKE,
      subjectId,
      scope: args.commandName,
    })

    return {
      authorized: permissionCheck.authorized,
      checked: true,
    }
  } catch (error) {
    logger.warn(
      {
        userId: telegramUserId,
        subjectId,
        commandName: args.commandName,
        error: error instanceof Error ? error.message : String(error),
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
  userId: number
  commandName: string
}): Promise<void> {
  const subjectId = `telegram:${args.userId}`
  const permissionName = WellKnownPermissions.TELEGRAM_COMMAND_INVOKE
  const permissionSetName = `auto-request:${permissionName}:${args.commandName}`

  try {
    await args.permissionRequestService.requestPermissions({
      subjectId,
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
        userId: args.userId,
        subjectId,
        commandName: args.commandName,
        permissionName,
        permissionSetName,
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to auto-request command invoke permission",
    )
  }
}
