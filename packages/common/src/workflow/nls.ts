export type AskLanguageEngineInput = {
  /**
   * Stable identifier of the user-level invocation that caused this prompt.
   */
  invocationId: string

  /**
   * Stable identifier of the language session to continue or create.
   */
  sessionId: string

  /**
   * User text prompt to send into the language engine session.
   */
  text: string
}

export type AskLanguageEngineOutput = {
  /**
   * Final language-engine response text.
   */
  text: string
}

export type LanguageActivities = {
  /**
   * Sends a prompt to the language engine within a stateful session.
   *
   * The activity creates or continues the session by `sessionId`
   * and returns the final response text wrapped in an output object.
   */
  askLanguageEngine: (input: AskLanguageEngineInput) => Promise<AskLanguageEngineOutput>
}
