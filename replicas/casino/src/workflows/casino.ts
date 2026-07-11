import type { CasinoActivities, ParsedBet } from "../definitions"
import {
  block,
  bold,
  defineCommandHandler,
  inline,
  safeSleep,
  sendNotification,
  updateNotification,
  waitForOperationSuccess,
} from "@reside/common/workflow"
import { proxyActivities, workflowInfo } from "@temporalio/workflow"
import { betCommand, CasinoNotificationChannels, CasinoValidationError } from "../definitions"
import { strings } from "../locale"
import { DICE_EMOJI } from "../replica/business"

const DICE_ANIMATION_DELAY_MS = 3_000
const LOST_STICKER_FILE_ID =
  "CAACAgIAAx0CS1QOwgABDO_UakPrOtXpsJrbYGOg4AABlpxqtHFTAAKNLQACKrURSMNB8V6_UNqfPAQ"

const {
  assertCasinoCanCoverPayout,
  completePayout,
  createBet,
  failBet,
  markLoss,
  markPaymentRejected,
  markPayoutPending,
  markWaitingDice,
  parseBet,
  requestBetPayment,
  saveNotification,
} = proxyActivities<CasinoActivities>({
  scheduleToCloseTimeout: "30 seconds",
  retry: {
    initialInterval: "3 seconds",
    backoffCoefficient: 2,
    maximumAttempts: 3,
    nonRetryableErrorTypes: [CasinoValidationError.name],
  },
})

const { transferPayout } = proxyActivities<CasinoActivities>({
  scheduleToCloseTimeout: "365 days",
  retry: {
    initialInterval: "5 seconds",
    backoffCoefficient: 2,
    maximumInterval: "5 minutes",
  },
})

