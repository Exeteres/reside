import type { MessageElement } from "@reside/common"
import {
  block,
  defineCommandHandler,
  sendNotification,
  updateNotification,
} from "@reside/common/workflow"
import { proxyActivities } from "@temporalio/workflow"
import { createTaskCommand, EngineerNotificationChannels } from "../definitions"
import { strings } from "../locale"

type PlanningResult = {
  taskId: string
  issueTitle: string
  issueUrl: string
  repositoryUrl: string
  resultSummary: string
}

type ImplementationResult = {
  taskId: string
  status: "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED"
  resultSummary?: string
  errorMessage?: string
}

const activities = proxyActivities<{
  startPlanningInteraction: (input: {
    subjectId: string
    prompt: string
    progressNotificationId: string
  }) => Promise<PlanningResult>
  submitPlanningFeedbackInteraction: (input: {
    taskId: string
    feedback: string
    progressNotificationId: string
  }) => Promise<PlanningResult>
  approveTask: (input: { taskId: string }) => Promise<void>
  requestCancellation: (input: { taskId: string }) => Promise<void>
  runImplementationInteraction: (input: {
    taskId: string
    prompt: string
    progressNotificationId: string
  }) => Promise<ImplementationResult>
  reviveTaskFromFeedback: (input: { taskId: string }) => Promise<void>
}>({ scheduleToCloseTimeout: "30 minutes" })

