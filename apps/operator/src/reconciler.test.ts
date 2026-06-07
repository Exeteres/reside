import type {
  BatchV1Api,
  CoreV1Api,
  CustomObjectsApi,
  RbacAuthorizationV1Api,
} from "@kubernetes/client-node"
import type { Replica } from "./replica"
import { describe, expect, it, mock } from "bun:test"
import { operatorConfig } from "./config"
import { cleanupOrphanReplicaNamespaces, listReplicas, reconcileReplica } from "./reconciler"

function getReplicaNamespace(replicaName: string): string {
  return `replica-${replicaName}`
}

function notFoundError(): { response: { statusCode: number } } {
  return {
    response: {
      statusCode: 404,
    },
  }
}

function createReplica(overrides?: Partial<Replica>): Replica {
  return {
    name: "telegram-replica",
    generation: 1,
    image: "ghcr.io/example/telegram:v1",
    ...overrides,
  }
}

function createCoreApiMocks() {
  const readNamespace = mock(async () => {
    return {} as never
  }).mockName("readNamespace")
  const createNamespace = mock(async (_request: unknown) => {
    return {} as never
  }).mockName("createNamespace")
  const readNamespacedServiceAccount = mock(async () => {
    return {} as never
  }).mockName("readNamespacedServiceAccount")
  const createNamespacedServiceAccount = mock(async (_request: unknown) => {
    return {} as never
  }).mockName("createNamespacedServiceAccount")
  const listNamespacedPod = mock(async () => {
    return {
      items: [],
    } as never
  }).mockName("listNamespacedPod")

  const coreApi = {
    readNamespace,
    createNamespace,
    readNamespacedServiceAccount,
    createNamespacedServiceAccount,
    listNamespacedPod,
  } as unknown as CoreV1Api

  return {
    coreApi,
    readNamespace,
    createNamespace,
    readNamespacedServiceAccount,
    createNamespacedServiceAccount,
    listNamespacedPod,
  }
}

function createRbacApiMocks() {
  const readNamespacedRole = mock(async () => {
    return {} as never
  }).mockName("readNamespacedRole")
  const createNamespacedRole = mock(async (_request: unknown) => {
    return {} as never
  }).mockName("createNamespacedRole")
  const readNamespacedRoleBinding = mock(async () => {
    return {} as never
  }).mockName("readNamespacedRoleBinding")
  const createNamespacedRoleBinding = mock(async (_request: unknown) => {
    return {} as never
  }).mockName("createNamespacedRoleBinding")
  const readClusterRoleBinding = mock(async () => {
    return {} as never
  }).mockName("readClusterRoleBinding")
  const createClusterRoleBinding = mock(async (_request: unknown) => {
    return {} as never
  }).mockName("createClusterRoleBinding")

  const rbacApi = {
    readNamespacedRole,
    createNamespacedRole,
    readNamespacedRoleBinding,
    createNamespacedRoleBinding,
    readClusterRoleBinding,
    createClusterRoleBinding,
  } as unknown as RbacAuthorizationV1Api

  return {
    rbacApi,
    readNamespacedRole,
    createNamespacedRole,
    readNamespacedRoleBinding,
    createNamespacedRoleBinding,
    readClusterRoleBinding,
    createClusterRoleBinding,
  }
}

function createBatchApiMocks() {
  const readNamespacedJob = mock(async () => {
    return {
      spec: {
        template: {
          spec: {
            containers: [{ image: "ghcr.io/example/telegram:v1" }],
          },
        },
      },
      status: {
        conditions: [{ type: "Complete", status: "True" }],
      },
    } as never
  }).mockName("readNamespacedJob")
  const createNamespacedJob = mock(async (_request: unknown) => {
    return {} as never
  }).mockName("createNamespacedJob")
  const deleteNamespacedJob = mock(async () => {
    return {} as never
  }).mockName("deleteNamespacedJob")

  const batchApi = {
    readNamespacedJob,
    createNamespacedJob,
    deleteNamespacedJob,
  } as unknown as BatchV1Api

  return {
    batchApi,
    readNamespacedJob,
    createNamespacedJob,
    deleteNamespacedJob,
  }
}