const { subscribeToBankOperationCompletion } = proxyActivities<{
  subscribeToBankOperationCompletion: (operationId: number, workflowId: string) => Promise<unknown>
}>({
  scheduleToCloseTimeout: "30 seconds",
  retry: {
    initialInterval: "3 seconds",
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
})

export const betCommandHandler = defineCommandHandler({
  command: betCommand,
  async handler({ context, params }) {
    if (!context.subjectId) {
      throw new Error("Bet command invocation is missing subjectId")
    }
    if (!context.invocationId) {
      throw new Error("Bet command invocation is missing invocationId")
    }

    let parsed: ParsedBet
    try {
      parsed = (await parseBet({ amount: String(params.amount), rawSides: params.sides })).parsed
      await assertCasinoCanCoverPayout({ payoutAmountEcid: parsed.payoutAmountEcid })
    } catch (error) {
      await sendNotification({
        channel: CasinoNotificationChannels.COMMAND,
        title: strings.notifications.bet.rejected.title,
        message: formatRejectionMessage(error),
        system: true,
      })
      return
    }

    const { betId } = await createBet({
      invocationId: context.invocationId,
      workflowId: workflowInfo().workflowId,
      playerSubjectId: context.subjectId,
      amountEcid: parsed.amountEcid,
      sides: parsed.sides,
      payoutAmountEcid: parsed.payoutAmountEcid,
    })

    const notification = await sendNotification({
      channel: CasinoNotificationChannels.COMMAND,
      title: strings.notifications.bet.payment.title,
      message: formatPaymentMessage(parsed),
      system: true,
      waitForResponse: false,
    })

    await saveNotification({ betId, notificationId: notification.notificationId })

    let payment = await requestBetPayment({ betId })
    if (payment.status === "PENDING") {
      if (payment.paymentOperationId === undefined) {
        throw new Error("Pending payment is missing operation id")
      }

      await waitForOperationSuccess(
        payment.paymentOperationId,
        subscribeToBankOperationCompletion as never,
      )
      payment = await requestBetPayment({ betId })
    }

    if (payment.status === "REJECTED") {
      await markPaymentRejected({ betId })
      await updateNotification({
        notificationId: notification.notificationId,
        title: strings.notifications.bet.paymentRejected.title,
        content: strings.notifications.bet.paymentRejected.content,
      })
      return
    }

    await markWaitingDice({ betId })
    const dice = await updateNotification({
      notificationId: notification.notificationId,
      title: strings.notifications.bet.waitingDice.title,
      content: formatWaitingDiceMessage(parsed),
      actions: {},
      requiresTextResponse: false,
      acceptedDiceEmojis: [DICE_EMOJI],
      protectedForSubjectId: context.subjectId,
    })

    if (dice.type !== "dice" || dice.emoji !== DICE_EMOJI || dice.value < 1 || dice.value > 6) {
      await failBet({ betId, failureMessage: strings.errors.invalidSideValue })
      await sendNotification({
        channel: CasinoNotificationChannels.COMMAND,
        contextToken: dice.contextToken,
        title: strings.notifications.bet.failed.title,
        message: strings.errors.invalidSideValue,
        system: dice.contextToken === undefined,
        waitForResponse: false,
      })
      return
    }

    await safeSleep(DICE_ANIMATION_DELAY_MS)

    if (!parsed.sides.includes(dice.value)) {
      await markLoss({ betId, diceEmoji: dice.emoji, diceValue: dice.value })
      await sendNotification({
        channel: CasinoNotificationChannels.COMMAND,
        contextToken: dice.contextToken,
        title: strings.notifications.bet.lost.title,
        message: formatLostMessage(parsed, dice.value),
        stickerFileId: LOST_STICKER_FILE_ID,
        system: dice.contextToken === undefined,
        waitForResponse: false,
      })
      return
    }

    await markPayoutPending({ betId, diceEmoji: dice.emoji, diceValue: dice.value })
    const resultNotification = await sendNotification({
      channel: CasinoNotificationChannels.COMMAND,
      contextToken: dice.contextToken,
      title: strings.notifications.bet.wonPending.title,
      message: formatWonPendingMessage(parsed, dice.value),
      system: dice.contextToken === undefined,
      waitForResponse: false,
    })

    const payout = await transferPayout({ betId })
    await completePayout({ betId, transactionId: payout.transactionId })
    await updateNotification({
      notificationId: resultNotification.notificationId,
      title: strings.notifications.bet.paid.title,
      content: formatPaidMessage(parsed, dice.value, payout.transactionId),
    })
  },
})

function formatRejectionMessage(error: unknown) {
  const message =
    error instanceof Error ? error.message : strings.notifications.bet.failed.beforePayment

  return block(inline(message), inline(strings.notifications.bet.rejected.example))
}

function formatPaymentMessage(parsed: ParsedBet) {
  return block(
    formatBetSummary(parsed),
    "",
    inline(strings.notifications.bet.payment.confirmBank),
    inline(strings.notifications.bet.payment.throwAfterPayment),
  )
}

function formatWaitingDiceMessage(parsed: ParsedBet) {
  return block(
    inline(strings.notifications.bet.waitingDice.paymentAccepted),
    formatBetSummary(parsed),
    "",
    inline(strings.notifications.bet.waitingDice.prompt),
  )
}

function formatLostMessage(parsed: ParsedBet, diceValue: number) {
  return block(
    inline(bold(strings.labels.dice), ": ", String(diceValue)),
    inline(bold(strings.labels.selectedSides), ": ", formatSides(parsed.sides)),
    inline(strings.notifications.bet.lost.content(parsed.amountEcid)),
  )
}

function formatWonPendingMessage(parsed: ParsedBet, diceValue: number) {
  return block(
    inline(bold(strings.labels.dice), ": ", String(diceValue)),
    inline(bold(strings.labels.selectedSides), ": ", formatSides(parsed.sides)),
    inline(strings.notifications.bet.wonPending.payout(parsed.payoutAmountEcid)),
    inline(strings.notifications.bet.wonPending.sending),
  )
}

function formatPaidMessage(parsed: ParsedBet, diceValue: number, transactionId: string) {
  return block(
    inline(bold(strings.labels.dice), ": ", String(diceValue)),
    inline(bold(strings.labels.selectedSides), ": ", formatSides(parsed.sides)),
    inline(bold(strings.labels.paid), ": ", parsed.payoutAmountEcid, " ∅"),
    inline(bold(strings.labels.transaction), ": ", transactionId),
  )
}

function formatBetSummary(parsed: ParsedBet) {
  return block(
    inline(bold(strings.labels.bet), ": ", parsed.amountEcid, " ∅"),
    inline(bold(strings.labels.sides), ": ", formatSides(parsed.sides)),
    inline(bold(strings.labels.multiplier), ": ", parsed.multiplierLabel),
    inline(bold(strings.labels.payout), ": ", parsed.payoutAmountEcid, " ∅"),
  )
}

function formatSides(sides: number[]): string {
  return sides.join(", ")
}
