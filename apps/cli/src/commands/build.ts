import { defineCommand } from "citty"
import { buildCurrentPackageImage, logger } from "../shared"

export const buildCommand = defineCommand({
  args: {
    tag: {
      description: "The tag to assign to the built image. Defaults to replica manifest version.",
      type: "string",
    },
    push: {
      description: "Whether to push the built image to the registry",
      type: "boolean",
      default: false,
    },
    dump: {
      description: "Print the generated Dockerfile to stdout without building the image",
      type: "boolean",
      default: false,
    },
  },
  async run({ args }) {
    await buildCurrentPackageImage({
      logger,
      tag: args.tag,
      push: args.push,
      interactiveDockerOutput: true,
      dump: args.dump,
    })
  },
})