export const createTaskCommandHandler = defineCommandHandler({
  command: createTaskCommand,
  async handler({ params, invocation }) {
    if (!invocation.subjectId) {
      throw new Error("Command invocation is missing subjectId")
    }

    let planning = await runPlanningInteraction({
      prompt: params.task,
      subjectId: invocation.subjectId,
    })

    while (true) {
      const planningReply = await updateNotification({
        notificationId: planning.notificationId,
        title: strings.notifications.taskPlanning.readyTitle,
        content: renderMarkdownAsTelegramHtml(planning.result.resultSummary),
        actions: {
          issue: {
            title: strings.notifications.taskPlanning.actions.issue,
            url: planning.result.issueUrl,
          },
          approve: {
            title: strings.notifications.taskPlanning.actions.approve,
          },
          cancel: {
            title: strings.notifications.taskPlanning.actions.cancel,
          },
        },
        requiresTextResponse: true,
      })

      if (planningReply.type === "action") {
        if (planningReply.actionName === "cancel") {
          await activities.requestCancellation({
            taskId: planning.result.taskId,
          })

          await updateNotification({
            notificationId: planning.notificationId,
            title: strings.notifications.taskExecution.doneTitle,
            content: block(strings.notifications.taskExecution.cancelledSummary),
          })

          return
        }

        await activities.approveTask({
          taskId: planning.result.taskId,
        })

        break
      }

      await updateNotification({
        notificationId: planning.notificationId,
        title: strings.notifications.taskAnalysis.title,
        content: block(strings.notifications.taskAnalysis.updating),
        actions: {},
        requiresTextResponse: false,
      })

      planning = await runPlanningFeedbackInteraction({
        taskId: planning.result.taskId,
        feedback: planningReply.text,
      })
    }

    let implementationPrompt = strings.notifications.taskExecution.initialPrompt
    let implementationContextToken: string | undefined
    const taskId = planning.result.taskId

    while (true) {
      const implementationNotification = await sendNotification({
        contextToken: implementationContextToken,
        channel: EngineerNotificationChannels.TASKS,
        title: strings.notifications.taskExecution.inProgressTitle,
        message: block(strings.notifications.taskExecution.inProgressMessage),
      })

      let finished: ImplementationResult | undefined
      const runPromise = activities
        .runImplementationInteraction({
          taskId,
          prompt: implementationPrompt,
          progressNotificationId: implementationNotification.notificationId,
        })
        .then(result => {
          finished = result
          return result
        })

      while (!finished) {
        const runningReply = await updateNotification({
          notificationId: implementationNotification.notificationId,
          title: strings.notifications.taskExecution.inProgressTitle,
          content: block(strings.notifications.taskExecution.runningAwaitingInput),
          actions: {
            cancel: {
              title: strings.notifications.taskExecution.actions.cancel,
            },
          },
          requiresTextResponse: true,
          cancelWhen: () => finished !== undefined,
        })

        if (runningReply.type === "cancelled") {
          break
        }

        if (runningReply.type === "action") {
          await activities.requestCancellation({ taskId })

          await updateNotification({
            notificationId: implementationNotification.notificationId,
            title: strings.notifications.taskExecution.inProgressTitle,
            content: block(strings.notifications.taskExecution.cancellationRequested),
          })

          continue
        }

        await updateNotification({
          notificationId: implementationNotification.notificationId,
          title: strings.notifications.taskExecution.inProgressTitle,
          content: block(strings.notifications.taskExecution.changeRejectedWhileRunning),
        })
      }

      const implementationResult = finished ?? (await runPromise)

      if (implementationResult.status === "COMPLETED") {
        const terminalReply = await updateNotification({
          notificationId: implementationNotification.notificationId,
          title: strings.notifications.taskExecution.doneTitle,
          content: renderMarkdownAsTelegramHtml(
            implementationResult.resultSummary ??
              strings.notifications.taskExecution.defaultSummary,
          ),
          actions: {
            cancel: {
              title: strings.notifications.taskExecution.actions.cancel,
            },
          },
          requiresTextResponse: true,
        })

        if (terminalReply.type === "action") {
          await activities.requestCancellation({ taskId })

          await updateNotification({
            notificationId: implementationNotification.notificationId,
            title: strings.notifications.taskExecution.doneTitle,
            content: block(strings.notifications.taskExecution.cancelledSummary),
            actions: {},
            requiresTextResponse: false,
          })

          return
        }

        await updateNotification({
          notificationId: implementationNotification.notificationId,
          title: strings.notifications.taskExecution.doneTitle,
          content: renderMarkdownAsTelegramHtml(
            implementationResult.resultSummary ??
              strings.notifications.taskExecution.defaultSummary,
          ),
          actions: {},
          requiresTextResponse: false,
        })

        await activities.reviveTaskFromFeedback({ taskId })
        implementationPrompt = terminalReply.text
        implementationContextToken = terminalReply.contextToken
      } else {
        const terminalReply = await updateNotification({
          notificationId: implementationNotification.notificationId,
          title: strings.notifications.taskExecution.failedTitle,
          content: block(
            implementationResult.errorMessage ?? strings.notifications.taskExecution.defaultFailure,
          ),
          actions: {
            cancel: {
              title: strings.notifications.taskExecution.actions.cancel,
            },
          },
          requiresTextResponse: true,
        })

        if (terminalReply.type === "action") {
          await activities.requestCancellation({ taskId })

          await updateNotification({
            notificationId: implementationNotification.notificationId,
            title: strings.notifications.taskExecution.doneTitle,
            content: block(strings.notifications.taskExecution.cancelledSummary),
            actions: {},
            requiresTextResponse: false,
          })

          return
        }

        await updateNotification({
          notificationId: implementationNotification.notificationId,
          title: strings.notifications.taskExecution.failedTitle,
          content: block(
            implementationResult.errorMessage ?? strings.notifications.taskExecution.defaultFailure,
          ),
          actions: {},
          requiresTextResponse: false,
        })

        await activities.reviveTaskFromFeedback({ taskId })
        implementationPrompt = terminalReply.text
        implementationContextToken = terminalReply.contextToken
      }
    }
  },
})

async function runPlanningInteraction(input: { subjectId: string; prompt: string }) {
  const notification = await sendNotification({
    channel: EngineerNotificationChannels.TASKS,
    title: strings.notifications.taskAnalysis.title,
    message: block(strings.notifications.taskAnalysis.creating),
  })

  const result = await activities.startPlanningInteraction({
    subjectId: input.subjectId,
    prompt: input.prompt,
    progressNotificationId: notification.notificationId,
  })

  return {
    notificationId: notification.notificationId,
    result,
  }
}

