import type { GoogleGenAI } from "@google/genai"

export class AIService {
  private client?: GoogleGenAI
  private model?: string

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
      model: this.model ?? "gemini-2.5-flash",
      contents: prompt,
    })

    return result.text ?? "no response from model"
  }
}
