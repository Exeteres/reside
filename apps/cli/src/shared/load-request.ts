import type { ReplicaLoadRequest } from "@contracts/alpha.v1"
import { resolveDisplayInfo } from "./ui"
import styles from "ansi-styles"
import * as YAML from "yaml"

export async function renderLoadRequest(loadRequest: ReplicaLoadRequest): Promise<string> {
  const lines = []

  const stylize = (text: string, ...styleSet: Array<{ open: string; close: string }>) =>
    styleSet.reduce((acc, style) => `${style.open}${acc}${style.close}`, text)

  const statusStyle =
    loadRequest.status === "approved"
      ? styles.green
      : loadRequest.status === "rejected"
        ? styles.red
        : styles.yellow

  lines.push(
    `${stylize("Replica Image:", styles.bold, styles.cyan)} ${stylize(loadRequest.image, styles.whiteBright)}`,
  )
  lines.push(
    `${stylize("Status:", styles.bold, styles.cyan)} ${stylize(loadRequest.status, statusStyle, styles.bold)}`,
  )
  const loadedLoadRequest = await loadRequest.$jazz.ensureLoaded({
    resolve: {
      approveRequest: {
        implementations: { $each: { methods: { $each: true }, permissions: { $each: true } } },
        requirements: {
          $each: {
            contract: true,
            replicas: { $each: true },
            alternatives: { $each: true },
            permissions: { $each: { permission: true } },
          },
        },
      },
    },
  })

  if (loadedLoadRequest.approveRequest) {
    const replicaDisplayInfo = resolveDisplayInfo(loadedLoadRequest.approveRequest.displayInfo)
    if (replicaDisplayInfo) {
      lines.push(
        `${stylize("Title:", styles.bold, styles.cyan)} ${stylize(replicaDisplayInfo.title ?? "N/A", styles.whiteBright)}`,
      )
      if (replicaDisplayInfo.description) {
        lines.push(stylize(replicaDisplayInfo.description, styles.dim))
      }
    }

    for (const [reqKey, req] of Object.entries(loadedLoadRequest.approveRequest.requirements)) {
      const contractDisplayInfo = resolveDisplayInfo(req.contract.displayInfo)

      lines.push("")
      lines.push(
        `${stylize("Requirement:", styles.bold, styles.magenta)} ${stylize(contractDisplayInfo?.title ?? "N/A", styles.white)} (${stylize(reqKey, styles.gray)})`,
      )

      if (contractDisplayInfo?.description) {
        lines.push(`  ${stylize(contractDisplayInfo.description, styles.dim)}`)
      }

      lines.push(
        `  ${stylize("Identity:", styles.bold)} ${stylize(req.contract.identity, styles.whiteBright)}`,
      )
      lines.push(
        `  ${stylize("Optional:", styles.bold)} ${req.optional ? stylize("Yes", styles.bold) : stylize("No", styles.gray)}`,
      )
      lines.push(
        `  ${stylize("Multiple:", styles.bold)} ${req.multiple ? stylize("Yes", styles.bold) : stylize("No", styles.gray)}`,
      )
      lines.push(`  ${stylize("Available Replicas:", styles.bold, styles.cyan)}`)
      for (const replica of Object.values(req.alternatives)) {
        lines.push(
          `    - ${stylize(replica.name, styles.green)} (ID: ${stylize(replica.id.toString(), styles.gray)})`,
        )
      }

      if (req.permissions.length > 0) {
        lines.push(`  ${stylize("Permissions:", styles.bold, styles.cyan)}`)
        for (const [, perm] of Object.entries(req.permissions)) {
          const permission = perm.permission
          const displayInfo = resolveDisplayInfo(permission.displayInfo)

          lines.push(
            `    - ${stylize(displayInfo?.title ?? "N/A", styles.white)} (${stylize(permission.name, styles.gray)})`,
          )

          if (displayInfo?.description) {
            lines.push(`      ${stylize(displayInfo.description, styles.dim)}`)
          }

          if (perm.params && Object.keys(perm.params).length > 0) {
            const params = YAML.stringify(perm.params).trim()
            const prefixedParams = params
              .split("\n")
              .map(line => `      ${line}`)
              .join("\n")

            lines.push(`      ${stylize("Params:", styles.bold)}\n${prefixedParams}`)
          }
        }
      }
    }
  }

  return lines.join("\n")
}
