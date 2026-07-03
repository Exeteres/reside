import type { LanguageActivities } from "../workflow"
import { registerGracefulShutdown } from "../utils"
import {
  type CreateLanguageEngineOptions,
  createLanguageEngine,
  type LanguageEngine,
} from "./engine"

export async function createLanguageActivities({
  services,
  model,
  sessionPrefix,
  systemPrompt,
  tools,
  tags,
  storageCredentials,
}: CreateLanguageEngineOptions): Promise<LanguageActivities> {
  const languageEngine: LanguageEngine = await createLanguageEngine({
    services,
    model,
    sessionPrefix,
    systemPrompt,
    tools,
    tags,
    storageCredentials,
  })

  registerGracefulShutdown(async () => {
    await languageEngine.stop()
  })

  return {
    async askLanguageEngine({ sessionId, text }) {
      const responseText = await languageEngine.ask(sessionId, text)
      return {
        text: responseText,
      }
    },
  }
}
