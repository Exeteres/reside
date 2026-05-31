import { defineCommand } from "@reside/common/workflow"
import { strings } from "../locale"

export const replicasCommand = defineCommand({
  name: "replicas",
  title: strings.commands.replicas.title,
  description: strings.commands.replicas.description,
})

export const setReplicaNodeCommand = defineCommand({
  name: "set_replica_node",
  title: strings.commands.setReplicaNode.title,
  description: strings.commands.setReplicaNode.description,
  protected: true,
  params: {
    replica: {
      title: strings.commands.setReplicaNode.params.replica.title,
      description: strings.commands.setReplicaNode.params.replica.description,
      type: "string",
      required: true,
    },
    node: {
      title: strings.commands.setReplicaNode.params.node.title,
      description: strings.commands.setReplicaNode.params.node.description,
      type: "string",
      required: true,
    },
  },
})

export const resetReplicaNodeCommand = defineCommand({
  name: "reset_replica_node",
  title: strings.commands.resetReplicaNode.title,
  description: strings.commands.resetReplicaNode.description,
  protected: true,
  params: {
    replica: {
      title: strings.commands.resetReplicaNode.params.replica.title,
      description: strings.commands.resetReplicaNode.params.replica.description,
      type: "string",
      required: true,
    },
  },
})
