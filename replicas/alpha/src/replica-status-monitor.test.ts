import type { IDeployment } from "kubernetes-models/apps/v1"
import type { IJob } from "kubernetes-models/batch/v1"
import { beforeEach, describe, expect, test } from "bun:test"
import { Replica, ReplicaVersion } from "@contracts/alpha.v1"
import {
  createMockKubernetesSentinelData,
  type OptionalKubernetesManagedObjectCollection,
} from "@contracts/kubernetes-sentinel.v1"
import { testLogger } from "@reside/shared/node"
import { co } from "jazz-tools"
import { createJazzTestAccount, setupJazzTestSync } from "jazz-tools/testing"
import { reconcileReplicaStatuses } from "./replica-status-monitor"

const ReplicaListShape = co.list(Replica)

type LoadedReplicaCollection = co.loaded<
  typeof ReplicaListShape,
  { $each: { currentVersion: true; versions: { $each: true } } }
>

type DeploymentCollection = OptionalKubernetesManagedObjectCollection<IDeployment>
type JobCollection = OptionalKubernetesManagedObjectCollection<IJob>

type VersionConfig = {
  id: number
  status?: ReplicaVersion["status"]
  isCurrent?: boolean
}

type ReplicaSetupOptions = {
  name?: string
  class?: Replica["info"]["class"]
  versions: VersionConfig[]
}

type DeploymentState = {
  managedStatus?: "updated" | "requested" | "error"
  specReplicas?: number
  liveReplicas?: number
  readyReplicas?: number
  conditions?: DeploymentCondition[]
  liveStatus?: IDeployment["status"] | null
}

type JobState = {
  managedStatus?: "updated" | "requested" | "error"
  succeeded?: number
  failed?: number
  active?: number
  conditions?: JobCondition[]
  liveStatus?: IJob["status"] | null
  manifestPresent?: boolean
}

type DeploymentCondition = NonNullable<NonNullable<IDeployment["status"]>["conditions"]>[number]

type JobCondition = NonNullable<NonNullable<IJob["status"]>["conditions"]>[number]

beforeEach(async () => {
  await setupJazzTestSync()
})

