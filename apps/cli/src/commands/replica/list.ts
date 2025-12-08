import { defineCommand } from "citty"
import { contextArgs, createJazzContextForCurrentContext } from "../../shared"
import { resolveDisplayInfo } from "../../shared/ui"

export const listReplicasCommand = defineCommand({
  meta: {
    description: "Lists all replicas defined in the cluster.",
  },
  args: {
    ...contextArgs,
  },

  async run({ args }) {
    const { alpha, logOut } = await createJazzContextForCurrentContext(args.context)

    const loadedAlpha = await alpha.data.$jazz.ensureLoaded({
      resolve: {
        replicas: {
          $each: {
            account: true,
            currentVersion: true,
            management: true,
          },
        },
      },
    })

    console.table(
      Object.fromEntries(
        Object.values(loadedAlpha.replicas).map(replica => {
          const displayInfo = resolveDisplayInfo(replica.currentVersion?.displayInfo)

          return [
            replica.id,
            {
              name: replica.name,
              status: replica.currentVersion?.status ?? "N/A",
              title: displayInfo?.title ?? "N/A",
              description: displayInfo?.description ?? "N/A",
              accountId: replica.account.$jazz.id,
              currentVersionId: replica.currentVersion?.id ?? "N/A",
              enabled: replica.management?.enabled ? "Yes" : "No",
              placementGroup: replica.management?.placementGroup ?? "N/A",
            },
          ]
        }),
      ),
    )

    await logOut()
  },
})
