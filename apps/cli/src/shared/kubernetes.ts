import type { ResideLogger } from "./logger"
import type { TopologyReplica } from "./topology"
import { Buffer } from "node:buffer"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { buildPackageImage } from "./build-image"
import { loadPackageConfig } from "./package-config"
import { type CommandLog, runCommand, waitFor } from "./process"

type ReplicaData = {
  name: string
  data: Record<string, string>
}

type ClusterRoleRule = {
  apiGroups: string[]
  resources: string[]
  verbs: string[]
  resourceNames?: string[]
}

const operatorNamespace = "reside-system"
const replicaApiGroup = "reside.io"
const replicaApiVersion = "v1"

const ReplicaStatusSchema = z
  .object({
    metadata: z
      .object({
        generation: z.number().optional(),
        resourceVersion: z.string().optional(),
      })
      .optional(),
    status: z
      .object({
        observedGeneration: z.number().optional(),
        phase: z.string().optional(),
        conditions: z
          .array(
            z.object({
              type: z.string(),
              status: z.string(),
              reason: z.string().optional(),
              message: z.string().optional(),
            }),
          )
          .optional()
          .default([]),
      })
      .optional(),
  })
  .passthrough()

const JobSchema = z
  .object({
    status: z
      .object({
        succeeded: z.number().optional(),
        failed: z.number().optional(),
      })
      .optional(),
  })
  .passthrough()

