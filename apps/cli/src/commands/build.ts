import { defineCommand } from "citty"
import {
  createDockerfile,
  getAllPackagesToInclude,
  getRootPath,
  loadPackageConfig,
  logger,
} from "../shared"
import { relative } from "node:path"

export const buildCommand = defineCommand({
  args: {
    tag: {
      description: "The tag to assign to the built image",
      type: "string",
      default: "latest",
    },
    push: {
      description: "Whether to push the built image to the registry",
      type: "boolean",
      default: false,
    },
  },
  async run({ args }) {
    const config = await loadPackageConfig(logger)

    logger.info(`building the image of type "%s"`, config.manifest.type)

    const rootPath = await getRootPath()
    logger.info(`monorepo root path: %s`, rootPath)

    const packagesToInclude = await getAllPackagesToInclude(config.packageName)

    const withRelativePaths = packagesToInclude.map(pkg => ({
      name: pkg.name,
      path: relative(rootPath, pkg.path),
    }))

    const dockerfile = createDockerfile(config.manifest, withRelativePaths, logger)

    logger.debug("generated Dockerfile:\n%s", dockerfile)

    const imageTag = `${config.manifest.identity}:${args.tag}`

    if (args.push) {
      logger.info(`building and pushing image "%s"`, imageTag)
    } else {
      logger.info(`building image "%s"`, imageTag)
    }

    const buildCommand = Bun.spawn(
      ["docker", "build", rootPath, "-f", "-", "-t", imageTag, args.push ? ["--push"] : []].flat(),
      {
        stdin: "pipe",
        stdout: "inherit",
        stderr: "inherit",
      },
    )

    buildCommand.stdin.write(dockerfile)
    await buildCommand.stdin.end()

    const code = await buildCommand.exited

    if (code !== 0) {
      logger.error(`docker build process exited with code ${code}`)
      process.exit(-1)
    }

    if (args.push) {
      logger.info({ success: true }, "image built and pushed successfully")
    } else {
      logger.info({ success: true }, "image built successfully")
    }
  },
})
