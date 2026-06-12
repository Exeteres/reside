import type { MessageElement } from "@reside/common"
import {
  block,
  createNotificationTopic,
  defineCommandHandler,
  sendNotification,
  updateNotification,
} from "@reside/common/workflow"
import { defineQuery, log, proxyActivities, setHandler } from "@temporalio/workflow"
import {
  createTaskCommand,
  EngineerNotificationChannels,
  type EngineerTaskActivities,
  type RunImplementationInteractionOutput,
} from "../definitions"
import { strings } from "../locale"

const {
  startPlanningInteraction,
  submitPlanningFeedbackInteraction,
  approveTask,
  requestCancellation,
  runImplementationInteraction,
  reviveTaskFromFeedback,
} = proxyActivities<EngineerTaskActivities>({ scheduleToCloseTimeout: "30 minutes" })

const taskMessageLinkQuery = defineQuery<string | undefined>("taskMessageLink")

export const createTaskCommandHandler = defineCommandHandler({
  command: createTaskCommand,
  async handler({ params, invocation }) {
    if (!invocation.subjectId) {
      throw new Error("Command invocation is missing subjectId")
    }

    let taskMessageLink: string | undefined
    setHandler(taskMessageLinkQuery, () => taskMessageLink)

    const mode = invocation.parameters?.mode === "implement" ? "implement" : "plan"

    let planning = await runPlanningInteraction({
      prompt: params.task,
      subjectId: invocation.subjectId,
    })

    const topic = await createNotificationTopic({
      channel: EngineerNotificationChannels.TASKS,
      title: planning.result.issueTitle,
    })

    if (mode === "plan") {
      while (true) {
        const planningReply = await sendNotification({
          topicId: topic.topicId,
          acquireTopic: true,
          channel: EngineerNotificationChannels.TASKS,
          title: strings.notifications.taskPlanning.readyTitle,
          message: renderMarkdownAsTelegramHtml(planning.result.resultSummary),
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
        taskMessageLink ??= planningReply.messageLink

        if (planningReply.type === "action") {
          if (planningReply.actionName === "cancel") {
            await requestCancellation({
              taskId: planning.result.taskId,
            })

            return
          }

          await approveTask({
            taskId: planning.result.taskId,
          })

          break
        }

        await updateNotification({
          notificationId: planningReply.notificationId,
          title: strings.notifications.taskAnalysis.title,
          content: block(strings.notifications.taskAnalysis.updating),
          actions: {},
          requiresTextResponse: false,
        })

        planning = await runPlanningFeedbackInteraction({
          notificationId: planningReply.notificationId,
          taskId: planning.result.taskId,
          feedback: planningReply.text,
        })
      }
    } else {
      await approveTask({
        taskId: planning.result.taskId,
      })
    }

    let implementationPrompt = strings.notifications.taskExecution.initialPrompt
    let implementationContextToken: string | undefined
    const taskId = planning.result.taskId

    while (true) {
      log.info("engineer workflow starting implementation iteration", {
        taskId,
        hasContextToken: implementationContextToken !== undefined,
      })

      const implementationNotification = await sendNotification({
        contextToken: implementationContextToken,
        topicId: topic.topicId,
        acquireTopic: true,
        channel: EngineerNotificationChannels.TASKS,
        title: strings.notifications.taskExecution.inProgressTitle,
        message: block(strings.notifications.taskExecution.inProgressMessage),
      })
      taskMessageLink ??= implementationNotification.messageLink

      log.info("engineer workflow implementation notification sent", {
        taskId,
        notificationId: implementationNotification.notificationId,
      })

      let finished: RunImplementationInteractionOutput | undefined
      const runPromise = runImplementationInteraction({
        taskId,
        prompt: implementationPrompt,
        progressNotificationId: implementationNotification.notificationId,
      }).then(result => {
        finished = result
        log.info("engineer workflow implementation interaction finished", {
          taskId,
          status: result.status,
        })
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

        log.info("engineer workflow received implementation notification reply", {
          taskId,
          type: runningReply.type,
          actionName: runningReply.type === "action" ? runningReply.actionName : undefined,
        })

        if (runningReply.type === "cancelled") {
          log.info("engineer workflow implementation wait cancelled due to completion", { taskId })
          break
        }

        if (runningReply.type === "action") {
          log.info("engineer workflow requesting task cancellation from action", {
            taskId,
            actionName: runningReply.actionName,
          })

          await requestCancellation({ taskId })

          log.info("engineer workflow cancellation request activity completed", { taskId })

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

      log.info("engineer workflow handling implementation result", {
        taskId,
        status: implementationResult.status,
      })

      if (implementationResult.status === "CANCELLED") {
        await updateNotification({
          notificationId: implementationNotification.notificationId,
          title: strings.notifications.taskExecution.doneTitle,
          content: block(strings.notifications.taskExecution.cancelledSummary),
          actions: {},
          requiresTextResponse: false,
        })

        return
      }

      if (implementationResult.status === "COMPLETED") {
        const terminalReply = await updateNotification({
          notificationId: implementationNotification.notificationId,
          title: strings.notifications.taskExecution.doneTitle,
          content: renderMarkdownAsTelegramHtml(
            implementationResult.resultSummary ??
              strings.notifications.taskExecution.defaultSummary,
          ),
          actions: {},
          requiresTextResponse: true,
        })

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

        await reviveTaskFromFeedback({ taskId })
        implementationPrompt = terminalReply.text
        implementationContextToken = terminalReply.contextToken
      } else {
        const terminalReply = await updateNotification({
          notificationId: implementationNotification.notificationId,
          title: strings.notifications.taskExecution.failedTitle,
          content: block(
            implementationResult.errorMessage ?? strings.notifications.taskExecution.defaultFailure,
          ),
          actions: {},
          requiresTextResponse: true,
        })

        await updateNotification({
          notificationId: implementationNotification.notificationId,
          title: strings.notifications.taskExecution.failedTitle,
          content: block(
            implementationResult.errorMessage ?? strings.notifications.taskExecution.defaultFailure,
          ),
          actions: {},
          requiresTextResponse: false,
        })

        await reviveTaskFromFeedback({ taskId })
        implementationPrompt = terminalReply.text
        implementationContextToken = terminalReply.contextToken
      }
    }
  },
})

async function runPlanningInteraction({
  subjectId,
  prompt,
}: {
  subjectId: string
  prompt: string
}) {
  const notification = await sendNotification({
    channel: EngineerNotificationChannels.TASKS,
    title: strings.notifications.taskAnalysis.title,
    message: block(strings.notifications.taskAnalysis.creating),
  })

  const result = await startPlanningInteraction({
    subjectId,
    prompt,
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

async function runPlanningFeedbackInteraction({
  notificationId,
  taskId,
  feedback,
}: {
  notificationId: string
  taskId: string
  feedback: string
}) {
  const result = await submitPlanningFeedbackInteraction({
    taskId,
    feedback,
    progressNotificationId: notificationId,
  })

  return {
    notificationId,
    result,
  }
}
