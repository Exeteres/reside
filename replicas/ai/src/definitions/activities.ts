export type CreateAiImageInput = {
  /**
   * The requested image size.
   */
  size: string

  /**
   * The text prompt used to generate the image.
   */
  prompt: string
}

export type CreateAiImageOutput = {
  /**
   * The presigned URL for the generated image.
   */
  url: string
}

export type AiActivities = {
  /**
   * Generates an image and uploads it to S3.
   */
  createAiImage: (input: CreateAiImageInput) => Promise<CreateAiImageOutput>
}