const PodListSchema = z
  .object({
    items: z.array(
      z
        .object({
          metadata: z
            .object({
              name: z.string().optional(),
            })
            .optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough()

const NamespaceListSchema = z
  .object({
    items: z.array(
      z
        .object({
          metadata: z
            .object({
              name: z.string().optional(),
            })
            .optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough()

const ResourceDataSchema = z
  .object({
    data: z.record(z.string(), z.string()).optional().default({}),
  })
  .passthrough()

export type KubernetesClusterAccess = {
  context: string
}

export type EnsureKindClusterResult = {
  context: string
}

export type PrettyStdoutWriter = {
  writeLine: (line: string) => Promise<void>
  close: () => Promise<void>
}

type CommandLoggingArgs = {
  commandLog?: CommandLog
}

type BuildReplicaImageArgs = CommandLoggingArgs & {
  logger: ResideLogger
}

type ApplyManifestOptions = {
  serverSide?: boolean
}

type RolloutTarget = {
  namespace: string
  deployment: string
}

function getCliRootPath(): string {
  const sharedDirectory = dirname(fileURLToPath(import.meta.url))
  return resolve(sharedDirectory, "..", "..")
}

function getRepositoryRootPath(): string {
  return resolve(getCliRootPath(), "..", "..")
}

function getReplicaPackagePath(replicaName: string): string {
  return resolve(getRepositoryRootPath(), "replicas", replicaName)
}

/**
 * Returns the Kubernetes namespace for a replica workload.
 *
 * @param replicaName The replica name.
 * @returns The replica namespace.
 */
export function getReplicaNamespace(replicaName: string): string {
  return `replica-${replicaName}`
}

function getReplicaPackageContainerPath(replicaName: string): string {
  return `/app/replicas/${replicaName}`
}

async function pathExists(path: string): Promise<boolean> {
  const stat = Bun.file(path)
  return await stat.exists()
}

async function runKubectl(
  access: Pick<KubernetesClusterAccess, "context">,
  args: string[],
  options: Omit<Parameters<typeof runCommand>[1], "cwd"> = {},
): Promise<string> {
  return await runCommand([...buildKubectlBaseArgs(access), ...args], options)
}

async function getKubectlJson<T>(
  access: Pick<KubernetesClusterAccess, "context">,
  args: string[],
  schema: z.ZodType<T>,
): Promise<T | undefined> {
  const output = await runKubectl(access, args, {
    ignoreExitCode: true,
    logOutput: false,
  })

  if (output.trim().length === 0) {
    return undefined
  }

  const parsedJson = JSON.parse(output)
  return schema.parse(parsedJson)
}

async function buildReplicaE2EImage(
  replica: TopologyReplica,
  args: BuildReplicaImageArgs,
): Promise<string> {
  return await buildReplicaImage(replica, "e2e", args)
}

async function buildReplicaImage(
  replica: TopologyReplica,
  tag: string,
  args: BuildReplicaImageArgs,
): Promise<string> {
  const packagePath = getReplicaPackagePath(replica.name)
  const packageJsonPath = resolve(packagePath, "package.json")
  if (!(await pathExists(packageJsonPath))) {
    throw new Error(
      `Failed to prepare image for replica "${replica.name}". Local package was not found in "${packagePath}".`,
    )
  }

  const config = await loadPackageConfig(args.logger, packagePath)

  if (!config.reside.image) {
    throw new Error(`Replica package "${replica.name}" does not define package.json reside.image`)
  }

  const builtImage = await buildPackageImage(packagePath, {
    commandLog: args.commandLog,
    logger: args.logger,
    tag,
    push: true,
  })

  if (!builtImage.includes("@sha256:")) {
    throw new Error(
      `Built image for replica "${replica.name}" is not digest-pinned: "${builtImage}"`,
    )
  }

  return builtImage
}

function buildKubectlBaseArgs(access: Pick<KubernetesClusterAccess, "context">): string[] {
  const args = ["kubectl"]

  args.push("--context", access.context)
  return args
}

async function applyManifest(
  access: KubernetesClusterAccess,
  manifestPath: string,
  args: CommandLoggingArgs = {},
  options: ApplyManifestOptions = {},
): Promise<void> {
  const applyArgs = [...buildKubectlBaseArgs(access), "apply"]

  if (options.serverSide) {
    applyArgs.push("--server-side=true", "--force-conflicts")
  }

  applyArgs.push("-f", manifestPath)

  await runCommand(applyArgs, {
    commandLog: args.commandLog,
  })
}

async function patchKnativeNetworkConfig(
  access: KubernetesClusterAccess,
  args: CommandLoggingArgs = {},
): Promise<void> {
  await runCommand(
    [
      ...buildKubectlBaseArgs(access),
      "-n",
      "knative-serving",
      "patch",
      "configmap",
      "config-network",
      "--type",
      "merge",
      "-p",
      '{"data":{"ingress-class":"kourier.ingress.networking.knative.dev"}}',
    ],
    {
      commandLog: args.commandLog,
    },
  )
}

async function waitForDeploymentRollout(
  access: KubernetesClusterAccess,
  target: RolloutTarget,
  args: CommandLoggingArgs = {},
): Promise<void> {
  await runCommand(
    [
      ...buildKubectlBaseArgs(access),
      "-n",
      target.namespace,
      "rollout",
      "status",
      `deployment/${target.deployment}`,
      "--timeout=300s",
    ],
    {
      commandLog: args.commandLog,
    },
  )
}

async function pipeReadableToStdin(
  source: ReadableStream<Uint8Array>,
  sink: ReturnType<typeof Bun.spawn>["stdin"],
): Promise<void> {
  if (!sink || typeof sink === "number") {
    throw new Error("Process stdin is not writable")
  }

  const reader = source.getReader()

  while (true) {
    const chunk = await reader.read()
    if (chunk.done) {
      break
    }

    await sink.write(chunk.value)
  }

  await sink.end()
}

async function consumeStreamLines(
  stream: ReadableStream<Uint8Array> | null,
  onLine: (line: string) => void,
): Promise<void> {
  if (!stream) {
    return
  }

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let pending = ""

  while (true) {
    const chunk = await reader.read()
    if (chunk.done) {
      break
    }

    pending += decoder.decode(chunk.value, { stream: true })
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ""

    for (const line of lines) {
      if (line.trim().length === 0) {
        continue
      }

      onLine(line)
    }
  }

  pending += decoder.decode()
  if (pending.trim().length > 0) {
    onLine(pending)
  }
}

function isRetriableLogStreamError(line: string): boolean {
  return (
    line.includes("waiting to start: ContainerCreating") ||
    line.includes("waiting to start: PodInitializing")
  )
}

function writeLineToStdout(prefix: string, line: string): void {
  process.stdout.write(`${prefix}${line}\n`)
}

/**
 * Creates a line writer that formats logs with `pino-pretty` and forwards
 * the output to stdout with a stable prefix.
 *
 * It gracefully falls back to plain stdout lines when `pino-pretty` cannot be started.
 *
 * @param prefix The prefix prepended to every output line.
 * @returns The pretty writer.
 */
export function createPinoPrettyStdoutWriter(prefix: string): PrettyStdoutWriter {
  try {
    const prettyBinary = resolve(getCliRootPath(), "node_modules", ".bin", "pino-pretty")
    const prettyProcess = Bun.spawn(
      [prettyBinary, "--singleLine", "--ignore", "pid,hostname", "--colorize", "true"],
      {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    )

    if (!prettyProcess.stdin || typeof prettyProcess.stdin === "number") {
      return {
        writeLine: async line => {
          writeLineToStdout(prefix, line)
        },
        close: async () => {},
      }
    }

    const stdoutPromise = consumeStreamLines(prettyProcess.stdout, line => {
      writeLineToStdout(prefix, line)
    })
    const stderrPromise = consumeStreamLines(prettyProcess.stderr, line => {
      writeLineToStdout(prefix, line)
    })

    let closed = false

    return {
      writeLine: async line => {
        if (closed) {
          writeLineToStdout(prefix, line)
          return
        }

        await prettyProcess.stdin.write(`${line}\n`)
      },
      close: async () => {
        if (closed) {
          return
        }

        closed = true

        await prettyProcess.stdin.end()
        await prettyProcess.exited.catch(() => undefined)
        await stdoutPromise
        await stderrPromise
      },
    }
  } catch {
    return {
      writeLine: async line => {
        writeLineToStdout(prefix, line)
      },
      close: async () => {},
    }
  }
}

function buildReplicaBody(replica: TopologyReplica): Record<string, unknown> {
  const metadata = {
    name: replica.name,
  }

  return {
    apiVersion: `${replicaApiGroup}/${replicaApiVersion}`,
    kind: "Replica",
    metadata,
    spec: {
      image: replica.image,
    },
  }
}

function buildConfigMap(
  namespace: string,
  configMap: { name: string; data: Record<string, string> },
): Record<string, unknown> {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: configMap.name,
      namespace,
    },
    data: configMap.data,
  }
}

function buildSecret(
  namespace: string,
  secret: { name: string; data: Record<string, string> },
): Record<string, unknown> {
  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: secret.name,
      namespace,
    },
    type: "Opaque",
    stringData: secret.data,
  }
}

function buildReplicaClusterRole(
  replicaName: string,
  rules: ClusterRoleRule[],
): Record<string, unknown> {
  return {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "ClusterRole",
    metadata: {
      name: `replica-${replicaName}`,
    },
    rules,
  }
}

function buildReplicaBootstrapClusterRole(
  replicaName: string,
  rules: ClusterRoleRule[],
): Record<string, unknown> {
  return {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "ClusterRole",
    metadata: {
      name: `replica-${replicaName}-bootstrap`,
    },
    rules,
  }
}

function buildReplicaClusterRoleBinding(
  replicaName: string,
  namespace: string,
): Record<string, unknown> {
  return {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "ClusterRoleBinding",
    metadata: {
      name: `replica-${replicaName}`,
    },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "ClusterRole",
      name: `replica-${replicaName}`,
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: replicaName,
        namespace,
      },
    ],
  }
}

function buildReplicaBootstrapClusterRoleBinding(
  replicaName: string,
  namespace: string,
): Record<string, unknown> {
  return {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "ClusterRoleBinding",
    metadata: {
      name: `replica-${replicaName}-bootstrap`,
    },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "ClusterRole",
      name: `replica-${replicaName}-bootstrap`,
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: replicaName,
        namespace,
      },
    ],
  }
}

async function applyResourceFromStdin(
  access: KubernetesClusterAccess,
  body: unknown,
  args: CommandLoggingArgs = {},
): Promise<void> {
  await runCommand([...buildKubectlBaseArgs(access), "apply", "-f", "-"], {
    commandLog: args.commandLog,
    input: JSON.stringify(body),
  })
}

function buildE2EJob(
  namespace: string,
  replicaName: string,
  image: string,
): Record<string, unknown> {
  const workingDirectory = getReplicaPackageContainerPath(replicaName)

  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: `${replicaName}-e2e`,
      namespace,
      labels: {
        "app.kubernetes.io/name": `replica-${replicaName}`,
        "reside.io/replica": replicaName,
        "reside.io/component": "e2e",
      },
    },
    spec: {
      backoffLimit: 0,
      template: {
        metadata: {
          labels: {
            "app.kubernetes.io/name": `replica-${replicaName}`,
            "reside.io/replica": replicaName,
            "reside.io/component": "e2e",
          },
        },
        spec: {
          restartPolicy: "Never",
          serviceAccountName: replicaName,
          containers: [
            {
              name: "e2e",
              image,
              imagePullPolicy: "Always",
              env: [
                {
                  name: "NODE_EXTRA_CA_CERTS",
                  value: "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
                },
                {
                  name: "REPLICA_NAME",
                  value: replicaName,
                },
                {
                  name: "REPLICA_COMPONENT_NAME",
                  value: `${replicaName}-e2e`,
                },
                {
                  name: "REPLICA_NAMESPACE",
                  value: namespace,
                },
                {
                  name: "REPLICA_SERVICE_ACCOUNT_NAME",
                  value: replicaName,
                },
                {
                  name: "REPLICA_IMAGE",
                  value: image,
                },
                {
                  name: "RESIDE_BIN",
                  value: "e2e",
                },
              ],
              workingDir: workingDirectory,
            },
          ],
        },
      },
    },
  }
}

/**
 * Creates cluster access metadata for the provided context.
 *
 * @param args The target context.
 * @returns The initialized access metadata.
 */
export function createKubernetesClusterAccess(args: { context: string }): KubernetesClusterAccess {
  return {
    context: args.context,
  }
}

/**
 * Ensures a kind cluster exists and returns its context name.
 *
 * @param clusterName The target kind cluster name.
 * @param recreate Whether to recreate the cluster from scratch.
 * @returns The context name.
 */
export async function ensureKindCluster(
  clusterName: string,
  recreate: boolean,
  args: CommandLoggingArgs = {},
): Promise<EnsureKindClusterResult> {
  if (recreate) {
    await args.commandLog?.onLine(`recreating cluster ${clusterName}`)
    await runCommand(["kind", "delete", "cluster", "--name", clusterName], {
      commandLog: args.commandLog,
      ignoreExitCode: true,
    })
  }

  const existingClustersOutput = await runCommand(["kind", "get", "clusters"], {
    commandLog: args.commandLog,
    ignoreExitCode: true,
  })
  const existingClusters = existingClustersOutput
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)

  if (!existingClusters.includes(clusterName)) {
    await args.commandLog?.onLine(`creating cluster ${clusterName}`)
    await runCommand(["kind", "create", "cluster", "--name", clusterName], {
      commandLog: args.commandLog,
    })
  } else {
    await args.commandLog?.onLine(`using existing cluster ${clusterName}`)
  }

  await args.commandLog?.onLine(`using context kind-${clusterName}`)

  return {
    context: `kind-${clusterName}`,
  }
}