function renderMarkdownAsTelegramHtml(markdown: string): MessageElement {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n")
  const htmlLines: string[] = []
  let index = 0

  while (index < lines.length) {
    const rawLine = lines[index] ?? ""
    const line = rawLine.trim()

    if (line.startsWith("```")) {
      const blockLines: string[] = []
      index += 1
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        blockLines.push(lines[index] ?? "")
        index += 1
      }

      htmlLines.push(`<pre>${escapeTelegramHtml(blockLines.join("\n"))}</pre>`)
      index += 1
      continue
    }

    if (line.length === 0) {
      htmlLines.push("")
      index += 1
      continue
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line)
    if (headingMatch) {
      htmlLines.push(`<b>${renderInlineMarkdown(headingMatch[2] ?? "")}</b>`)
      index += 1
      continue
    }

    const unorderedMatch = /^[-*+]\s+(.*)$/.exec(line)
    if (unorderedMatch) {
      htmlLines.push(`• ${renderInlineMarkdown(unorderedMatch[1] ?? "")}`)
      index += 1
      continue
    }

    const orderedMatch = /^\d+[.)]\s+(.*)$/.exec(line)
    if (orderedMatch) {
      htmlLines.push(`• ${renderInlineMarkdown(orderedMatch[1] ?? "")}`)
      index += 1
      continue
    }

    const quoteMatch = /^>\s?(.*)$/.exec(line)
    if (quoteMatch) {
      htmlLines.push(`│ ${renderInlineMarkdown(quoteMatch[1] ?? "")}`)
      index += 1
      continue
    }

    htmlLines.push(renderInlineMarkdown(rawLine))
    index += 1
  }

  return {
    html: htmlLines.join("\n"),
  }
}

function renderInlineMarkdown(text: string): string {
  const tokens: Array<{ kind: string; value: string }> = []
  let lastIndex = 0
  const pattern =
    /(\[[^\]]+\]\((https?:\/\/[^\s)]+)\))|(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(~~[^~]+~~)|(\*[^*]+\*)|(_[^_]+_)/g

  for (const match of text.matchAll(pattern)) {
    const fullMatch = match[0]
    if (!fullMatch) {
      continue
    }

    const start = match.index ?? 0
    if (start > lastIndex) {
      tokens.push({ kind: "text", value: text.slice(lastIndex, start) })
    }

    if (fullMatch.startsWith("[")) {
      const linkMatch = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(fullMatch)
      if (linkMatch) {
        tokens.push({ kind: "link-text", value: linkMatch[1] ?? "" })
        tokens.push({ kind: "link-url", value: linkMatch[2] ?? "" })
      } else {
        tokens.push({ kind: "text", value: fullMatch })
      }
    } else if (fullMatch.startsWith("`")) {
      tokens.push({ kind: "code", value: fullMatch.slice(1, -1) })
    } else if (fullMatch.startsWith("**") || fullMatch.startsWith("__")) {
      tokens.push({ kind: "bold", value: fullMatch.slice(2, -2) })
    } else if (fullMatch.startsWith("~~")) {
      tokens.push({ kind: "strike", value: fullMatch.slice(2, -2) })
    } else if (fullMatch.startsWith("*") || fullMatch.startsWith("_")) {
      tokens.push({ kind: "italic", value: fullMatch.slice(1, -1) })
    } else {
      tokens.push({ kind: "text", value: fullMatch })
    }

    lastIndex = start + fullMatch.length
  }

  if (lastIndex < text.length) {
    tokens.push({ kind: "text", value: text.slice(lastIndex) })
  }

  let html = ""
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token) {
      continue
    }

    if (token.kind === "link-text") {
      const nextToken = tokens[index + 1]
      if (nextToken?.kind === "link-url") {
        html += `<a href="${escapeTelegramHtml(nextToken.value)}">${escapeTelegramHtml(token.value)}</a>`
        index += 1
        continue
      }
    }

    if (token.kind === "code") {
      html += `<code>${escapeTelegramHtml(token.value)}</code>`
      continue
    }

    if (token.kind === "bold") {
      html += `<b>${escapeTelegramHtml(token.value)}</b>`
      continue
    }

    if (token.kind === "italic") {
      html += `<i>${escapeTelegramHtml(token.value)}</i>`
      continue
    }

    if (token.kind === "strike") {
      html += `<s>${escapeTelegramHtml(token.value)}</s>`
      continue
    }

    html += escapeTelegramHtml(token.value)
  }

  return html
}

function escapeTelegramHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

async function runPlanningFeedbackInteraction(input: { taskId: string; feedback: string }) {
  const notification = await sendNotification({
    channel: EngineerNotificationChannels.TASKS,
    title: strings.notifications.taskAnalysis.title,
    message: block(strings.notifications.taskAnalysis.updating),
  })

  const result = await activities.submitPlanningFeedbackInteraction({
    taskId: input.taskId,
    feedback: input.feedback,
    progressNotificationId: notification.notificationId,
  })

  return {
    notificationId: notification.notificationId,
    result,
  }
}
