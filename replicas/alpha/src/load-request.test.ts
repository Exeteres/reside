import { describe, expect, test } from "bun:test"
import { ReplicaVersion } from "@contracts/alpha.v1"
import { createMockKubernetesSentinelData } from "@contracts/kubernetes-sentinel.v1"
import { createReplicaTestAccount, type ResideManifest, testLogger } from "@reside/shared"
import { createJazzTestAccount, setupJazzTestSync } from "jazz-tools/testing"
import { createLoadRequest, validateLoadRequest } from "./load-request"
import { AlphaReplica } from "./replica"
import { createReplicaVersion } from "./replica-management"
import { testFetchImageDigest, testFetchResideManifest } from "./testing"

describe("validateLoadRequest", async () => {
  test("fetches manifest and validates load request", async () => {
    const {
      account,
      implements: { alpha },
    } = await createReplicaTestAccount(AlphaReplica)

    const loadRequest = await createLoadRequest(
      alpha.data,
      {
        image: "ghcr.io/exeteres/reside/replicas/kubernetes-sentinel:latest",
      },
      account,
    )

    await validateLoadRequest(
      alpha.data,
      loadRequest,
      testLogger,
      testFetchResideManifest,
      testFetchImageDigest,
    )

    const validatedLoadRequest = await loadRequest.$jazz.ensureLoaded({
      resolve: {
        approveRequest: true,
      },
    })

    expect(validatedLoadRequest.status).toBe("requires-approval")
    expect(validatedLoadRequest.approveRequest).toBeDefined()
    expect(validatedLoadRequest.approveRequest!.name).toBe("kubernetes-sentinel")
  })

  test("should assign requested name if provided", async () => {
    const {
      account,
      implements: { alpha },
    } = await createReplicaTestAccount(AlphaReplica)

    const loadRequest = await createLoadRequest(
      alpha.data,
      {
        image: "ghcr.io/exeteres/reside/replicas/kubernetes-sentinel:latest",
        name: "custom-name",
      },
      account,
    )

    await validateLoadRequest(
      alpha.data,
      loadRequest,
      testLogger,
      testFetchResideManifest,
      testFetchImageDigest,
    )

    const validatedLoadRequest = await loadRequest.$jazz.ensureLoaded({
      resolve: {
        approveRequest: true,
      },
    })

    expect(validatedLoadRequest.approveRequest).toBeDefined()
    expect(validatedLoadRequest.approveRequest!.name).toBe("custom-name")
  })

  test("should assign different name if requested name is taken by existing replica", async () => {
    await setupJazzTestSync()

    const {
      account,
      implements: { alpha },
    } = await createReplicaTestAccount(AlphaReplica)

    await createReplicaVersion(
      alpha.data,
      createMockKubernetesSentinelData(),
      {
        image: "ghcr.io/exeteres/reside/replicas/kubernetes-sentinel:latest",
        digest: "sha256:testdigest",
        displayInfo: {},
        implementations: ReplicaVersion.shape.implementations.create({}),
        requirements: ReplicaVersion.shape.requirements.create({}),
        identity: "",
        info: {
          name: "custom-name",
          class: "long-running",
          exclusive: true,
          scalable: true,
        },
        name: "custom-name",
        replica: null,
      },
      createJazzTestAccount,
    )

    const loadRequest = await createLoadRequest(
      alpha.data,
      {
        image: "ghcr.io/exeteres/reside/replicas/kubernetes-sentinel:latest",
        name: "custom-name",
      },
      account,
    )

    await validateLoadRequest(
      alpha.data,
      loadRequest,
      testLogger,
      testFetchResideManifest,
      testFetchImageDigest,
    )

    const validatedLoadRequest = await loadRequest.$jazz.ensureLoaded({
      resolve: {
        approveRequest: true,
      },
    })

    expect(validatedLoadRequest.approveRequest).toBeDefined()
    expect(validatedLoadRequest.approveRequest!.name).toBe("custom-name-1")
  })

  test("should assign different name if requested name is taken by existing load request", async () => {
    const {
      account,
      implements: { alpha },
    } = await createReplicaTestAccount(AlphaReplica)

    const existingLoadRequest = await createLoadRequest(
      alpha.data,
      {
        image: "ghcr.io/exeteres/reside/replicas/kubernetes-sentinel:latest",
        name: "custom-name",
      },
      account,
    )

    await validateLoadRequest(
      alpha.data,
      existingLoadRequest,
      testLogger,
      testFetchResideManifest,
      testFetchImageDigest,
    )

    const loadRequest = await createLoadRequest(
      alpha.data,
      {
        image: "ghcr.io/exeteres/reside/replicas/kubernetes-sentinel:latest",
        name: "custom-name",
      },
      account,
    )

    await validateLoadRequest(
      alpha.data,
      loadRequest,
      testLogger,
      testFetchResideManifest,
      testFetchImageDigest,
    )

    const validatedLoadRequest = await loadRequest.$jazz.ensureLoaded({
      resolve: {
        approveRequest: true,
      },
    })

    expect(validatedLoadRequest.approveRequest).toBeDefined()
    expect(validatedLoadRequest.approveRequest!.name).toBe("custom-name-1")
  })

  test("handles invalid replica image manifest", async () => {
    const {
      account,
      implements: { alpha },
    } = await createReplicaTestAccount(AlphaReplica)

    const loadRequest = await createLoadRequest(
      alpha.data,
      {
        image: "ghcr.io/exeteres/reside/contracts/kubernetes-sentinel.v1:latest",
      },
      account,
    )

    const fetchContractManifest = async (_image: string) => {
      return {
        type: "contract",
      } as ResideManifest
    }

    await validateLoadRequest(
      alpha.data,
      loadRequest,
      testLogger,
      fetchContractManifest,
      testFetchImageDigest,
    )

    expect(loadRequest.status).toBe("invalid")
    expect(loadRequest.errorMessage).toMatchInlineSnapshot(
      '"Invalid replica image: manifest type is "contract", expected "replica"."',
    )
  })

  test("resolves requirements from manifest", async () => {
    await setupJazzTestSync()

    const {
      account,
      implements: { alpha },
    } = await createReplicaTestAccount(AlphaReplica)

    await createReplicaVersion(
      alpha.data,
      createMockKubernetesSentinelData(),
      {
        image: "ghcr.io/exeteres/reside/replicas/kubernetes-sentinel:latest",
        digest: "sha256:testdigest",
        displayInfo: {},
        implementations: ReplicaVersion.shape.implementations.create({
          k8s: {
            id: 1,
            identity: "ghcr.io/exeteres/reside/replicas/kubernetes-sentinel",
            displayInfo: {},
            permissions: {},
            methods: {},
          },
        }),
        requirements: ReplicaVersion.shape.requirements.create({}),
        identity: "",
        info: {
          name: "kubernetes-sentinel",
          class: "long-running",
          exclusive: true,
          scalable: true,
        },
        name: "kubernetes-sentinel",
        replica: null,
      },
      createJazzTestAccount,
    )

    const loadRequest = await createLoadRequest(
      alpha.data,
      {
        image: "ghcr.io/exeteres/reside/replicas/alpha:latest",
      },
      account,
    )

    await validateLoadRequest(
      alpha.data,
      loadRequest,
      testLogger,
      testFetchResideManifest,
      testFetchImageDigest,
    )

    const validatedLoadRequest = await loadRequest.$jazz.ensureLoaded({
      resolve: {
        approveRequest: {
          requirements: {
            $each: {
              replicas: { $each: true },
            },
          },
        },
      },
    })

    expect(validatedLoadRequest.status).toBe("requires-approval")
    expect(validatedLoadRequest.approveRequest).toBeDefined()

    const approveRequest = validatedLoadRequest.approveRequest!

    const k8sRequirement = approveRequest.requirements.k8s
    expect(k8sRequirement).toBeDefined()
    expect(k8sRequirement!.replicas.length).toBe(1)
    expect(k8sRequirement!.replicas[0]!.name).toBe("kubernetes-sentinel")
  })
})