describe("reconcileReplica", () => {
  it("creates basic resources when all are missing", async () => {
    const coreMocks = createCoreApiMocks()
    coreMocks.readNamespace.mockRejectedValue(notFoundError())
    coreMocks.readNamespacedServiceAccount.mockRejectedValue(notFoundError())

    const rbacMocks = createRbacApiMocks()
    rbacMocks.readNamespacedRole.mockRejectedValue(notFoundError())
    rbacMocks.readNamespacedRoleBinding.mockRejectedValue(notFoundError())
    rbacMocks.readClusterRoleBinding.mockRejectedValue(notFoundError())

    const batchMocks = createBatchApiMocks()
    batchMocks.readNamespacedJob.mockRejectedValue(notFoundError())

    const replica = createReplica()
    const replicaNamespace = getReplicaNamespace(replica.name)
    const result = await reconcileReplica(
      coreMocks.coreApi,
      rbacMocks.rbacApi,
      batchMocks.batchApi,
      replica,
    )

    expect(coreMocks.createNamespace).toHaveBeenCalledTimes(1)
    expect(coreMocks.createNamespacedServiceAccount).toHaveBeenCalledTimes(1)
    expect(rbacMocks.createNamespacedRole).toHaveBeenCalledTimes(1)
    expect(rbacMocks.createNamespacedRoleBinding).toHaveBeenCalledTimes(1)
    expect(rbacMocks.createClusterRoleBinding).toHaveBeenCalledTimes(1)
    expect(batchMocks.createNamespacedJob).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      phase: "Reconciling",
      conditionStatus: "False",
      reason: "BootstrapJobCreated",
      message: `Created bootstrap job for image "${replica.image}" and waiting for it to complete`,
    })

    expect(coreMocks.createNamespace).toHaveBeenCalledWith({
      body: {
        metadata: {
          name: replicaNamespace,
        },
      },
    })
    expect(coreMocks.createNamespacedServiceAccount).toHaveBeenCalledWith({
      namespace: replicaNamespace,
      body: {
        metadata: {
          name: replica.name,
          namespace: replicaNamespace,
        },
      },
    })
    expect(rbacMocks.createNamespacedRole).toHaveBeenCalledWith({
      namespace: replicaNamespace,
      body: {
        metadata: {
          name: `${replica.name}-admin`,
          namespace: replicaNamespace,
        },
        rules: [
          {
            apiGroups: ["*"],
            resources: ["*"],
            verbs: ["*"],
          },
        ],
      },
    })
    expect(rbacMocks.createNamespacedRoleBinding).toHaveBeenCalledWith({
      namespace: replicaNamespace,
      body: {
        metadata: {
          name: `${replica.name}-admin`,
          namespace: replicaNamespace,
        },
        roleRef: {
          apiGroup: "rbac.authorization.k8s.io",
          kind: "Role",
          name: `${replica.name}-admin`,
        },
        subjects: [
          {
            kind: "ServiceAccount",
            name: replica.name,
            namespace: replicaNamespace,
          },
        ],
      },
    })
    expect(rbacMocks.createClusterRoleBinding).toHaveBeenCalledWith({
      body: {
        metadata: {
          name: `reside:replica:${replica.name}:auth-delegator`,
        },
        roleRef: {
          apiGroup: "rbac.authorization.k8s.io",
          kind: "ClusterRole",
          name: "system:auth-delegator",
        },
        subjects: [
          {
            kind: "ServiceAccount",
            name: replica.name,
            namespace: replicaNamespace,
          },
        ],
      },
    })
    expect(batchMocks.createNamespacedJob).toHaveBeenCalledWith({
      namespace: replicaNamespace,
      body: {
        metadata: {
          name: `${replica.name}-bootstrap`,
          namespace: replicaNamespace,
          labels: {
            "app.kubernetes.io/name": `replica-${replica.name}`,
            "reside.io/replica": replica.name,
            "reside.io/component": "bootstrap",
          },
        },
        spec: {
          backoffLimit: 0,
          template: {
            metadata: {
              labels: {
                "app.kubernetes.io/name": `replica-${replica.name}`,
                "reside.io/replica": replica.name,
                "reside.io/component": "bootstrap",
              },
            },
            spec: {
              restartPolicy: "Never",
              serviceAccountName: replica.name,
              containers: [
                {
                  name: "bootstrap",
                  image: replica.image,
                  imagePullPolicy: "Always",
                  env: [
                    {
                      name: "NODE_EXTRA_CA_CERTS",
                      value: "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
                    },
                    {
                      name: "REPLICA_NAME",
                      value: replica.name,
                    },
                    {
                      name: "REPLICA_COMPONENT_NAME",
                      value: `${replica.name}-bootstrap`,
                    },
                    {
                      name: "REPLICA_NAMESPACE",
                      value: replicaNamespace,
                    },
                    {
                      name: "REPLICA_SERVICE_ACCOUNT_NAME",
                      value: replica.name,
                    },
                    {
                      name: "REPLICA_IMAGE",
                      value: replica.image,
                    },
                    {
                      name: "RESIDE_BIN",
                      value: "bootstrap",
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    })
  })

  it("replaces running job when image changes", async () => {
    const coreMocks = createCoreApiMocks()
    const rbacMocks = createRbacApiMocks()
    const batchMocks = createBatchApiMocks()

    batchMocks.readNamespacedJob
      .mockImplementationOnce(async () => {
        return {
          spec: {
            template: {
              spec: {
                containers: [{ image: "ghcr.io/example/telegram:v0" }],
              },
            },
          },
          status: {
            conditions: [],
          },
        } as never
      })
      .mockRejectedValue(notFoundError())

    const result = await reconcileReplica(
      coreMocks.coreApi,
      rbacMocks.rbacApi,
      batchMocks.batchApi,
      createReplica(),
    )

    expect(batchMocks.deleteNamespacedJob).toHaveBeenCalledTimes(1)
    expect(batchMocks.deleteNamespacedJob).toHaveBeenCalledWith({
      name: "telegram-replica-bootstrap",
      namespace: "replica-telegram-replica",
      propagationPolicy: "Foreground",
    })
    expect(batchMocks.createNamespacedJob).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      phase: "Reconciling",
      conditionStatus: "False",
      reason: "BootstrapJobRecreated",
      message:
        'Recreated bootstrap job for updated image "ghcr.io/example/telegram:v1" and waiting for it to complete',
    })
  })

  it("replaces finished job when image changes", async () => {
    const coreMocks = createCoreApiMocks()
    const rbacMocks = createRbacApiMocks()
    const batchMocks = createBatchApiMocks()

    batchMocks.readNamespacedJob
      .mockImplementationOnce(async () => {
        return {
          spec: {
            template: {
              spec: {
                containers: [{ image: "ghcr.io/example/telegram:v0" }],
              },
            },
          },
          status: {
            conditions: [{ type: "Complete", status: "True" }],
          },
        } as never
      })
      .mockRejectedValue(notFoundError())

    const result = await reconcileReplica(
      coreMocks.coreApi,
      rbacMocks.rbacApi,
      batchMocks.batchApi,
      createReplica(),
    )

    expect(batchMocks.deleteNamespacedJob).toHaveBeenCalledTimes(1)
    expect(batchMocks.createNamespacedJob).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      phase: "Reconciling",
      conditionStatus: "False",
      reason: "BootstrapJobRecreated",
      message:
        'Recreated bootstrap job for updated image "ghcr.io/example/telegram:v1" and waiting for it to complete',
    })
  })

  it("does nothing when resources already match desired state", async () => {
    const coreMocks = createCoreApiMocks()
    const rbacMocks = createRbacApiMocks()
    const batchMocks = createBatchApiMocks()

    const result = await reconcileReplica(
      coreMocks.coreApi,
      rbacMocks.rbacApi,
      batchMocks.batchApi,
      createReplica(),
    )

    expect(coreMocks.createNamespace).toHaveBeenCalledTimes(0)
    expect(coreMocks.createNamespacedServiceAccount).toHaveBeenCalledTimes(0)
    expect(rbacMocks.createNamespacedRole).toHaveBeenCalledTimes(0)
    expect(rbacMocks.createNamespacedRoleBinding).toHaveBeenCalledTimes(0)
    expect(rbacMocks.createClusterRoleBinding).toHaveBeenCalledTimes(0)
    expect(batchMocks.deleteNamespacedJob).toHaveBeenCalledTimes(0)
    expect(batchMocks.createNamespacedJob).toHaveBeenCalledTimes(0)
    expect(result).toEqual({
      phase: "Ready",
      conditionStatus: "True",
      reason: "Reconciled",
      message: "Replica resources are reconciled",
    })
  })

  it("reports failed when bootstrap job failed", async () => {
    const coreMocks = createCoreApiMocks()
    const rbacMocks = createRbacApiMocks()
    const batchMocks = createBatchApiMocks()

    batchMocks.readNamespacedJob.mockResolvedValue({
      spec: {
        template: {
          spec: {
            containers: [{ image: "ghcr.io/example/telegram:v1" }],
          },
        },
      },
      status: {
        conditions: [
          {
            type: "Failed",
            status: "True",
            reason: "BackoffLimitExceeded",
            message: 'Module not found "src/bootstrap/main.ts"',
          },
        ],
      },
    } as never)

    const result = await reconcileReplica(
      coreMocks.coreApi,
      rbacMocks.rbacApi,
      batchMocks.batchApi,
      createReplica(),
    )

    expect(result).toEqual({
      phase: "Failed",
      conditionStatus: "False",
      reason: "BootstrapJobFailed",
      message: 'Module not found "src/bootstrap/main.ts"',
    })
    expect(batchMocks.deleteNamespacedJob).toHaveBeenCalledTimes(0)
    expect(batchMocks.createNamespacedJob).toHaveBeenCalledTimes(0)
  })

  it("reports failed when bootstrap pod cannot pull image", async () => {
    const coreMocks = createCoreApiMocks()
    const rbacMocks = createRbacApiMocks()
    const batchMocks = createBatchApiMocks()

    batchMocks.readNamespacedJob.mockResolvedValue({
      spec: {
        template: {
          spec: {
            containers: [{ image: "ghcr.io/example/telegram@sha256:123" }],
          },
        },
      },
      status: {
        conditions: [],
      },
    } as never)

    coreMocks.listNamespacedPod.mockResolvedValue({
      items: [
        {
          status: {
            containerStatuses: [
              {
                name: "bootstrap",
                state: {
                  waiting: {
                    reason: "ImagePullBackOff",
                    message: 'failed to resolve reference "ghcr.io/example/telegram:latest"',
                  },
                },
              },
            ],
          },
        },
      ],
    } as never)

    const result = await reconcileReplica(
      coreMocks.coreApi,
      rbacMocks.rbacApi,
      batchMocks.batchApi,
      createReplica({ image: "ghcr.io/example/telegram@sha256:123" }),
    )

    expect(result).toEqual({
      phase: "Failed",
      conditionStatus: "False",
      reason: "BootstrapJobFailed",
      message:
        'Bootstrap job image pull failed for container "bootstrap": failed to resolve reference "ghcr.io/example/telegram:latest"',
    })
  })

  it("throws when kubernetes api returns non-404 error", async () => {
    const coreMocks = createCoreApiMocks()
    const rbacMocks = createRbacApiMocks()
    const batchMocks = createBatchApiMocks()
    const error = new Error("boom")

    coreMocks.readNamespace.mockRejectedValue(error)

    await expect(
      reconcileReplica(coreMocks.coreApi, rbacMocks.rbacApi, batchMocks.batchApi, createReplica()),
    ).rejects.toBe(error)
  })

  it("uses Always pull policy for e2e hash-tagged images", async () => {
    const coreMocks = createCoreApiMocks()
    coreMocks.readNamespace.mockRejectedValue(notFoundError())
    coreMocks.readNamespacedServiceAccount.mockRejectedValue(notFoundError())

    const rbacMocks = createRbacApiMocks()
    rbacMocks.readNamespacedRole.mockRejectedValue(notFoundError())
    rbacMocks.readNamespacedRoleBinding.mockRejectedValue(notFoundError())
    rbacMocks.readClusterRoleBinding.mockRejectedValue(notFoundError())

    const batchMocks = createBatchApiMocks()
    batchMocks.readNamespacedJob.mockRejectedValue(notFoundError())

    const replica = createReplica({ image: "ghcr.io/exeteres/reside/replicas/infra:e2e-abc123" })

    await reconcileReplica(coreMocks.coreApi, rbacMocks.rbacApi, batchMocks.batchApi, replica)

    expect(batchMocks.createNamespacedJob).toHaveBeenCalledTimes(1)

    const request = batchMocks.createNamespacedJob.mock.calls[0]?.[0] as {
      body?: {
        spec?: {
          template?: {
            spec?: {
              containers?: Array<{
                imagePullPolicy?: string
              }>
            }
          }
        }
      }
    }
    const imagePullPolicy = request.body?.spec?.template?.spec?.containers?.[0]?.imagePullPolicy

    expect(imagePullPolicy).toBe("Always")
  })
})

describe("listReplicas", () => {
  it("parses valid replicas and skips invalid entries", async () => {
    const listClusterCustomObject = mock(async (_request: unknown) => {
      return {
        items: [
          {
            metadata: { name: "alpha", generation: 2 },
            spec: {
              image: "ghcr.io/example/alpha:v1",
            },
          },
          {
            metadata: { name: "invalid" },
            spec: {},
          },
        ],
      } as never
    }).mockName("listClusterCustomObject")

    const customObjectsApi = {
      listClusterCustomObject,
    } as unknown as CustomObjectsApi

    const replicas = await listReplicas(customObjectsApi)

    expect(listClusterCustomObject).toHaveBeenCalledTimes(1)
    expect(listClusterCustomObject).toHaveBeenLastCalledWith({
      group: operatorConfig.replicaApiGroup,
      version: operatorConfig.replicaApiVersion,
      plural: operatorConfig.replicaPlural,
    })

    expect(replicas).toEqual([
      {
        name: "alpha",
        generation: 2,
        image: "ghcr.io/example/alpha:v1",
      },
    ])
  })

  it("returns empty list when list response shape is invalid", async () => {
    const listClusterCustomObject = mock(async (_request: unknown) => {
      return {
        body: {
          items: [],
        },
      } as never
    })

    const customObjectsApi = {
      listClusterCustomObject,
    } as unknown as CustomObjectsApi

    const replicas = await listReplicas(customObjectsApi)
    expect(replicas).toEqual([])
  })

  it("parses replica when optional fields are omitted in spec", async () => {
    const listClusterCustomObject = mock(async (_request: unknown) => {
      return {
        items: [
          {
            metadata: { name: "alpha", generation: 5 },
            spec: {
              image: "ghcr.io/example/alpha:v1",
            },
          },
        ],
      } as never
    })

    const customObjectsApi = {
      listClusterCustomObject,
    } as unknown as CustomObjectsApi

    const replicas = await listReplicas(customObjectsApi)
    expect(replicas).toEqual([
      {
        name: "alpha",
        generation: 5,
        image: "ghcr.io/example/alpha:v1",
      },
    ])
  })
})

describe("cleanupOrphanReplicaNamespaces", () => {
  it("deletes orphan replica namespaces and keeps recognized ones", async () => {
    const listNamespace = mock(async () => {
      return {
        items: [
          { metadata: { name: "default" } },
          { metadata: { name: "replica-alpha" } },
          { metadata: { name: "replica-orphan" } },
          { metadata: { name: "replica-" } },
        ],
      } as never
    }).mockName("listNamespace")
    const deleteNamespace = mock(async () => {
      return {} as never
    }).mockName("deleteNamespace")

    const coreApi = {
      listNamespace,
      deleteNamespace,
    } as unknown as CoreV1Api

    await cleanupOrphanReplicaNamespaces(coreApi, [
      createReplica({
        name: "alpha",
      }),
    ])

    expect(listNamespace).toHaveBeenCalledTimes(1)
    expect(deleteNamespace).toHaveBeenCalledTimes(1)
    expect(deleteNamespace).toHaveBeenCalledWith({
      name: "replica-orphan",
    })
  })

  it("ignores not found during orphan namespace deletion", async () => {
    const listNamespace = mock(async () => {
      return {
        items: [{ metadata: { name: "replica-orphan" } }],
      } as never
    })
    const deleteNamespace = mock(async () => {
      throw notFoundError()
    })

    const coreApi = {
      listNamespace,
      deleteNamespace,
    } as unknown as CoreV1Api

    await cleanupOrphanReplicaNamespaces(coreApi, [])

    expect(deleteNamespace).toHaveBeenCalledTimes(1)
  })
})
