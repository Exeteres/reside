import type { GoogleGenAI } from "@google/genai"

export class AIService {
  private client?: GoogleGenAI
  private model?: string = "gemini-3-pro-preview"

  private getClient(): GoogleGenAI {
    if (!this.client) {
      throw new Error("Google GenAI client not initialized")
    }

    return this.client
  }

  get enabled(): boolean {
    return !!this.client
  }

  setClient(client: GoogleGenAI | undefined) {
    this.client = client
  }

  setModel(model: string | undefined) {
    this.model = model
  }

  async ask(prompt: string): Promise<string> {
    const client = this.getClient()

    const result = await client.models.generateContent({
      model: this.model!,
      contents: {
        text: prompt,
      },
    })

    return result.data ?? "no response from model"
  }
}
