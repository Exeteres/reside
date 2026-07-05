import type { EngineerServices } from "../shared"
import { randomBytes } from "node:crypto"
import {
  applyObject,
  bootstrapGatewayRoute,
  defineGateway,
  getReplicaImage,
  getReplicaName,
  getReplicaNamespace,
  getReplicaServiceAccountName,
} from "@reside/common"
import {
  ENGINEER_FACTORY_NAME,
  ENGINEER_FACTORY_PASSWORD_SECRET_KEY,
  ENGINEER_FACTORY_PASSWORD_SECRET_NAME,
  ENGINEER_FACTORY_PORT,
  ENGINEER_FACTORY_STORAGE_PREFIX,
} from "../definitions"
import { strings } from "../locale"

export async function bootstrapFactory({
  services,
}: {
  services: EngineerServices
}): Promise<void> {
  const namespace = getReplicaNamespace()

  await ensureFactoryPasswordSecret(namespace)
  await applyObject(buildFactoryService(namespace))
  await applyObject(buildFactoryStatefulSet(namespace))

  const { endpoint } = await defineGateway({
    services,
    name: ENGINEER_FACTORY_NAME,
    title: strings.bootstrap.factory.gateway.title,
    description: strings.bootstrap.factory.gateway.description,
  })

  await bootstrapGatewayRoute({
    gatewayName: ENGINEER_FACTORY_NAME,
    endpoint,
    routeName: ENGINEER_FACTORY_NAME,
    paths: ["/"],
    backendServiceName: ENGINEER_FACTORY_NAME,
    backendServicePort: ENGINEER_FACTORY_PORT,
  })
}

async function ensureFactoryPasswordSecret(namespace: string): Promise<void> {
  if (await hasSecret(namespace, ENGINEER_FACTORY_PASSWORD_SECRET_NAME)) {
    return
  }

  await applyObject({
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: ENGINEER_FACTORY_PASSWORD_SECRET_NAME,
      namespace,
    },
    type: "Opaque",
    data: {
      [ENGINEER_FACTORY_PASSWORD_SECRET_KEY]: encodeSecretValue(generatePassword()),
    },
  })
}

async function hasSecret(namespace: string, name: string): Promise<boolean> {
  const process = Bun.spawn(["kubectl", "-n", namespace, "get", "secret", name], {
    stdout: "ignore",
    stderr: "ignore",
  })

  return (await process.exited) === 0
}

function buildFactoryService(namespace: string): Record<string, unknown> {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: ENGINEER_FACTORY_NAME,
      namespace,
    },
    spec: {
      selector: {
        app: ENGINEER_FACTORY_NAME,
      },
      ports: [
        {
          name: "http",
          port: ENGINEER_FACTORY_PORT,
          targetPort: ENGINEER_FACTORY_PORT,
        },
      ],
    },
  }
}

function buildFactoryStatefulSet(namespace: string): Record<string, unknown> {
  return {
    apiVersion: "apps/v1",
    kind: "StatefulSet",
    metadata: {
      name: ENGINEER_FACTORY_NAME,
      namespace,
    },
    spec: {
      serviceName: ENGINEER_FACTORY_NAME,
      replicas: 1,
      selector: {
        matchLabels: {
          app: ENGINEER_FACTORY_NAME,
        },
      },
      template: {
        metadata: {
          labels: {
            app: ENGINEER_FACTORY_NAME,
          },
        },
        spec: {
          serviceAccountName: getReplicaServiceAccountName(),
          terminationGracePeriodSeconds: 180,
          containers: [
            {
              name: ENGINEER_FACTORY_NAME,
              image: getReplicaImage(),
              ports: [
                {
                  name: "http",
                  containerPort: ENGINEER_FACTORY_PORT,
                },
              ],
              env: [
                {
                  name: "NODE_EXTRA_CA_CERTS",
                  value: "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
                },
                {
                  name: "REPLICA_NAME",
                  value: getReplicaName(),
                },
                {
                  name: "REPLICA_NAMESPACE",
                  value: namespace,
                },
                {
                  name: "REPLICA_SERVICE_ACCOUNT_NAME",
                  value: getReplicaServiceAccountName(),
                },
                {
                  name: "REPLICA_IMAGE",
                  value: getReplicaImage(),
                },
                {
                  name: "REPLICA_COMPONENT_NAME",
                  value: "engineer-factory",
                },
                {
                  name: "RESIDE_BIN",
                  value: "factory",
                },
                {
                  name: "RESIDE_ENVIRONMENT",
                  value: "factory-interactive",
                },
                {
                  name: "ENGINEER_FACTORY_PORT",
                  value: String(ENGINEER_FACTORY_PORT),
                },
                {
                  name: "ENGINEER_FACTORY_STORAGE_PREFIX",
                  value: ENGINEER_FACTORY_STORAGE_PREFIX,
                },
                {
                  name: "OPENCODE_SERVER_PASSWORD",
                  valueFrom: {
                    secretKeyRef: {
                      name: ENGINEER_FACTORY_PASSWORD_SECRET_NAME,
                      key: ENGINEER_FACTORY_PASSWORD_SECRET_KEY,
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    },
  }
}

function generatePassword(): string {
  return randomBytes(32).toString("base64url")
}

function encodeSecretValue(value: string): string {
  return Buffer.from(value, "utf8").toString("base64")
}
