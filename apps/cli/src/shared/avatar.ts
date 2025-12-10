import type { Logger } from "pino"
import type { ResideConfig } from "./package-config"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { GoogleGenAI } from "@google/genai"
import { loadConfig } from "@reside/shared"
import { z } from "zod"

function createAvatarPrompt(replicaPrompt: string): string {
  return `
    BASE: chibi anime character design, petite super-deformed young woman, 
          oversized head with expressive heterochromatic eyes electric blue and deep purple, 
          fluffy silver-blue hair in high ponytail with cyan-glowing strands and ribbon loop, 
          miniature oversized navy hoodie with geometric pattern, tiny dark gray shorts, 
          stubby thigh-high socks with LED sparkle, tiny white sneakers, smart bracelet simplified, 
          holographic hair clips floating, arms slightly out for balance, cheerful neutral pose, 
          clean white background, flat bright lighting, high-resolution chibi cel shading, 
          inspired by Q-version anime art

    PERSONAL: ${replicaPrompt}

    SITUATION: formal id photo style, straight-on camera, neutral closed-mouth 
    expression, shoulders squared, hands out of frame, hair neatly secured, no motion, 
    no extra effects, even studio lighting, symmetrical composition
  `
}

const GeminiConfig = z.object({
  GEMINI_API_KEY: z.string().min(1),
})

/**
 * Generates an avatar image for a replica manifest using Google Gemini's image generation model.
 * The generated image is saved as "REPLICA.png" in the current working directory.
 */
export async function generateReplicaAvatar(config: ResideConfig, logger: Logger): Promise<void> {
  if (config.manifest.type !== "replica") {
    throw new Error("Avatar can only be placed for replica manifests")
  }

  const geminiConfig = loadConfig(GeminiConfig)
  const client = new GoogleGenAI({ apiKey: geminiConfig.GEMINI_API_KEY })

  if (!config.manifest.avatarPrompt) {
    throw new Error("No avatar prompt specified in replica manifest")
  }

  const fullPrompt = createAvatarPrompt(config.manifest.avatarPrompt)
  logger.debug(`generating avatar with prompt: "%s"`, fullPrompt)

  const { generatedImages } = await client.models.generateImages({
    model: "imagen-4.0-generate-001",
    prompt: fullPrompt,
    config: {
      aspectRatio: "1:1",
      imageSize: "1K",
      numberOfImages: 1,
    },
  })

  const content = generatedImages?.[0]?.image?.imageBytes
  if (!content) {
    throw new Error("No image content generated")
  }

  const avatarPath = path.resolve(process.cwd(), "REPLICA.png")
  const buffer = Buffer.from(content, "base64")

  await writeFile(avatarPath, buffer)
}
