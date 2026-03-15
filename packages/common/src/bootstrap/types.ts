export type ReplicaEnvironmentVariable =
  | {
      name: string
      value: string
    }
  | {
      name: string
      valueFrom: {
        secretKeyRef: {
          name: string
          key: string
        }
      }
    }

export type KnativeService = {
  apiVersion: "serving.knative.dev/v1"
  kind: "Service"
  metadata: {
    name: string
    namespace: string
    labels?: Record<string, string>
    annotations?: Record<string, string>
    resourceVersion?: string
  }
  spec: {
    template: {
      metadata?: {
        labels?: Record<string, string>
        annotations?: Record<string, string>
      }
      spec: {
        serviceAccountName?: string
        terminationGracePeriodSeconds?: number
        containers: Array<{
          name: string
          image: string
          command?: string[]
          env?: ReplicaEnvironmentVariable[]
          ports?: Array<{
            name?: string
            containerPort: number
          }>
        }>
      }
    }
  }
}

export type KubernetesService = {
  apiVersion: "v1"
  kind: "Service"
  metadata: {
    name: string
    namespace: string
    labels?: Record<string, string>
    resourceVersion?: string
  }
  spec: {
    clusterIP?: "None"
    publishNotReadyAddresses?: boolean
    selector: Record<string, string>
    ports: Array<{
      name: string
      port: number
      targetPort: number
    }>
  }
}

export type Deployment = {
  apiVersion: "apps/v1"
  kind: "Deployment"
  metadata: {
    name: string
    namespace: string
    labels?: Record<string, string>
    resourceVersion?: string
  }
  spec: {
    replicas: number
    selector: {
      matchLabels: Record<string, string>
    }
    template: {
      metadata: {
        labels: Record<string, string>
      }
      spec: {
        serviceAccountName: string
        containers: Array<{
          name: string
          image: string
          command?: string[]
          env?: ReplicaEnvironmentVariable[]
          ports?: Array<{
            name?: string
            containerPort: number
          }>
        }>
      }
    }
  }
}

export type StatefulSet = {
  apiVersion: "apps/v1"
  kind: "StatefulSet"
  metadata: {
    name: string
    namespace: string
    labels?: Record<string, string>
    resourceVersion?: string
  }
  spec: {
    serviceName: string
    replicas: number
    selector: {
      matchLabels: Record<string, string>
    }
    template: {
      metadata: {
        labels: Record<string, string>
      }
      spec: {
        serviceAccountName: string
        containers: Array<{
          name: string
          image: string
          command?: string[]
          env?: ReplicaEnvironmentVariable[]
        }>
      }
    }
  }
}
