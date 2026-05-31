export type FetchKeyRateOutput = {
  /**
   * The latest key rate value.
   */
  rate: number
}

export type RateActivities = {
  /**
   * Fetches the latest key rate from the external source.
   */
  fetchKeyRate: () => Promise<FetchKeyRateOutput>
}
