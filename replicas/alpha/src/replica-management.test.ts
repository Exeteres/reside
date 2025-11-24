import { describe, expect, test } from "bun:test"
import {
  AlphaContract,
  getReplicaById,
  getReplicaByName,
  getReplicasByIdentity,
  getReplicasImplementingContract,
  Replica,
  ReplicaVersion,
} from "@contracts/alpha.v1"
import { createMockKubernetesSentinelData } from "@contracts/kubernetes-sentinel.v1"
import { loadBoxed } from "@reside/shared"
import { createReplicaTestAccount } from "@reside/shared/node"
import { createJazzTestAccount, setupJazzTestSync } from "jazz-tools/testing"
import { AlphaReplica } from "./replica"
import { createReplicaVersion } from "./replica-management"

describe("createReplicaVersion", () => {
  test("creates replica and indexes it for all getReplica helpers", async () => {
    await setupJazzTestSync()

    const {
      implements: { alpha },
    } = await createReplicaTestAccount(AlphaReplica)

    // arrange
    const k8s = createMockKubernetesSentinelData()
    const replicaIdentity = "ghcr.io/exeteres/reside/replicas/test-alpha"
    const replicaName = "test-alpha"
    const contractId = 42

    // act
    const version = await createReplicaVersion(
      alpha.data,
      k8s,
      {
        name: replicaName,
        identity: replicaIdentity,
        info: {
          name: "test",
          class: "long-running",
          exclusive: false,
          scalable: false,
        },
        displayInfo: {},
        requirements: ReplicaVersion.shape.requirements.create({}),
        implementations: ReplicaVersion.shape.implementations.create({
          alpha: {
            id: contractId,
            identity: AlphaContract.identity,
            displayInfo: {},
            permissions: {},
            methods: {},
          },
        }),
        digest: "",
        image: "",
        replica: null,
      },
      createJazzTestAccount,
    )

    // assert alpha state
    const loadedAlpha = await alpha.data.$jazz.ensureLoaded({
      resolve: { replicas: { $each: true } },
    })
    expect(loadedAlpha.replicas.length).toBe(1)

    const createdReplica = loadedAlpha.replicas[0]!
    const loadedReplica = await createdReplica.$jazz.ensureLoaded({
      resolve: { account: true, currentVersion: true },
    })
    expect(loadedReplica.name).toBe(replicaName)
    expect(loadedReplica.identity).toBe(replicaIdentity)
    expect(loadedReplica.currentVersion?.id).toBe(version.id)

    // assert kubernetes secret request
    const loadedK8s = await k8s.$jazz.ensureLoaded({ resolve: { secrets: true } })
    const secret = loadedK8s.secrets[replicaName]
    expect(secret?.status).toBe("requested")
    expect(secret?.manifest?.type).toBe("Opaque")
    expect(secret?.manifest?.stringData?.accountId).toBe(loadedReplica.account.$jazz.id)
    expect(typeof secret?.manifest?.stringData?.agentSecret).toBe("string")
    expect(secret?.manifest?.stringData?.agentSecret?.length).toBeGreaterThan(0)

    // assert getReplica helpers
    const boxedReplica = await loadBoxed(
      Replica,
      `replica.by-id.${loadedReplica.id}`,
      alpha.data.$jazz.owner.$jazz.id,
      alpha.data.$jazz.loadedAs,
    )
    expect(boxedReplica?.$jazz.id).toBe(loadedReplica.$jazz.id)

    const byId = await getReplicaById(alpha.data, loadedReplica.id)
    expect(byId?.id).toBe(loadedReplica.id)

    const byName = await getReplicaByName(alpha.data, replicaName)
    expect(byName?.id).toBe(loadedReplica.id)

    const byIdentity = await getReplicasByIdentity(alpha.data, replicaIdentity)
    expect(byIdentity.length).toBe(1)
    expect(byIdentity[0]?.id).toBe(loadedReplica.id)

    const byContract = await getReplicasImplementingContract(alpha.data, contractId)
    expect(byContract.length).toBe(1)
    expect(byContract[0]?.id).toBe(loadedReplica.id)
  })
})
