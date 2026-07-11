import type { CasinoActivities } from "../../definitions"
import type { CasinoServices } from "../../shared"
import { PaymentRequestResultStatus } from "@reside/api/bank/payment.v1_pb"
import { z } from "zod"
import { strings } from "../../locale"
import { assertSufficientBalance, parseEncryptedBet } from "../business"

type CasinoActivityServices = Pick<
  CasinoServices,
  "bankPaymentService" | "bankService" | "crypto" | "prisma"
>
const encryptedAmountSchema = z.string()

export function createCasinoActivities({
  bankPaymentService,
  bankService,
  crypto,
  prisma,
}: CasinoActivityServices): CasinoActivities {
  return {
    async parseBet(input) {
      return {
        parsed: await parseEncryptedBet(crypto, input.amount, input.rawSides),
      }
    },

    async assertCasinoCanCoverPayout({ payoutAmountEcid }) {
      const payoutAmount = await crypto.decrypt(encryptedAmountSchema, payoutAmountEcid)
      const balance = await bankService.getBalance({})
      assertSufficientBalance(balance.balance, payoutAmount)
    },

    async createBet(input) {
      const existing = await prisma.bet.findUnique({
        where: { invocationId: input.invocationId },
        select: { id: true },
      })
      if (existing) {
        return { betId: existing.id }
      }

      const bet = await prisma.bet.create({
        data: {
          invocationId: input.invocationId,
          workflowId: input.workflowId,
          playerSubjectId: input.playerSubjectId,
          amountEcid: input.amountEcid,
          sides: input.sides,
          selectedSideCount: input.sides.length,
          payoutAmountEcid: input.payoutAmountEcid,
          paymentIdempotencyKey: `casino:bet-payment:${input.invocationId}`,
          payoutIdempotencyKey: `casino:bet-payout:${input.invocationId}`,
        },
        select: { id: true },
      })

      return { betId: bet.id }
    },

    async saveNotification({ betId, notificationId }) {
      await prisma.bet.update({
        where: { id: betId },
        data: { notificationId },
      })
    },

    async requestBetPayment({ betId }) {
      const bet = await prisma.bet.findUniqueOrThrow({ where: { id: betId } })
      const amount = await crypto.decrypt(encryptedAmountSchema, bet.amountEcid)
      const payoutAmount = await crypto.decrypt(encryptedAmountSchema, bet.payoutAmountEcid)
      const response = await bankPaymentService.requestPayment({
        payerSubjectId: bet.playerSubjectId,
        amount,
        idempotencyKey: bet.paymentIdempotencyKey,
        comment: strings.notifications.bet.payment.bankComment(bet.sides.join(", "), payoutAmount),
      })

      if (response.response.case === "operation") {
        await prisma.bet.update({
          where: { id: bet.id },
          data: { paymentOperationId: response.response.value.id },
        })

        return {
          status: "PENDING" as const,
          paymentOperationId: response.response.value.id,
        }
      }

      if (response.response.case !== "result") {
        throw new Error("Bank payment response is empty")
      }

      const status = response.response.value.status
      if (status === PaymentRequestResultStatus.PAYMENT_REQUEST_REJECTED) {
        return { status: "REJECTED" as const }
      }

      if (status === PaymentRequestResultStatus.PAYMENT_REQUEST_APPROVED_ALWAYS) {
        return { status: "APPROVED_ALWAYS" as const }
      }

      return { status: "APPROVED" as const }
    },

    async markWaitingDice({ betId }) {
      await prisma.bet.update({
        where: { id: betId },
        data: { status: "WAITING_DICE" },
      })
    },

    async markPaymentRejected({ betId }) {
      await prisma.bet.update({
        where: { id: betId },
        data: { status: "PAYMENT_REJECTED", resolvedAt: new Date() },
      })
    },

    async markLoss({ betId, diceEmoji, diceValue }) {
      await prisma.bet.update({
        where: { id: betId },
        data: { status: "LOST", diceEmoji, diceValue, resolvedAt: new Date() },
      })
    },

    async markPayoutPending({ betId, diceEmoji, diceValue }) {
      await prisma.bet.update({
        where: { id: betId },
        data: { status: "PAYOUT_PENDING", diceEmoji, diceValue },
      })
    },

    async transferPayout({ betId }) {
      const bet = await prisma.bet.findUniqueOrThrow({ where: { id: betId } })
      const payoutAmount = await crypto.decrypt(encryptedAmountSchema, bet.payoutAmountEcid)
      const response = await bankService.transfer({
        recipientSubjectId: bet.playerSubjectId,
        amount: payoutAmount,
        idempotencyKey: bet.payoutIdempotencyKey,
        comment: strings.notifications.bet.payoutComment(bet.id),
      })

      return { transactionId: response.transaction?.id ?? "" }
    },

    async completePayout({ betId }) {
      await prisma.bet.update({
        where: { id: betId },
        data: { status: "PAYOUT_COMPLETED", resolvedAt: new Date() },
      })
    },

    async failBet({ betId, failureMessage }) {
      await prisma.bet.update({
        where: { id: betId },
        data: { status: "FAILED", failureMessage, resolvedAt: new Date() },
      })
    },
  }
}