describe("reconcileReplicaStatusesInternal", () => {
  test("sets current long-running version to running when deployment is available", async () => {
    const { replicas, getVersion, deployments, jobs } = await createReplicaScenario({
      class: "long-running",
      versions: [{ id: 1, isCurrent: true }],
    })

    setDeploymentState(deployments, replicas[0]!, getVersion(1), {
      specReplicas: 1,
      readyReplicas: 1,
      liveReplicas: 1,
      conditions: [condition("Available"), condition("Progressing")],
    })

    reconcileReplicaStatuses(replicas, deployments, jobs, testLogger)

    expect(getVersion(1).status).toBe("running")
  })

  test("marks previous long-running version as running-outdated when it still has pods", async () => {
    const { replicas, getVersion, deployments, jobs } = await createReplicaScenario({
      class: "long-running",
      versions: [{ id: 1 }, { id: 2, isCurrent: true }],
    })

    setDeploymentState(deployments, replicas[0]!, getVersion(1), {
      specReplicas: 1,
      readyReplicas: 1,
      liveReplicas: 1,
      conditions: [condition("Available")],
    })

    setDeploymentState(deployments, replicas[0]!, getVersion(2), {
      specReplicas: 1,
      readyReplicas: 1,
      liveReplicas: 1,
      conditions: [condition("Available")],
    })

    reconcileReplicaStatuses(replicas, deployments, jobs, testLogger)

    expect(getVersion(1).status).toBe("running-outdated")
    expect(getVersion(2).status).toBe("running")
  })

  test("marks previous long-running version as stopped when scaled down and pods removed", async () => {
    const { replicas, getVersion, deployments, jobs } = await createReplicaScenario({
      class: "long-running",
      versions: [{ id: 1 }, { id: 2, isCurrent: true }],
    })

    setDeploymentState(deployments, replicas[0]!, getVersion(1), {
      specReplicas: 0,
      liveReplicas: 0,
      readyReplicas: 0,
      conditions: [],
    })

    setDeploymentState(deployments, replicas[0]!, getVersion(2), {
      specReplicas: 1,
      readyReplicas: 1,
      liveReplicas: 1,
      conditions: [condition("Available")],
    })

    reconcileReplicaStatuses(replicas, deployments, jobs, testLogger)

    expect(getVersion(1).status).toBe("stopped")
    expect(getVersion(2).status).toBe("running")
  })

  test("marks current long-running version as stopping when desired replicas are zero but pods remain", async () => {
    const { replicas, getVersion, deployments, jobs } = await createReplicaScenario({
      class: "long-running",
      versions: [{ id: 1, isCurrent: true }],
    })

    setDeploymentState(deployments, replicas[0]!, getVersion(1), {
      specReplicas: 0,
      liveReplicas: 1,
      readyReplicas: 0,
      conditions: [condition("Progressing")],
    })

    reconcileReplicaStatuses(replicas, deployments, jobs, testLogger)

    expect(getVersion(1).status).toBe("stopping")
  })

  test("marks current long-running version as stopped when scaled down with no pods", async () => {
    const { replicas, getVersion, deployments, jobs } = await createReplicaScenario({
      class: "long-running",
      versions: [{ id: 1, isCurrent: true }],
    })

    setDeploymentState(deployments, replicas[0]!, getVersion(1), {
      specReplicas: 0,
      liveReplicas: 0,
      readyReplicas: 0,
      conditions: [],
    })

    reconcileReplicaStatuses(replicas, deployments, jobs, testLogger)

    expect(getVersion(1).status).toBe("stopped")
  })

  test("marks current long-running version as degraded when some pods are ready but not all", async () => {
    const { replicas, getVersion, deployments, jobs } = await createReplicaScenario({
      class: "long-running",
      versions: [{ id: 1, isCurrent: true }],
    })

    setDeploymentState(deployments, replicas[0]!, getVersion(1), {
      specReplicas: 3,
      liveReplicas: 3,
      readyReplicas: 1,
      conditions: [condition("Progressing")],
    })

    reconcileReplicaStatuses(replicas, deployments, jobs, testLogger)

    expect(getVersion(1).status).toBe("degraded")
  })

  test("marks current long-running version as error when deployment status is error", async () => {
    const { replicas, getVersion, deployments, jobs } = await createReplicaScenario({
      class: "long-running",
      versions: [{ id: 1, isCurrent: true }],
    })

    setDeploymentState(deployments, replicas[0]!, getVersion(1), {
      specReplicas: 1,
      liveReplicas: 0,
      readyReplicas: 0,
      managedStatus: "error",
    })

    reconcileReplicaStatuses(replicas, deployments, jobs, testLogger)

    expect(getVersion(1).status).toBe("error")
  })

  test("marks oneshot replica version as completed when job succeeds", async () => {
    const { replicas, getVersion, deployments, jobs } = await createReplicaScenario({
      class: "oneshot",
      versions: [{ id: 1, isCurrent: true }],
    })

    setJobState(jobs, replicas[0]!, getVersion(1), {
      succeeded: 1,
      conditions: [jobCondition("Complete")],
    })

    reconcileReplicaStatuses(replicas, deployments, jobs, testLogger)

    expect(getVersion(1).status).toBe("completed")
  })

  test("marks oneshot replica version as error when job fails", async () => {
    const { replicas, getVersion, deployments, jobs } = await createReplicaScenario({
      class: "oneshot",
      versions: [{ id: 1, isCurrent: true }],
    })

    setJobState(jobs, replicas[0]!, getVersion(1), {
      failed: 1,
      conditions: [jobCondition("Failed")],
    })

    reconcileReplicaStatuses(replicas, deployments, jobs, testLogger)

    expect(getVersion(1).status).toBe("error")
  })
})

function jobCondition(
  type: JobCondition["type"],
  status: JobCondition["status"] = "True",
): JobCondition {
  return {
    type,
    status,
  } as JobCondition
}

function condition(
  type: DeploymentCondition["type"],
  status: DeploymentCondition["status"] = "True",
): DeploymentCondition {
  return {
    type,
    status,
  } as DeploymentCondition
}

