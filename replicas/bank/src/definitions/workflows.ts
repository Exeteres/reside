export const PAYMENT_REQUEST_WORKFLOW_TYPE = "confirmPaymentRequestWorkflow"

export type ConfirmPaymentRequestWorkflowInput = {
  /**
   * The bank operation identifier for the payment request being confirmed.
   */
  operationId: number
}

export function getPaymentRequestWorkflowId(operationId: number): string {
  return `payment-request-${operationId}`
}
