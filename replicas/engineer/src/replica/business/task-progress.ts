import type { NotificationServiceClient } from "@reside/api/interaction/notification.v1"

export const PROGRESS_NOTIFICATION_HISTORY_LIMIT = 5

export type ProgressNotificationAction = {
  name: string
  title: string
}

export async function updateProgressNotification(
  notificationService: NotificationServiceClient,
  notificationId: string,
  title: string,
  progressLines: string[],
  prefix?: string,
  actions?: ProgressNotificationAction[],
): Promise<void> {
  const recentProgressLines = progressLines
    .slice(-PROGRESS_NOTIFICATION_HISTORY_LIMIT)
    .map(line => `> ${line}`)
  const content = [prefix, recentProgressLines.length > 0 ? "" : undefined, ...recentProgressLines]
    .filter((line): line is string => typeof line === "string")
    .join("\n")

  await notificationService.updateNotification({
    notificationId,
    title,
    content,
    actionRows: (actions ?? []).map(action => ({
      actions: [action],
    })),
  })
}

export function createProgressReporter(
  notificationService: NotificationServiceClient,
  notificationId: string,
  title: string,
  prefix?: string,
  actions?: ProgressNotificationAction[],
): (progressLine: string) => Promise<void> {
  const progressLines: string[] = []

  return async progressLine => {
    const normalizedProgressLine = normalizeProgressLine(progressLine)
    if (!normalizedProgressLine) {
      return
    }

    await updateProgressNotification(
      notificationService,
      notificationId,
      title,
      appendProgressLine(progressLines, normalizedProgressLine),
      prefix,
      actions,
    )
  }
}

export function appendProgressLine(progressLines: string[], progressLine: string): string[] {
  progressLines.push(progressLine)
  if (progressLines.length > PROGRESS_NOTIFICATION_HISTORY_LIMIT) {
    progressLines.splice(0, progressLines.length - PROGRESS_NOTIFICATION_HISTORY_LIMIT)
  }

  return progressLines
}

export function normalizeProgressLine(value: string): string | undefined {
  const normalized = value
    .split("\n")
    .map(line => line.trim())
    .find(line => line.length > 0)

  if (!normalized) {
    return undefined
  }

  const lowercase = normalized.toLowerCase()
  return (
    lowercase
      .replace(/[.!?,:;…]+$/g, "")
      .slice(0, 120)
      .trim() || undefined
  )
}