async function createReplicaScenario(options: ReplicaSetupOptions) {
  const { name = "test-replica", class: replicaClass = "long-running", versions } = options

  if (versions.length === 0) {
    throw new Error("at least one version must be specified")
  }

  const account = await createJazzTestAccount({ isCurrentActiveAccount: true })

  const replica = Replica.create({
    id: Math.floor(Math.random() * 1_000_000),
    name,
    identity: `ghcr.io/tests/${name}`,
    info: {
      name,
      class: replicaClass,
      exclusive: false,
      scalable: true,
    },
    account,
    currentVersion: null!,
    versions: [],
    management: { enabled: true },
  })

  const owner = replica.$jazz.owner
  const createdVersions: ReplicaVersion[] = []
  let currentId: number | null = null

  for (const config of versions) {
    const version = ReplicaVersion.create(
      {
        id: config.id,
        status: config.status ?? "unknown",
        replica,
        image: "",
        digest: "",
        displayInfo: {},
        implementations: ReplicaVersion.shape.implementations.create({}, owner),
        requirements: ReplicaVersion.shape.requirements.create({}, owner),
      },
      owner,
    )

    createdVersions.push(version)
    replica.versions.$jazz.push(version)

    if (config.isCurrent) {
      currentId = config.id
      replica.$jazz.set("currentVersion", version)
    }
  }

  const loadedReplica = await replica.$jazz.ensureLoaded({
    resolve: {
      currentVersion: true,
      versions: { $each: true },
    },
  })

  const loadedVersions = await Promise.all(
    createdVersions.map(version =>
      version.$jazz.ensureLoaded({
        resolve: {
          replica: true,
        },
      }),
    ),
  )

  if (!currentId) {
    currentId = createdVersions[createdVersions.length - 1]!.id
  }

  const currentVersion = findVersion(loadedReplica, currentId, loadedVersions)
  loadedReplica.$jazz.set(
    "currentVersion",
    currentVersion as unknown as typeof loadedReplica.currentVersion,
  )

  const replicas = ReplicaListShape.create(
    [loadedReplica],
    loadedReplica.$jazz.owner,
  ) as unknown as LoadedReplicaCollection

  const k8s = await createManagedCollections()

  return {
    replicas: replicas,
    deployments: k8s.deployments,
    jobs: k8s.jobs,
    getVersion: (id: number) => findVersion(replicas[0]!, id),
  }
}

async function createManagedCollections() {
  const k8sData = createMockKubernetesSentinelData()

  const loaded = await k8sData.$jazz.ensureLoaded({
    resolve: {
      deployments: {
        $each: { $onError: "catch" },
      },
      jobs: {
        $each: { $onError: "catch" },
      },
    },
  })

  return {
    deployments: loaded.deployments,
    jobs: loaded.jobs,
  }
}

function setDeploymentState(
  deployments: DeploymentCollection,
  replica: LoadedReplicaCollection[number],
  version: ReplicaVersion,
  state: DeploymentState,
): void {
  const name = `${replica.name}-${version.id}`
  const specReplicas = state.specReplicas ?? 1
  const managedStatus = state.managedStatus ?? "updated"

  const liveStatus = state.liveStatus ?? {
    replicas: state.liveReplicas ?? specReplicas,
    readyReplicas: state.readyReplicas ?? specReplicas,
    conditions: state.conditions ?? [],
  }

  deployments.$jazz.set(name, {
    name,
    status: managedStatus,
    manifest: {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name },
      spec: {
        replicas: specReplicas,
        selector: {
          matchLabels: {
            "replica.reside.io/name": name,
          },
        },
        template: {
          metadata: {
            labels: {
              "replica.reside.io/name": name,
            },
          },
          spec: {
            containers: [],
          },
        },
      },
    },
    live:
      liveStatus === null
        ? undefined
        : ({
            apiVersion: "apps/v1",
            kind: "Deployment",
            metadata: { name },
            status: {
              replicas: liveStatus.replicas ?? 0,
              readyReplicas: liveStatus.readyReplicas ?? 0,
              conditions: (liveStatus.conditions ?? []) as DeploymentCondition[],
            },
          } satisfies IDeployment),
  })
}

function setJobState(
  jobs: JobCollection,
  replica: LoadedReplicaCollection[number],
  version: ReplicaVersion,
  state: JobState,
): void {
  const name = `${replica.name}-${version.id}`
  const managedStatus = state.managedStatus ?? "updated"
  const manifestPresent = state.manifestPresent ?? true

  const liveStatus = state.liveStatus ?? {
    succeeded: state.succeeded ?? 0,
    failed: state.failed ?? 0,
    active: state.active ?? 0,
    conditions: state.conditions ?? [],
  }

  jobs.$jazz.set(name, {
    name,
    status: managedStatus,
    manifest: manifestPresent
      ? ({
          apiVersion: "batch/v1",
          kind: "Job",
          metadata: { name },
        } satisfies IJob)
      : null,
    live:
      liveStatus === null
        ? undefined
        : ({
            apiVersion: "batch/v1",
            kind: "Job",
            metadata: { name },
            status: {
              succeeded: liveStatus.succeeded ?? 0,
              failed: liveStatus.failed ?? 0,
              active: liveStatus.active ?? 0,
              conditions: (liveStatus.conditions ?? []) as JobCondition[],
            },
          } satisfies IJob),
  })
}
function findVersion(
  replica: LoadedReplicaCollection[number],
  id: number,
  preloaded?: ReplicaVersion[],
): ReplicaVersion {
  if (preloaded) {
    for (const version of preloaded) {
      if (version.id === id) {
        return version
      }
    }
  }

  for (let index = 0; index < replica.versions.length; index++) {
    const version = replica.versions[index]
    if (version && version.id === id) {
      return version
    }
  }

  throw new Error(`version ${id} not found`)
}
