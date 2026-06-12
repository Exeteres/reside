import type { NotificationServiceClient } from "@reside/api/interaction/notification.v1"
import { html, logger } from "@reside/common"

const PROGRESS_STREAM_EDIT_INTERVAL_MS = 1000

export type ProgressNotificationAction = {
  name: string
  title: string
}

export type ProgressFrame = {
  text: string
  reset?: boolean
}

export type ProgressReporter = {
  report: (frame: ProgressFrame) => Promise<void>
  flush: () => Promise<void>
}

export async function updateProgressNotification(
  notificationService: NotificationServiceClient,
  notificationId: string,
  title: string,
  text: string,
  prefix?: string,
  actions?: ProgressNotificationAction[],
): Promise<boolean> {
  const content = [prefix, prefix !== undefined && text.trim().length > 0 ? "" : undefined, text]
    .filter((line): line is string => typeof line === "string")
    .join("\n")

  try {
    await notificationService.updateNotification({
      notificationId,
      title,
      content: html(content),
      actionRows: (actions ?? []).map(action => ({
        actions: [action],
      })),
    })

    return true
  } catch (error) {
    logger.warn(
      {
        error: error instanceof Error ? error : new Error(String(error)),
        notificationId,
      },
      "failed to update task progress notification",
    )

    return false
  }
}

export function createProgressReporter(
  notificationService: NotificationServiceClient,
  notificationId: string,
  title: string,
  prefix?: string,
  actions?: ProgressNotificationAction[],
): ProgressReporter {
  let displayedText = ""
  let latestPendingText = ""
  let hasPendingUpdate = false
  let flushChain = Promise.resolve()
  let lastEditAt = 0

  const flushPending = async (force: boolean): Promise<void> => {
    if (!hasPendingUpdate) {
      return
    }

    if (!force) {
      await throttleProgressEdit(lastEditAt)
    }

    if (!hasPendingUpdate) {
      return
    }

    const nextText = latestPendingText
    hasPendingUpdate = false

    if (nextText === displayedText) {
      return
    }

    const updated = await updateProgressNotification(
      notificationService,
      notificationId,
      title,
      nextText,
      prefix,
      actions,
    )
    if (!updated) {
      hasPendingUpdate = true
      return
    }

    lastEditAt = Date.now()
    displayedText = nextText
  }

  const queueFlush = () => {
    flushChain = flushChain.then(async () => {
      await flushPending(false)
    })
  }

  return {
    async report(frame) {
      const normalizedProgressText = normalizeProgressText(frame.text)
      if (!normalizedProgressText) {
        return
      }

      if (frame.reset) {
        displayedText = ""
        latestPendingText = ""
        hasPendingUpdate = false
      }

      latestPendingText = normalizedProgressText
      hasPendingUpdate = true
      queueFlush()
    },
    async flush() {
      await flushChain
      await flushPending(true)
    },
  }
}

export function normalizeProgressText(value: string): string | undefined {
  const normalized = value.trim()

  return normalized.length === 0 ? undefined : normalized
}

async function throttleProgressEdit(lastEditAt: number): Promise<void> {
  const now = Date.now()
  const elapsed = now - lastEditAt

  if (lastEditAt > 0 && elapsed < PROGRESS_STREAM_EDIT_INTERVAL_MS) {
    await Bun.sleep(PROGRESS_STREAM_EDIT_INTERVAL_MS - elapsed)
  }
}
