export type SendNotcompelImageOutput = {
  /**
   * The identifier of the created notification.
   */
  notificationId: string

  /**
   * The optional external link to the created notification message.
   */
  messageLink?: string
}

export type NotcompelActivities = {
  /**
   * Sends the current Notcompel image to the system chat.
   */
  sendNotcompelImage: () => Promise<SendNotcompelImageOutput>
}
