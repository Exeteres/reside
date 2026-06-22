export type FetchKeyRateOutput = {
  /**
   * The latest key rate value.
   */
  rate: number
}

export type UpdateChatTitleRateInput = {
  /**
   * The opaque interaction context token identifying the Telegram chat.
   */
  contextToken: string

  /**
   * The latest key rate value.
   */
  rate: number
}

export type UpdateChatTitleRateOutput = {
  /**
   * Whether the chat title was updated.
   */
  updated: boolean
}

export type RateActivities = {
  /**
   * Fetches the latest key rate from the external source.
   */
  fetchKeyRate: () => Promise<FetchKeyRateOutput>

  /**
   * Updates the Telegram chat title with the latest key rate when possible.
   */
  updateChatTitleRate: (input: UpdateChatTitleRateInput) => Promise<UpdateChatTitleRateOutput>
}