/**
 * Builds an e2e-tagged image for the given replica.
 *
 * It builds a local replica package using the `e2e` tag.
 *
 * @param replica The replica to prepare.
 * @returns The digest-pinned image reference.
 */
export async function buildE2EImage(
  replica: TopologyReplica,
  args: BuildReplicaImageArgs,
): Promise<string> {
  return await buildReplicaE2EImage(replica, args)
}

/**
 * Builds a latest-tagged image for the given replica.
 *
 * It builds a local replica package using the `latest` tag.
 *
 * @param replica The replica to prepare.
 * @returns The digest-pinned image reference.
 */
export async function buildLatestImage(
  replica: TopologyReplica,
  args: BuildReplicaImageArgs,
): Promise<string> {
  return await buildReplicaImage(replica, "latest", args)
}

export async function installGatewayApi(
  access: KubernetesClusterAccess,
  args: CommandLoggingArgs = {},
): Promise<void> {
  const cliRootPath = getCliRootPath()
  await applyManifest(
    access,
    resolve(cliRootPath, "assets", "gateway-api", "standard-install.yaml"),
    args,
  )
}

export async function installKnativeServing(
  access: KubernetesClusterAccess,
  args: CommandLoggingArgs = {},
): Promise<void> {
  const cliRootPath = getCliRootPath()

  await applyManifest(access, resolve(cliRootPath, "assets", "knative", "serving-crds.yaml"), args)
  await applyManifest(access, resolve(cliRootPath, "assets", "knative", "serving-core.yaml"), args)
}

