import { defineCommand } from "citty"
import { generateReplicaAvatar, getRootPath, loadPackageConfig, logger } from "../shared"
import { config as dotenvConfig } from "dotenv"

export const generateAvatarCommand = defineCommand({
  async run() {
    const config = await loadPackageConfig(logger)
    if (config.manifest.type !== "replica") {
      throw new Error("Avatar can only be generated for replica manifests")
    }

    const rootPath = await getRootPath()
    logger.info(`monorepo root path: %s`, rootPath)

    dotenvConfig({ path: `${rootPath}/.env`, quiet: true })

    logger.info(`generating avatar for the replica "%s"`, config.manifest.info.name)

    await generateReplicaAvatar(config, logger)

    logger.info({ success: true }, "avatar generated successfully")
  },
})
