import type { Replica } from "./shared"

export function sortReplicasByDependencies(replicas: Replica[]): Replica[] {
  const sorted: Replica[] = []
  const visited = new Set<string>()

  function visit(replica: Replica) {
    if (visited.has(replica.name)) {
      return
    }
    visited.add(replica.name)

    for (const dependency of Object.values(replica.dependencies.replicas)) {
      visit(dependency)
    }

    sorted.push(replica)
  }

  for (const replica of replicas) {
    visit(replica)
  }

  return sorted
}