export async function waitForKnativeServing(
  access: KubernetesClusterAccess,
  args: CommandLoggingArgs = {},
): Promise<void> {
  const rolloutTargets: RolloutTarget[] = [
    { namespace: "knative-serving", deployment: "controller" },
    { namespace: "knative-serving", deployment: "webhook" },
  ]

  for (const target of rolloutTargets) {
    await waitForDeploymentRollout(access, target, args)
  }
}

export async function installKourier(
  access: KubernetesClusterAccess,
  args: CommandLoggingArgs = {},
): Promise<void> {
  const cliRootPath = getCliRootPath()

  await applyManifest(access, resolve(cliRootPath, "assets", "knative", "kourier.yaml"), args)
  await patchKnativeNetworkConfig(access, args)
}

export async function installKyverno(
  access: KubernetesClusterAccess,
  args: CommandLoggingArgs = {},
): Promise<void> {
  const cliRootPath = getCliRootPath()

  await applyManifest(access, resolve(cliRootPath, "assets", "kyverno", "install.yaml"), args, {
    serverSide: true,
  })
}

export async function waitForKourier(
  access: KubernetesClusterAccess,
  args: CommandLoggingArgs = {},
): Promise<void> {
  const rolloutTargets: RolloutTarget[] = [
    { namespace: "knative-serving", deployment: "net-kourier-controller" },
    { namespace: "kourier-system", deployment: "3scale-kourier-gateway" },
  ]

  for (const target of rolloutTargets) {
    await waitForDeploymentRollout(access, target, args)
  }
}

