import type { AlphaData } from "@contracts/alpha.v1"
import { resolve } from "node:path"
import { Graphviz } from "@hpcc-js/wasm-graphviz"
import { resolveDisplayInfo } from "@reside/shared"
import { Resvg } from "@resvg/resvg-js"
import { InputFile } from "grammy"

export async function drawReplicaGraph(alphaData: AlphaData, locale?: string): Promise<InputFile> {
  const loadedData = await alphaData.$jazz.ensureLoaded({
    resolve: {
      replicas: {
        $each: {
          currentVersion: {
            requirements: {
              $each: {
                replicas: { $each: true },
              },
            },
          },
        },
      },
    },
  })

  const lines = [
    "digraph G {",
    "  rankdir=LR;",
    "  node [shape=box];",
    "  edge [headport=w, tailport=e];",
    '  node [fontname="Courier New"];',
    "  node [style=filled colorscheme=dark26];",
    "  ranksep=0.8;",
  ]

  // define nodes
  for (const replica of loadedData.replicas.values()) {
    const displayInfo = resolveDisplayInfo(replica.currentVersion!.displayInfo, locale)
    const title = displayInfo?.title ?? replica.name

    const path = resolve(
      import.meta.path,
      `../../assets/replicas-compressed/${replica.info.name}.png`,
    )

    lines.push(`  ${replica.name.replaceAll("-", "_")} [image="${path}", label="${title}"];`)
  }

  // define edges
  for (const replica of loadedData.replicas.values()) {
    for (const requirement of Object.values(replica.currentVersion!.requirements)) {
      for (const reqReplica of requirement.replicas.values()) {
        lines.push(
          `  ${replica.name.replaceAll("-", "_")} -> ${reqReplica.name.replaceAll("-", "_")};`,
        )
      }
    }
  }

  lines.push("}")

  const graphviz = await Graphviz.load()
  const result = graphviz.layout(lines.join("\n"), "svg", "dot")

  const resvg = new Resvg(result, { fitTo: { mode: "original" } })
  const content = resvg.render().asPng()

  return new InputFile(content, "replica-graph.png")
}
