import { defineCommand } from "citty"
import { contextArgs, createJazzContextForCurrentContext } from "../../shared"
import { discoverRequirement } from "@contracts/alpha.v1"
import { SecretContract } from "@contracts/secret.v1"
import { resolveDisplayInfo } from "../../shared/ui"

export const listSecretsCommand = defineCommand({
  meta: {
    description: "Lists all secrets defined in the cluster.",
  },
  args: {
    ...contextArgs,
  },

  async run({ args }) {
    const { cluster, alpha, logOut } = await createJazzContextForCurrentContext(args.context)
    const secretManager = await discoverRequirement(alpha.data, SecretContract, cluster.endpoint)

    const loadedSecretManager = await secretManager.data.$jazz.ensureLoaded({
      resolve: {
        secrets: {
          $each: {
            definition: true,
            owner: {
              profile: { $onError: "catch" },
            },
          },
        },
      },
    })

    console.table(
      Object.fromEntries(
        Object.values(loadedSecretManager.secrets).map(secret => {
          const displayInfo = resolveDisplayInfo(secret.definition.displayInfo)

          return [
            secret.id,
            {
              name: secret.name,
              title: displayInfo?.title ?? "N/A",
              description: displayInfo?.description ?? "N/A",
              owner: secret.owner.profile.$isLoaded
                ? `${secret.owner.profile.name} (ID: ${secret.owner.$jazz.id})`
                : `ID: ${secret.owner.$jazz.id}`,
            },
          ]
        }),
      ),
    )

    await logOut()
  },
})