export async function waitForKyverno(
  access: KubernetesClusterAccess,
  args: CommandLoggingArgs = {},
): Promise<void> {
  const rolloutTargets: RolloutTarget[] = [
    { namespace: "kyverno", deployment: "kyverno-admission-controller" },
    { namespace: "kyverno", deployment: "kyverno-background-controller" },
    { namespace: "kyverno", deployment: "kyverno-cleanup-controller" },
    { namespace: "kyverno", deployment: "kyverno-reports-controller" },
  ]

  for (const target of rolloutTargets) {
    await waitForDeploymentRollout(access, target, args)
  }
}

export async function installResideOperator(
  access: KubernetesClusterAccess,
  args: CommandLoggingArgs = {},
): Promise<void> {
  const cliRootPath = getCliRootPath()

  await applyManifest(
    access,
    resolve(cliRootPath, "..", "operator", "assets", "reside-operator-crds.yaml"),
    args,
  )
  await applyManifest(
    access,
    resolve(cliRootPath, "..", "operator", "assets", "reside-operator.yaml"),
    args,
  )
}

export async function waitForResideOperator(
  access: KubernetesClusterAccess,
  args: CommandLoggingArgs = {},
): Promise<void> {
  await waitForDeploymentRollout(
    access,
    { namespace: operatorNamespace, deployment: "reside-operator" },
    args,
  )
}

/**
 * Deletes all Replica custom resources and waits until all replica namespaces are removed.
 *
 * @param access The target cluster access.
 */
export async function recreateReplicas(
  access: KubernetesClusterAccess,
  args: CommandLoggingArgs = {},
): Promise<void> {
  await runKubectl(access, ["delete", "replicas.reside.io", "--all", "--wait=false"], {
    commandLog: args.commandLog,
    ignoreExitCode: true,
  })

  await waitFor(
    async () => {
      const namespaces = await getKubectlJson(
        access,
        ["get", "namespaces", "-o", "json"],
        NamespaceListSchema,
      )
      if (!namespaces) {
        return true
      }

      const replicaNamespaces = namespaces.items
        .map(item => item.metadata?.name)
        .filter((name): name is string => typeof name === "string")
        .filter(name => name.startsWith("replica-"))

      return replicaNamespaces.length === 0
    },
    300_000,
    "Timed out waiting for replica namespaces deletion",
  )
}

/**
 * Creates or updates the `Replica` custom resource for a topology replica.
 *
 * @param access The target cluster access.
 * @param replica The replica specification.
 */
export async function applyReplica(
  access: KubernetesClusterAccess,
  replica: TopologyReplica,
  args: CommandLoggingArgs = {},
): Promise<void> {
  await applyResourceFromStdin(access, buildReplicaBody(replica), args)
}

/**
 * Waits until the operator reports the replica as ready.
 *
 * @param access The target cluster access.
 * @param replicaName The replica name.
 */
export async function waitForReplicaReady(
  access: KubernetesClusterAccess,
  replicaName: string,
): Promise<void> {
  const timeoutMs = getReplicaReadyTimeoutMs(replicaName)

  await waitFor(
    async () => {
      const response = await getKubectlJson(
        access,
        ["get", "replica", replicaName, "-o", "json"],
        ReplicaStatusSchema,
      )
      if (!response) {
        return false
      }

      const readyCondition = response.status?.conditions.find(
        condition => condition.type === "Ready",
      )

      const generation = response.metadata?.generation
      const observedGeneration = response.status?.observedGeneration
      if (
        typeof generation === "number" &&
        typeof observedGeneration === "number" &&
        observedGeneration < generation
      ) {
        return false
      }

      if (response.status?.phase === "Failed") {
        const failureMessage = readyCondition?.message ?? `Replica "${replicaName}" failed`
        throw new Error(failureMessage)
      }

      return response.status?.phase === "Ready" && readyCondition?.status === "True"
    },
    timeoutMs,
    `Replica "${replicaName}" did not become ready in time`,
  )
}

/**
 * Waits until the replica namespace exists.
 *
 * @param access The target cluster access.
 * @param replicaName The replica name.
 */
