export type CreateExampleNoteInput = {
  /**
   * The non-sensitive title used for the example note record.
   */
  title: string

  /**
   * The note content that must be encrypted before it is persisted.
   */
  content: string

  /**
   * The internal source that requested note creation.
   */
  source: string
}

export type CreateExampleNoteOutput = {
  /**
   * The internal identifier of the created note record.
   */
  noteId: string
}

export type ExampleActivities = {
  /**
   * Stores an encrypted note and uploads a related S3 object.
   */
  createExampleNote: (input: CreateExampleNoteInput) => Promise<CreateExampleNoteOutput>
}
