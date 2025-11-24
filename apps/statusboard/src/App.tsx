import { Excalidraw } from "@excalidraw/excalidraw"

import "@excalidraw/excalidraw/index.css"
import "./App.css"
import { renderReplicaGraph, setupGraph } from "./graph"
import { loadedAlphaData } from "./data"
import { renderComponent } from "./ui"

export function App() {
  return (
    <>
      <div style={{ height: "100vh" }}>
        <Excalidraw
          theme="light"
          initialData={{
            // @ts-expect-error idk why
            elements: renderComponent(renderReplicaGraph(loadedAlphaData)),
            scrollToContent: true,
          }}
          viewModeEnabled={true}
          excalidrawAPI={setupGraph}
        />
      </div>
    </>
  )
}
