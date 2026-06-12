import { registerGracefulShutdown } from "../utils"
import type { LanguageActivities } from "../workflow"
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
  allowedSystemTools,
  tools,
  tags,
  storageCredentials,
  copilotClientProvider,
}: CreateLanguageEngineOptions): Promise<LanguageActivities> {
  const languageEngine: LanguageEngine = await createLanguageEngine({
    services,
    model,
    sessionPrefix,
    systemPrompt,
    allowedSystemTools,
    tools,
    tags,
    storageCredentials,
    copilotClientProvider,
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
