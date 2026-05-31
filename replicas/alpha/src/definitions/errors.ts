import { ResideError } from "@reside/common/definitions"

export class ReplicaNotFoundError extends ResideError {
  constructor(readonly replicaName: string) {
    super(`Replica "${replicaName}" is not registered in Alpha`)
  }
}

export class NodeNotFoundError extends ResideError {
  constructor(readonly nodeName: string) {
    super(`Node "${nodeName}" was not found in Kubernetes cluster`)
  }
}