export async function waitForReplicaNamespace(
  access: KubernetesClusterAccess,
  replicaName: string,
): Promise<void> {
  const namespace = getReplicaNamespace(replicaName)

  await waitFor(
    async () => {
      const output = await runKubectl(access, ["get", "namespace", namespace, "-o", "name"], {
        ignoreExitCode: true,
        logOutput: false,
      })

      return output.trim().length > 0
    },
    180_000,
    `Replica namespace "${namespace}" did not become available in time`,
  )
}

function getReplicaReadyTimeoutMs(replicaName: string): number {
  const defaultTimeoutMs = 420_000

  if (replicaName === "database") {
    return 900_000
  }

  return defaultTimeoutMs
}

/**
 * Deletes a stale failed bootstrap job so the operator can create a fresh one.
 *
 * This keeps repeated bootstrap and e2e runs idempotent even when a previous
 * bootstrap attempt failed transiently.
 *
 * @param access The target cluster access.
 * @param replicaName The replica name.
 * @returns True when a failed job was deleted.
 */
export async function resetFailedBootstrapJob(
  access: KubernetesClusterAccess,
  replicaName: string,
): Promise<boolean> {
  const namespace = getReplicaNamespace(replicaName)
  const jobName = `${replicaName}-bootstrap`
  const job = await getKubectlJson(
    access,
    ["-n", namespace, "get", "job", jobName, "-o", "json"],
    JobSchema,
  )

  if (!job) {
    return false
  }

  const failed = job.status?.failed ?? 0
  const succeeded = job.status?.succeeded ?? 0
  if (failed === 0 || succeeded > 0) {
    return false
  }

  await runKubectl(access, ["-n", namespace, "delete", "job", jobName, "--wait=false"], {
    ignoreExitCode: true,
  })
  await waitForJobDeletion(access, namespace, jobName)

  return true
}

/**
 * Upserts a config map in the replica namespace.
 *
 * @param access The target cluster access.
 * @param namespace The replica namespace.
 * @param configMap The config map payload.
 */
export async function upsertConfigMap(
  access: KubernetesClusterAccess,
  namespace: string,
  configMap: ReplicaData,
  args: CommandLoggingArgs = {},
): Promise<void> {
  await applyResourceFromStdin(access, buildConfigMap(namespace, configMap), args)
}

/**
 * Reads the current config map data from the replica namespace.
 *
 * @param access The target cluster access.
 * @param namespace The replica namespace.
 * @param name The config map name.
 * @returns The current config map data when it exists.
 */
export async function getConfigMapData(
  access: KubernetesClusterAccess,
  namespace: string,
  name: string,
): Promise<Record<string, string> | undefined> {
  const resource = await getKubectlJson(
    access,
    ["-n", namespace, "get", "configmap", name, "-o", "json"],
    ResourceDataSchema,
  )

  return resource?.data
}

/**
 * Upserts a secret in the replica namespace.
 *
 * @param access The target cluster access.
 * @param namespace The replica namespace.
 * @param secret The secret payload.
 */
export async function upsertSecret(
  access: KubernetesClusterAccess,
  namespace: string,
  secret: ReplicaData,
  args: CommandLoggingArgs = {},
): Promise<void> {
  await applyResourceFromStdin(access, buildSecret(namespace, secret), args)
}

/**
 * Upserts a replica cluster role and binds it to the replica service account.
 *
 * @param access The target cluster access.
 * @param replicaName The replica name.
 * @param rules The cluster role rules to grant.
 */
export async function upsertReplicaClusterRole(
  access: KubernetesClusterAccess,
  replicaName: string,
  rules: ClusterRoleRule[],
  args: CommandLoggingArgs = {},
): Promise<void> {
  const namespace = getReplicaNamespace(replicaName)

  await applyResourceFromStdin(access, buildReplicaClusterRole(replicaName, rules), args)
  await applyResourceFromStdin(access, buildReplicaClusterRoleBinding(replicaName, namespace), args)
}

/**
 * Upserts a temporary bootstrap cluster role and binding for a replica service account.
 *
 * @param access The target cluster access.
 * @param replicaName The replica name.
 * @param rules The bootstrap cluster role rules to grant.
 */
export async function upsertReplicaBootstrapClusterRole(
  access: KubernetesClusterAccess,
  replicaName: string,
  rules: ClusterRoleRule[],
  args: CommandLoggingArgs = {},
): Promise<void> {
  const namespace = getReplicaNamespace(replicaName)

  await applyResourceFromStdin(access, buildReplicaBootstrapClusterRole(replicaName, rules), args)
  await applyResourceFromStdin(
    access,
    buildReplicaBootstrapClusterRoleBinding(replicaName, namespace),
    args,
  )
}

/**
 * Deletes a temporary bootstrap cluster role and binding for a replica service account.
 *
 * @param access The target cluster access.
 * @param replicaName The replica name.
 */
