import type { ResideManifest } from "@reside/shared"
import { AlphaContract } from "@contracts/alpha.v1"
import { KubernetesSentinelContract } from "@contracts/kubernetes-sentinel.v1"

const mockManifests: Record<string, ResideManifest> = {
  // contracts
  "ghcr.io/exeteres/reside/contracts/kubernetes-sentinel.v1": {
    type: "contract",
    identity: KubernetesSentinelContract.identity,
    displayInfo: {},
    permissions: {
      "deployment:manage:all": {
        displayInfo: {},
      },
    },
    methods: {},
  },

  "ghcr.io/exeteres/reside/contracts/alpha.v1": {
    type: "contract",
    identity: AlphaContract.identity,
    displayInfo: {},
    permissions: {},
    methods: {},
  },

  // replicas
  "ghcr.io/exeteres/reside/replicas/kubernetes-sentinel": {
    type: "replica",
    identity: "ghcr.io/exeteres/reside/replicas/kubernetes-sentinel",
    info: {
      name: "kubernetes-sentinel",
      class: "long-running",
      exclusive: true,
      scalable: true,
    },
    displayInfo: {},
    implementations: {
      k8s: {
        identity: KubernetesSentinelContract.identity,
      },
    },
    requirements: {},
  },
  "ghcr.io/exeteres/reside/replicas/alpha": {
    type: "replica",
    identity: "ghcr.io/exeteres/reside/replicas/alpha",
    info: {
      name: "alpha",
      class: "long-running",
      exclusive: true,
      scalable: true,
    },
    displayInfo: {},
    implementations: {
      alpha: {
        identity: AlphaContract.identity,
      },
    },
    requirements: {
      k8s: {
        identity: KubernetesSentinelContract.identity,
        permissions: [{ name: "deployment:manage:all", params: {} }],
      },
    },
  },
}

export async function testFetchResideManifest(image: string): Promise<ResideManifest> {
  const manifest = mockManifests[image]
  if (!manifest) {
    throw new Error(`No mock manifest for image ${image}`)
  }

  return manifest
}

export async function testFetchImageDigest(_image: string): Promise<string> {
  return ""
}
