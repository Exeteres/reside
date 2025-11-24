import type { Replica, ReplicaVersion, ReplicaVersionStatus } from "@contracts/alpha.v1"
import { resolveDisplayInfo } from "@reside/shared"
import { StatusField, type StatusFieldColor } from "./status-field"
import { Column, Text, type Component } from "./ui"

const replicaStatusMap: Record<
  ReplicaVersionStatus,
  {
    value: string
    color?: StatusFieldColor
  }
> = {
  running: { value: "работает", color: "success" },
  "running-outdated": { value: "обновляется", color: "info" },
  starting: { value: "запускается", color: "info" },
  stopping: { value: "останавливается", color: "warning" },
  stopped: { value: "остановлена", color: "danger" },
  error: { value: "ошибка", color: "danger" },
  completed: { value: "завершена", color: "success" },
  degraded: { value: "неисправна", color: "danger" },
  unknown: { value: "неизвестно", color: "danger" },
}

export function renderReplicaStatusBox(replica: Replica, version: ReplicaVersion): Component {
  const displayInfo = resolveDisplayInfo(version.displayInfo, "ru")

  return new Column({
    children: [
      new Text({
        text: displayInfo?.title ?? replica.name,
        fontSize: 20,
      }),

      new StatusField({
        name: "id",
        value: replica.id.toString(),
      }),
      new StatusField({
        name: "версия",
        value: version.id.toString(),
      }),
      new StatusField({
        name: "статус",
        value: replicaStatusMap[version.status].value,
        color: replicaStatusMap[version.status].color,
      }),
    ],
  })
}