export async function deleteReplicaBootstrapClusterRole(
  access: KubernetesClusterAccess,
  replicaName: string,
  args: CommandLoggingArgs = {},
): Promise<void> {
  await runCommand(
    [
      ...buildKubectlBaseArgs(access),
      "delete",
      "clusterrolebinding",
      `replica-${replicaName}-bootstrap`,
      "--ignore-not-found=true",
    ],
    {
      commandLog: args.commandLog,
    },
  )

  await runCommand(
    [
      ...buildKubectlBaseArgs(access),
      "delete",
      "clusterrole",
      `replica-${replicaName}-bootstrap`,
      "--ignore-not-found=true",
    ],
    {
      commandLog: args.commandLog,
    },
  )
}

/**
 * Reads the current secret data from the replica namespace.
 *
 * @param access The target cluster access.
 * @param namespace The replica namespace.
 * @param name The secret name.
 * @returns The decoded secret data when it exists.
 */
export async function getSecretData(
  access: KubernetesClusterAccess,
  namespace: string,
  name: string,
): Promise<Record<string, string> | undefined> {
  const resource = await getKubectlJson(
    access,
    ["-n", namespace, "get", "secret", name, "-o", "json"],
    ResourceDataSchema,
  )

  if (!resource) {
    return undefined
  }

  const decodedData: Record<string, string> = {}

  for (const [key, value] of Object.entries(resource.data)) {
    decodedData[key] = Buffer.from(value, "base64").toString("utf-8")
  }

  return decodedData
}

async function waitForJobDeletion(
  access: KubernetesClusterAccess,
  namespace: string,
  jobName: string,
): Promise<void> {
  await waitFor(
    async () => {
      const output = await runKubectl(
        access,
        ["-n", namespace, "get", "job", jobName, "-o", "name"],
        { ignoreExitCode: true, logOutput: false },
      )

      return output.trim().length === 0
    },
    120_000,
    `Timed out waiting for job "${jobName}" deletion`,
  )
}

/**
 * Recreates the e2e job for the given replica.
 *
 * @param access The target cluster access.
 * @param replica The replica specification.
 * @returns The created job name.
 */
export async function recreateE2EJob(
  access: KubernetesClusterAccess,
  replica: TopologyReplica,
): Promise<string> {
  const namespace = getReplicaNamespace(replica.name)
  const jobName = `${replica.name}-e2e`

  await runKubectl(
    access,
    ["-n", namespace, "delete", "job", jobName, "--ignore-not-found=true", "--wait=false"],
    {
      ignoreExitCode: true,
    },
  )

  await waitForJobDeletion(access, namespace, jobName)
  await applyResourceFromStdin(access, buildE2EJob(namespace, replica.name, replica.image))

  return jobName
}

/**
 * Waits for the pod created by a job.
 *
 * @param access The target cluster access.
 * @param namespace The namespace.
 * @param jobName The job name.
 * @returns The pod name.
 */
export async function waitForJobPod(
  access: KubernetesClusterAccess,
  namespace: string,
  jobName: string,
): Promise<string> {
  let podName = ""

  await waitFor(
    async () => {
      const podList = await getKubectlJson(
        access,
        ["-n", namespace, "get", "pods", "-l", `job-name=${jobName}`, "-o", "json"],
        PodListSchema,
      )
      if (!podList) {
        return false
      }

      const pod = podList.items[0]
      if (!pod?.metadata?.name) {
        return false
      }

      podName = pod.metadata.name
      return true
    },
    120_000,
    `Timed out waiting for pod of job "${jobName}"`,
  )

  return podName
}

/**
 * Waits until a job completes successfully.
 *
 * @param access The target cluster access.
 * @param namespace The namespace.
 * @param jobName The job name.
 */
export async function waitForJobCompletion(
  access: KubernetesClusterAccess,
  namespace: string,
  jobName: string,
): Promise<void> {
  await waitFor(
    async () => {
      const job = await getKubectlJson(
        access,
        ["-n", namespace, "get", "job", jobName, "-o", "json"],
        JobSchema,
      )
      if (!job) {
        return false
      }

      const succeeded = job.status?.succeeded ?? 0
      if (succeeded > 0) {
        return true
      }

      const failed = job.status?.failed ?? 0
      if (failed > 0) {
        throw new Error(`Job "${jobName}" failed`)
      }

      return false
    },
    300_000,
    `Timed out waiting for job "${jobName}" completion`,
  )
}

