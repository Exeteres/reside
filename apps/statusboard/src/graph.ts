import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types"
import { loadedAlphaData, type LoadedAlphaData } from "./data"
import { renderReplica } from "./replica"
import { type Component, updateCanvas } from "./ui"
import { GraphLayout } from "./graph-layout"
import { CameraFollower } from "./follower"

export function renderReplicaGraph(data: LoadedAlphaData): Component {
  const replicas = new Map<number, Component>()
  const edges: { from: Component; to: Component }[] = []

  for (const replica of data.replicas.values()) {
    // @ts-expect-error idk why
    const component = renderReplica(replica, replica.currentVersion)
    replicas.set(replica.id, component)
  }

  for (const replica of data.replicas.values()) {
    const fromComponent = replicas.get(replica.id)!
    for (const requirement of Object.values(replica.currentVersion?.requirements ?? {})) {
      for (const requiredReplica of requirement.replicas.values()) {
        const toComponent = replicas.get(requiredReplica.id)
        if (toComponent) {
          edges.push({ from: fromComponent, to: toComponent })
        }
      }
    }
  }

  return new GraphLayout({ nodes: [...replicas.values()], edges })
}

export function setupGraph(api: ExcalidrawImperativeAPI) {
  let follower: CameraFollower | undefined

  loadedAlphaData.$jazz.subscribe(data => {
    // @ts-expect-error idk why
    const replicaGraph = renderReplicaGraph(data)
    const elements = updateCanvas(api, replicaGraph)

    follower?.stop()
    follower = new CameraFollower(api, elements)
  })
}
