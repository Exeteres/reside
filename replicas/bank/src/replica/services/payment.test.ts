import type { NotificationServiceClient } from "@reside/api/interaction/notification.v1"
import { describe, expect, mock, test } from "bun:test"
import { BankNotificationChannels } from "../../definitions"
import { strings } from "../../locale"
import { sendRejectedPaymentNotification } from "./payment"

describe("sendRejectedPaymentNotification", () => {
  test("sends automatic rejection reason to payer partition", async () => {
    const notificationService = {
      sendNotification: mock(async () => ({})),
    } as unknown as NotificationServiceClient

    await sendRejectedPaymentNotification({
      notificationService,
      payerSubjectId: "telegram:1",
      result: {
        status: "REJECTED",
        rejectionReason: strings.errors.insufficientFunds,
      },
    })

    expect(notificationService.sendNotification).toHaveBeenCalledWith({
      channel: BankNotificationChannels.PAYMENT_REQUESTS,
      partition: "telegram:1",
      title: strings.notifications.bank.paymentRequest.title,
      content: strings.notifications.bank.paymentRequest.rejectedWithReason(
        strings.errors.insufficientFunds,
      ),
      requiresTextResponse: false,
    })
  })

  test("does not send notification for reasonless stored rejection", async () => {
    const notificationService = {
      sendNotification: mock(async () => ({})),
    } as unknown as NotificationServiceClient

    await sendRejectedPaymentNotification({
      notificationService,
      payerSubjectId: "telegram:1",
      result: { status: "REJECTED" },
    })

    expect(notificationService.sendNotification).not.toHaveBeenCalled()
  })
})
