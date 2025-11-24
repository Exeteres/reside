import type { Replica, ReplicaVersion } from "@contracts/alpha.v1"
import { renderReplicaStatusBox } from "./status-box"
import { Column, Image, type Component } from "./ui"

export function renderReplica(replica: Replica, version: ReplicaVersion): Component {
  return new Column({
    children: [
      renderReplicaStatusBox(replica, version),

      new Image({
        url: `https://github.com/exeteres/reside/raw/main/replicas/${replica.info.name}/REPLICA.png`,
        width: 200,
        height: 300,
      }),
    ],
    align: "center",
  })
}