/**
 * Dumps useful diagnostics for a failed e2e job.
 *
 * @param access The target cluster access.
 * @param namespace The namespace.
 * @param podName The pod name.
 * @param jobName The job name.
 * @param containerName The container name.
 * @param onLine The output sink.
 */
export async function dumpJobFailureDiagnostics(
  access: KubernetesClusterAccess,
  namespace: string,
  podName: string,
  jobName: string,
  containerName: string,
  onLine: (line: string) => void | Promise<void>,
): Promise<void> {
  const currentLogs = await runKubectl(
    access,
    ["-n", namespace, "logs", podName, "-c", containerName, "--timestamps=false", "--tail=200"],
    {
      ignoreExitCode: true,
      logOutput: false,
    },
  )

  if (currentLogs.trim().length > 0) {
    await onLine("current container logs:")

    for (const line of currentLogs.split(/\r?\n/)) {
      if (line.trim().length === 0) {
        continue
      }

      await onLine(line)
    }
  }

  const previousLogs = await runKubectl(
    access,
    [
      "-n",
      namespace,
      "logs",
      podName,
      "-c",
      containerName,
      "--previous",
      "--timestamps=false",
      "--tail=200",
    ],
    {
      ignoreExitCode: true,
      logOutput: false,
    },
  )

  if (previousLogs.trim().length > 0) {
    await onLine("previous container logs:")

    for (const line of previousLogs.split(/\r?\n/)) {
      if (line.trim().length === 0) {
        continue
      }

      await onLine(line)
    }
  }

  const jobDescription = await runKubectl(access, ["-n", namespace, "describe", "job", jobName], {
    ignoreExitCode: true,
    logOutput: false,
  })

  if (jobDescription.trim().length > 0) {
    await onLine("job describe:")

    for (const line of jobDescription.split(/\r?\n/).slice(-40)) {
      if (line.trim().length === 0) {
        continue
      }

      await onLine(line)
    }
  }
}

/**
 * Streams pod logs through `pino-pretty` and forwards them into a callback.
 *
 * @param access The target cluster access.
 * @param namespace The namespace.
 * @param podName The pod name.
 * @param containerName The container name.
 * @param prefix The output prefix.
 * @param onLine The log sink.
 */
export async function streamPodLogs(
  access: KubernetesClusterAccess,
  namespace: string,
  podName: string,
  containerName: string,
  prefix: string,
  onLine: (line: string) => void,
): Promise<void> {
  const prettyBinary = resolve(getCliRootPath(), "node_modules", ".bin", "pino-pretty")
  const deadline = Date.now() + 300_000
  let hasReportedRetryWait = false

  while (true) {
    const kubectlArgs = [
      ...buildKubectlBaseArgs(access),
      "-n",
      namespace,
      "logs",
      podName,
      "-c",
      containerName,
      "--follow",
      "--pod-running-timeout=300s",
      "--timestamps=false",
    ]

    const kubectlProcess = Bun.spawn(kubectlArgs, {
      stdout: "pipe",
      stderr: "pipe",
    })
    const prettyProcess = Bun.spawn(
      [prettyBinary, "--singleLine", "--ignore", "pid,hostname", "--colorize", "false"],
      {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    )

    if (!kubectlProcess.stdout || !prettyProcess.stdin) {
      throw new Error("Failed to initialize log streaming pipeline")
    }

    const stderrLines: string[] = []
    const writePromise = pipeReadableToStdin(kubectlProcess.stdout, prettyProcess.stdin)

    const prettyOutputPromise = (async () => {
      await consumeStreamLines(prettyProcess.stdout, line => {
        onLine(`${prefix}${line}`)
      })
    })()

    const stderrReaderPromise = (async () => {
      await consumeStreamLines(kubectlProcess.stderr, line => {
        stderrLines.push(line)
      })
    })()

    await writePromise.catch(() => undefined)
    const kubectlExitCode = await kubectlProcess.exited.catch(() => 1)
    await prettyProcess.exited.catch(() => undefined)
    await prettyOutputPromise
    await stderrReaderPromise

    const retriableError =
      kubectlExitCode !== 0 &&
      stderrLines.length > 0 &&
      stderrLines.every(isRetriableLogStreamError)

    if (!retriableError) {
      for (const line of stderrLines) {
        onLine(`${prefix}${line}`)
      }

      return
    }

    if (Date.now() >= deadline) {
      for (const line of stderrLines) {
        onLine(`${prefix}${line}`)
      }

      return
    }

    if (!hasReportedRetryWait) {
      onLine(`${prefix}waiting for container log stream to become available...`)
      hasReportedRetryWait = true
    }

    await Bun.sleep(1_000)
  }
}
