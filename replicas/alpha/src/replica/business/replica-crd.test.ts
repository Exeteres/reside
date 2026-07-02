import type { CustomObjectsApi } from "@kubernetes/client-node"
import { describe, expect, mock, test } from "bun:test"
import {
  extractContainerImageTag,
  reconcileReplicaCrdImage,
  shouldUpdateReplicaCrdImage,
} from "./replica-crd"

describe("extractContainerImageTag", () => {
  test("extracts tags from registry images", () => {
    expect(extractContainerImageTag("registry.local:5000/reside/alpha:1.2.3")).toBe("1.2.3")
    expect(extractContainerImageTag("ghcr.io/example/alpha:1.2.3@sha256:abc")).toBe("1.2.3")
  })

  test("ignores untagged images and registry ports", () => {
    expect(extractContainerImageTag("registry.local:5000/reside/alpha")).toBeNull()
    expect(extractContainerImageTag("ghcr.io/example/alpha@sha256:abc")).toBeNull()
  })
})

describe("shouldUpdateReplicaCrdImage", () => {
  test("allows initial image reconciliation when cluster image is missing", () => {
    expect(
      shouldUpdateReplicaCrdImage({
        databaseImage: "ghcr.io/example/alpha:1.2.3",
        clusterImage: null,
      }),
    ).toBe(true)
  })

  test("allows updating only to greater database image versions", () => {
    expect(
      shouldUpdateReplicaCrdImage({
        databaseImage: "ghcr.io/example/alpha:1.2.4",
        clusterImage: "ghcr.io/example/alpha:1.2.3",
      }),
    ).toBe(true)

    expect(
      shouldUpdateReplicaCrdImage({
        databaseImage: "ghcr.io/example/alpha:1.2.3",
        clusterImage: "ghcr.io/example/alpha:1.2.3",
      }),
    ).toBe(false)

    expect(
      shouldUpdateReplicaCrdImage({
        databaseImage: "ghcr.io/example/alpha:1.2.2",
        clusterImage: "ghcr.io/example/alpha:1.2.3",
      }),
    ).toBe(false)
  })

  test("uses semantic prerelease ordering", () => {
    expect(
      shouldUpdateReplicaCrdImage({
        databaseImage: "ghcr.io/example/alpha:1.2.3",
        clusterImage: "ghcr.io/example/alpha:1.2.3-rc.1",
      }),
    ).toBe(true)

    expect(
      shouldUpdateReplicaCrdImage({
        databaseImage: "ghcr.io/example/alpha:1.2.3-rc.1",
        clusterImage: "ghcr.io/example/alpha:1.2.3",
      }),
    ).toBe(false)
  })

  test("does not update when either version cannot be compared", () => {
    expect(
      shouldUpdateReplicaCrdImage({
        databaseImage: "ghcr.io/example/alpha:latest",
        clusterImage: "ghcr.io/example/alpha:1.2.3",
      }),
    ).toBe(false)

    expect(
      shouldUpdateReplicaCrdImage({
        databaseImage: "ghcr.io/example/alpha:1.2.3",
        clusterImage: "ghcr.io/example/alpha:latest",
      }),
    ).toBe(false)
  })
})

describe("reconcileReplicaCrdImage", () => {
  test("patches CRD image when database image version is greater", async () => {
    const getClusterCustomObject = mock(async () => ({
      spec: {
        image: "ghcr.io/example/alpha:1.2.3",
      },
      status: {
        phase: "Ready",
      },
    }))
    const patchClusterCustomObject = mock(async () => ({}))
    const createClusterCustomObject = mock(async () => ({}))
    const customObjectsApi = {
      getClusterCustomObject,
      patchClusterCustomObject,
      createClusterCustomObject,
    } as unknown as CustomObjectsApi

    await reconcileReplicaCrdImage(customObjectsApi, {
      name: "alpha",
      image: "ghcr.io/example/alpha:1.2.4",
    })

    expect(patchClusterCustomObject).toHaveBeenCalledTimes(1)
    expect(createClusterCustomObject).not.toHaveBeenCalled()
  })

  test("keeps current CRD image when cluster image version is not older", async () => {
    const getClusterCustomObject = mock(async () => ({
      spec: {
        image: "ghcr.io/example/alpha:1.2.4",
      },
      status: {
        phase: "Ready",
      },
    }))
    const patchClusterCustomObject = mock(async () => ({}))
    const customObjectsApi = {
      getClusterCustomObject,
      patchClusterCustomObject,
    } as unknown as CustomObjectsApi

    await reconcileReplicaCrdImage(customObjectsApi, {
      name: "alpha",
      image: "ghcr.io/example/alpha:1.2.3",
    })

    expect(patchClusterCustomObject).not.toHaveBeenCalled()
  })

  test("creates CRD when it does not exist", async () => {
    const getClusterCustomObject = mock(async () => {
      throw { code: 404 }
    })
    const patchClusterCustomObject = mock(async () => {
      throw { code: 404 }
    })
    const createClusterCustomObject = mock(async () => ({}))
    const customObjectsApi = {
      getClusterCustomObject,
      patchClusterCustomObject,
      createClusterCustomObject,
    } as unknown as CustomObjectsApi

    await reconcileReplicaCrdImage(customObjectsApi, {
      name: "alpha",
      image: "ghcr.io/example/alpha:1.2.3",
    })

    expect(createClusterCustomObject).toHaveBeenCalledTimes(1)
  })
})
