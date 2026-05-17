import type { CommandLog } from "./process"
import { confirm, input } from "@inquirer/prompts"
import { ListrInquirerPromptAdapter } from "@listr2/prompt-adapter-inquirer"
import { Listr } from "listr2"
import {
  applyReplica,
  buildE2EImage,
  buildLatestImage,
  createKubernetesClusterAccess,
  createPinoPrettyStdoutWriter,
  deleteReplicaBootstrapClusterRole,
  dumpJobFailureDiagnostics,
  ensureKindCluster,
  getConfigMapData,
  getReplicaNamespace,
  getSecretData,
  installGatewayApi,
  installKnativeServing,
  installKourier,
  installResideOperator,
  type KubernetesClusterAccess,
  recreateE2EJob,
  recreateReplicas,
  resetFailedBootstrapJob,
  setResideOperatorClusterDomain,
  streamPodLogs,
  upsertConfigMap,
  upsertReplicaBootstrapClusterRole,
  upsertReplicaClusterRole,
  upsertSecret,
  waitForJobCompletion,
  waitForJobPod,
  waitForKnativeServing,
  waitForKourier,
  waitForReplicaNamespace,
  waitForReplicaReady,
  waitForResideOperator,
} from "./kubernetes"
import { createChildLogger, createTaskOutputLogger, type ResideLogger } from "./logger"
import {
  loadTopology,
  type MissingVariablePrompt,
  promptEnvironmentVariable,
  readStringArrayArgument,
  resolveReplicaSelection,
  substituteEnvironmentReferences,
  type TopologyReplica,
} from "./topology"

export type ProvisionFlowOptions = {
  ask?: boolean
  build?: boolean
  clusterDomain: string
  context?: string
  clusterName?: string
  installGatewayApi?: boolean
  only?: boolean
  skipBase?: boolean
  grantBootstrapRole?: boolean
  recreate?: boolean
  requestedReplicas: string[]
  runE2E: boolean
  silent?: boolean
  textOutput?: boolean
  topologyPath?: string
}

type ProvisionFlowContext = {
  access?: KubernetesClusterAccess
  allReplicas: TopologyReplica[]
  selectedReplicas: TopologyReplica[]
  topologyPath: string
}

type ReplicaResourceEntries = Array<{
  name: string
  data: Record<string, string>
}>

type ResourceKind = "secret" | "config map"

type ResourceFieldOverridePrompt = (fieldName: string) => Promise<boolean>
type ResourceFieldValuePrompt = (fieldName: string) => Promise<string>

type ResolveResourceDataArgs = {
  askForOverrides: boolean
  existingData?: Record<string, string>
  promptFieldOverride?: ResourceFieldOverridePrompt
  promptFieldValue?: ResourceFieldValuePrompt
  resolveVariable: (variableName: string) => Promise<string>
  templateData: Record<string, string>
}

function createTaskLogger(
  setOutput: (value: string) => void,
  prefix: string,
  options?: {
    silent?: boolean
  },
): ResideLogger {
  const outputLogger = createTaskOutputLogger(value => {
    if (options?.silent) {
      return
    }

    setOutput(value)
  })

  return createChildLogger(outputLogger, `[${prefix}] `)
}

function createTaskCommandLog(taskLogger: ResideLogger, tag: string): CommandLog {
  const commandLogger = createChildLogger(taskLogger, `[${tag}] `)

  return {
    tag,
    onLine: line => {
      commandLogger.info(line)
    },
  }
}

async function writeFailureDump(
  replicaName: string,
  render: (writeLine: (line: string) => Promise<void>) => Promise<void>,
): Promise<void> {
  const writer = createPinoPrettyStdoutWriter(`[${replicaName}] `)

  try {
    await render(async line => {
      await writer.writeLine(line)
    })
  } finally {
    await writer.close()
  }
}

function hasEnvironmentReferences(value: string): boolean {
  return /\$(?:\{([A-Z0-9_]+)\}|([A-Z0-9_]+))/.test(value)
}

function getReplicaSecrets(replica: TopologyReplica): ReplicaResourceEntries {
  return getReplicaResourceEntries(replica.secrets)
}

function getReplicaConfigMaps(replica: TopologyReplica): ReplicaResourceEntries {
  return getReplicaResourceEntries(replica.configMaps)
}

function getReplicaResourceEntries(
  resources: Record<string, Record<string, unknown>>,
): ReplicaResourceEntries {
  return Object.entries(resources).map(([name, data]) => {
    const normalizedData: Record<string, string> = {}

    for (const [key, value] of Object.entries(data)) {
      if (typeof value !== "string") {
        throw new Error(
          `Topology resource "${name}" field "${key}" must be a string, got "${typeof value}"`,
        )
      }

      normalizedData[key] = value
    }

    return {
      name,
      data: normalizedData,
    }
  })
}

async function resolveResourceData(args: ResolveResourceDataArgs): Promise<{
  data: Record<string, string>
  shouldApply: boolean
}> {
  const resolvedData: Record<string, string> = {
    ...(args.existingData ?? {}),
  }
  let shouldApply = false

  for (const [fieldName, templateValue] of Object.entries(args.templateData)) {
    const existingValue = args.existingData?.[fieldName]

    if (existingValue !== undefined && args.askForOverrides) {
      const shouldOverride = args.promptFieldOverride
        ? await args.promptFieldOverride(fieldName)
        : false

      if (!shouldOverride) {
        resolvedData[fieldName] = existingValue
        continue
      }

      const nextValue = args.promptFieldValue
        ? await args.promptFieldValue(fieldName)
        : existingValue

      resolvedData[fieldName] = nextValue
      if (nextValue !== existingValue) {
        shouldApply = true
      }
      continue
    }

    if (existingValue !== undefined && hasEnvironmentReferences(templateValue)) {
      resolvedData[fieldName] = existingValue
      continue
    }

    const resolvedValue = await substituteEnvironmentReferences(templateValue, args.resolveVariable)
    resolvedData[fieldName] = resolvedValue

    if (existingValue !== resolvedValue) {
      shouldApply = true
    }
  }

  return {
    data: resolvedData,
    shouldApply,
  }
}

/**
 * Reads repeated replica arguments from the parsed command context.
 *
 * @param args The raw command arguments.
 * @returns The normalized replica list.
 */
export function readRequestedReplicas(args: object): string[] {
  return readStringArrayArgument(args, "replica")
}

/**
 * Runs the shared provisioning flow for both `bootstrap` and `e2e` commands.
 *
 * @param options The execution options.
 */
export async function runProvisionFlow(options: ProvisionFlowOptions): Promise<void> {
  const skipBase = (options.skipBase ?? false) || (options.only ?? false)
  const shouldInstallGatewayApi = options.runE2E || (options.installGatewayApi ?? false)
  const clusterDomain = options.clusterDomain

  const variableValues = new Map<string, string>()
  const pendingVariableValues = new Map<string, Promise<string>>()
  let promptQueue = Promise.resolve()

  async function queuePrompt<T>(promptOperation: () => Promise<T>): Promise<T> {
    const queuedPrompt = promptQueue.then(promptOperation)

    promptQueue = queuedPrompt.then(
      () => undefined,
      () => undefined,
    )

    return await queuedPrompt
  }

  async function resolveVariable(
    variableName: string,
    promptMissingVariable?: MissingVariablePrompt,
  ): Promise<string> {
    const cachedValue = variableValues.get(variableName)
    if (cachedValue) {
      return cachedValue
    }

    const pendingValue = pendingVariableValues.get(variableName)
    if (pendingValue) {
      return await pendingValue
    }

    const valuePromise = (async () => {
      const value = await queuePrompt(async () => {
        return await promptEnvironmentVariable(variableName, promptMissingVariable)
      })

      variableValues.set(variableName, value)
      return value
    })()

    pendingVariableValues.set(variableName, valuePromise)

    const value = await valuePromise
    pendingVariableValues.delete(variableName)
    variableValues.set(variableName, value)
    return value
  }

  function createMissingVariablePrompt(task: {
    prompt: (adapter: typeof ListrInquirerPromptAdapter) => {
      run: typeof ListrInquirerPromptAdapter.prototype.run
    }
  }): MissingVariablePrompt {
    return async variableName => {
      return await task.prompt(ListrInquirerPromptAdapter).run(input, {
        message: `Enter value for ${variableName}`,
        validate: value => (value.trim().length > 0 ? true : `${variableName} cannot be empty`),
      })
    }
  }

  function createFieldOverridePrompt(
    task: {
      prompt: (adapter: typeof ListrInquirerPromptAdapter) => {
        run: typeof ListrInquirerPromptAdapter.prototype.run
      }
    },
    resourceKind: ResourceKind,
    resourceName: string,
  ): ResourceFieldOverridePrompt {
    return async fieldName => {
      return await queuePrompt(async () => {
        return await task.prompt(ListrInquirerPromptAdapter).run(confirm, {
          default: false,
          message: `Override ${resourceKind} ${resourceName} field ${fieldName}?`,
        })
      })
    }
  }

  function createFieldValuePrompt(
    task: {
      prompt: (adapter: typeof ListrInquirerPromptAdapter) => {
        run: typeof ListrInquirerPromptAdapter.prototype.run
      }
    },
    resourceKind: ResourceKind,
    resourceName: string,
  ): ResourceFieldValuePrompt {
    return async fieldName => {
      return await queuePrompt(async () => {
        return await task.prompt(ListrInquirerPromptAdapter).run(input, {
          message: `Enter new value for ${resourceKind} ${resourceName} field ${fieldName}`,
          validate: value => (value.trim().length > 0 ? true : `${fieldName} cannot be empty`),
        })
      })
    }
  }

  const tasks = new Listr<ProvisionFlowContext, "default" | "simple", "simple">(
    [
      {
        title: "load topology",
        task: async (ctx, task) => {
          if (options.only && options.requestedReplicas.length === 0) {
            throw new Error("--only requires at least one --replica value")
          }

          const { topology, topologyPath } = await loadTopology(options.topologyPath)
          const selectedReplicas = resolveReplicaSelection(topology, options.requestedReplicas, {
            includeDependencies: !(options.only ?? false),
          })

          ctx.allReplicas = topology
          ctx.selectedReplicas = selectedReplicas
          ctx.topologyPath = topologyPath

          const selectedNames = selectedReplicas.map(replica => replica.name).join(", ")
          task.output = `topology: ${topologyPath}\nreplicas: ${selectedNames}`
        },
        rendererOptions: {
          persistentOutput: true,
        },
      },
      {
        title: "build e2e images",
        enabled: () => options.runE2E,
        task: (ctx, task) => {
          return task.newListr(
            ctx.selectedReplicas.map(replica => ({
              title: `prepare image for ${replica.name}`,
              task: async (_, imageTask) => {
                const taskLogger = createTaskLogger(
                  value => {
                    imageTask.output = value
                  },
                  `prepare image for ${replica.name}`,
                  { silent: options.silent },
                )
                const commandLog = createTaskCommandLog(taskLogger, "docker build")

                replica.image = await buildE2EImage(replica, {
                  commandLog,
                  logger: taskLogger,
                })
                taskLogger.info("image: %s", replica.image)
              },
              rendererOptions: {
                bottomBar: 6,
              },
            })),
            {
              concurrent: 1,
              exitOnError: true,
              rendererOptions: {
                collapseSubtasks: true,
                collapseErrors: false,
              },
            },
          )
        },
      },
      {
        title: "build latest images",
        enabled: () => !options.runE2E && (options.build ?? false),
        task: (ctx, task) => {
          return task.newListr(
            ctx.selectedReplicas.map(replica => ({
              title: `prepare image for ${replica.name}`,
              task: async (_, imageTask) => {
                const taskLogger = createTaskLogger(
                  value => {
                    imageTask.output = value
                  },
                  `prepare image for ${replica.name}`,
                  { silent: options.silent },
                )
                const commandLog = createTaskCommandLog(taskLogger, "docker build")

                replica.image = await buildLatestImage(replica, {
                  commandLog,
                  logger: taskLogger,
                })
                taskLogger.info("image: %s", replica.image)
              },
              rendererOptions: {
                bottomBar: 6,
              },
            })),
            {
              concurrent: 1,
              exitOnError: true,
              rendererOptions: {
                collapseSubtasks: true,
                collapseErrors: false,
              },
            },
          )
        },
      },
      {
        title: options.runE2E
          ? skipBase
            ? `use kind context kind-${options.clusterName ?? "reside-e2e"}`
            : `ensure kind cluster ${options.clusterName ?? "reside-e2e"}`
          : `use kubernetes context ${options.context ?? ""}`,
        task: async (ctx, task) => {
          const taskLogger = createTaskLogger(
            value => {
              task.output = value
            },
            options.runE2E ? "kind cluster" : "kubernetes context",
            { silent: options.silent },
          )

          if (options.runE2E) {
            if (skipBase) {
              const context = `kind-${options.clusterName ?? "reside-e2e"}`

              ctx.access = createKubernetesClusterAccess({
                context,
              })

              taskLogger.info("context: %s", context)
              return
            }

            const commandLog = createTaskCommandLog(taskLogger, "kind")
            const cluster = await ensureKindCluster(
              options.clusterName ?? "reside-e2e",
              options.recreate ?? false,
              { commandLog },
            )

            ctx.access = createKubernetesClusterAccess({
              context: cluster.context,
            })
            taskLogger.info("context: %s", cluster.context)
            return
          }

          if (!options.context) {
            throw new Error("bootstrap requires a kubeconfig context")
          }

          ctx.access = createKubernetesClusterAccess({
            context: options.context,
          })
          taskLogger.info("context: %s", options.context)
        },
        rendererOptions: {
          bottomBar: 6,
        },
      },
      {
        title: "recreate replicas",
        enabled: () => !options.runE2E && (options.recreate ?? false),
        task: async (ctx, task) => {
          const access = ctx.access
          if (!access) {
            throw new Error("cluster access is not initialized")
          }

          const taskLogger = createTaskLogger(
            value => {
              task.output = value
            },
            "replicas",
            { silent: options.silent },
          )
          const commandLog = createTaskCommandLog(taskLogger, "kubectl")

          await recreateReplicas(access, { commandLog })
        },
        rendererOptions: {
          bottomBar: 6,
        },
      },
      {
        title: "install cluster prerequisites",
        enabled: () => !skipBase,
        task: (ctx, task) => {
          const access = ctx.access
          if (!access) {
            throw new Error("cluster access is not initialized")
          }

          return task.newListr(
            [
              {
                title: "apply gateway api",
                enabled: () => shouldInstallGatewayApi,
                task: async (_, manifestTask) => {
                  const taskLogger = createTaskLogger(
                    value => {
                      manifestTask.output = value
                    },
                    "gateway api",
                    { silent: options.silent },
                  )
                  const commandLog = createTaskCommandLog(taskLogger, "kubectl")

                  await installGatewayApi(access, { commandLog })
                },
                rendererOptions: {
                  bottomBar: 6,
                },
              },
              {
                title: "apply knative serving",
                task: async (_, manifestTask) => {
                  const taskLogger = createTaskLogger(
                    value => {
                      manifestTask.output = value
                    },
                    "knative serving",
                    { silent: options.silent },
                  )
                  const commandLog = createTaskCommandLog(taskLogger, "kubectl")

                  await installKnativeServing(access, { commandLog })
                },
                rendererOptions: {
                  bottomBar: 6,
                },
              },
              {
                title: "apply dependent platform resources",
                task: (_, platformTask) => {
                  return platformTask.newListr(
                    [
                      {
                        title: "apply kourier",
                        task: async (_, manifestTask) => {
                          const taskLogger = createTaskLogger(
                            value => {
                              manifestTask.output = value
                            },
                            "kourier",
                            { silent: options.silent },
                          )
                          const commandLog = createTaskCommandLog(taskLogger, "kubectl")

                          await installKourier(access, { commandLog })
                        },
                        rendererOptions: {
                          bottomBar: 6,
                        },
                      },
                      {
                        title: "apply reside operator",
                        task: async (_, manifestTask) => {
                          const taskLogger = createTaskLogger(
                            value => {
                              manifestTask.output = value
                            },
                            "reside operator",
                            { silent: options.silent },
                          )
                          const commandLog = createTaskCommandLog(taskLogger, "kubectl")

                          await installResideOperator(access, clusterDomain, { commandLog })
                        },
                        rendererOptions: {
                          bottomBar: 6,
                        },
                      },
                    ],
                    {
                      concurrent: 4,
                      rendererOptions: {
                        collapseSubtasks: true,
                        collapseErrors: false,
                      },
                    },
                  )
                },
              },
              {
                title: "wait for knative serving",
                task: async (_, readinessTask) => {
                  const taskLogger = createTaskLogger(
                    value => {
                      readinessTask.output = value
                    },
                    "knative serving",
                    { silent: options.silent },
                  )
                  const commandLog = createTaskCommandLog(taskLogger, "kubectl")

                  await waitForKnativeServing(access, { commandLog })
                },
                rendererOptions: {
                  bottomBar: 6,
                },
              },
              {
                title: "wait for dependent platform resources",
                task: (_, platformTask) => {
                  return platformTask.newListr(
                    [
                      {
                        title: "wait for kourier",
                        task: async (_, readinessTask) => {
                          const taskLogger = createTaskLogger(
                            value => {
                              readinessTask.output = value
                            },
                            "kourier",
                            { silent: options.silent },
                          )
                          const commandLog = createTaskCommandLog(taskLogger, "kubectl")

                          await waitForKourier(access, { commandLog })
                        },
                        rendererOptions: {
                          bottomBar: 6,
                        },
                      },
                      {
                        title: "wait for reside operator",
                        task: async (_, readinessTask) => {
                          const taskLogger = createTaskLogger(
                            value => {
                              readinessTask.output = value
                            },
                            "reside operator",
                            { silent: options.silent },
                          )
                          const commandLog = createTaskCommandLog(taskLogger, "kubectl")

                          await waitForResideOperator(access, { commandLog })
                        },
                        rendererOptions: {
                          bottomBar: 6,
                        },
                      },
                    ],
                    {
                      concurrent: 4,
                      rendererOptions: {
                        collapseSubtasks: true,
                        collapseErrors: false,
                      },
                    },
                  )
                },
              },
            ],
            {
              rendererOptions: {
                collapseSubtasks: true,
                collapseErrors: false,
              },
            },
          )
        },
      },
      {
        title: "configure reside operator cluster domain",
        enabled: () => skipBase,
        task: async (ctx, task) => {
          const access = ctx.access
          if (!access) {
            throw new Error("cluster access is not initialized")
          }

          const taskLogger = createTaskLogger(
            value => {
              task.output = value
            },
            "reside operator",
            { silent: options.silent },
          )
          const commandLog = createTaskCommandLog(taskLogger, "kubectl")

          await setResideOperatorClusterDomain(access, clusterDomain, { commandLog })
        },
        rendererOptions: {
          bottomBar: 6,
        },
      },
      {
        title: "provision replicas",
        task: (ctx, task) => {
          const access = ctx.access
          if (!access) {
            throw new Error("cluster access is not initialized")
          }

          return task.newListr(
            ctx.selectedReplicas.map(replica => ({
              title: `provision ${replica.name}`,
              task: (_, replicaTask) => {
                return replicaTask.newListr(
                  [
                    {
                      title: "create replica",
                      task: (_, createTask) => {
                        return createTask.newListr(
                          [
                            {
                              title: "populate bootstrap cluster role rules",
                              task: async (_, rbacTask) => {
                                const bootstrapClusterRoleRules = replica.bootstrapClusterRoleRules

                                if (bootstrapClusterRoleRules.length === 0) {
                                  rbacTask.skip("no bootstrap cluster role rules defined")
                                  return
                                }

                                if (!(options.grantBootstrapRole ?? false)) {
                                  rbacTask.skip(
                                    "bootstrap cluster roles are disabled (pass --grant-bootstrap-role)",
                                  )
                                  return
                                }

                                const taskLogger = createTaskLogger(
                                  value => {
                                    rbacTask.output = value
                                  },
                                  `populate bootstrap cluster role rules for ${replica.name}`,
                                  { silent: options.silent },
                                )
                                const commandLog = createTaskCommandLog(taskLogger, "kubectl")

                                await upsertReplicaBootstrapClusterRole(
                                  access,
                                  replica.name,
                                  bootstrapClusterRoleRules,
                                  {
                                    commandLog,
                                  },
                                )
                              },
                              rendererOptions: {
                                bottomBar: 6,
                              },
                            },
                            {
                              title: "apply replica resource",
                              task: async (_, applyTask) => {
                                const taskLogger = createTaskLogger(
                                  value => {
                                    applyTask.output = value
                                  },
                                  `apply replica ${replica.name}`,
                                  { silent: options.silent },
                                )
                                const commandLog = createTaskCommandLog(taskLogger, "kubectl")

                                await applyReplica(access, replica, { commandLog })
                              },
                              rendererOptions: {
                                bottomBar: 6,
                              },
                            },
                            {
                              title: "wait for ready condition",
                              task: async (_, readyTask) => {
                                const reset = await resetFailedBootstrapJob(access, replica.name)
                                if (reset) {
                                  readyTask.output =
                                    "deleted stale failed bootstrap job before waiting"
                                }

                                try {
                                  await waitForReplicaReady(access, replica.name)
                                } catch (error) {
                                  const replicaNamespace = getReplicaNamespace(replica.name)
                                  const bootstrapJobName = `${replica.name}-bootstrap`

                                  await writeFailureDump(replica.name, async writeLine => {
                                    await writeLine("failure diagnostics begin")

                                    try {
                                      const bootstrapPodName = await waitForJobPod(
                                        access,
                                        replicaNamespace,
                                        bootstrapJobName,
                                      )

                                      await dumpJobFailureDiagnostics(
                                        access,
                                        replicaNamespace,
                                        bootstrapPodName,
                                        bootstrapJobName,
                                        "bootstrap",
                                        async line => {
                                          await writeLine(line)
                                        },
                                      )
                                    } catch (diagnosticsError) {
                                      const message =
                                        diagnosticsError instanceof Error
                                          ? diagnosticsError.message
                                          : String(diagnosticsError)

                                      await writeLine(
                                        `failed to collect bootstrap diagnostics: ${message}`,
                                      )
                                    }

                                    await writeLine("failure diagnostics end")
                                  })

                                  throw error
                                }
                              },
                              rendererOptions: {
                                bottomBar: 3,
                              },
                            },
                          ],
                          {
                            rendererOptions: {
                              collapseSubtasks: true,
                              collapseErrors: false,
                            },
                          },
                        )
                      },
                    },
                    {
                      title: "populate namespace resources",
                      task: async (_, resourcesTask) => {
                        const replicaNamespace = getReplicaNamespace(replica.name)
                        const waitLogger = createTaskLogger(
                          value => {
                            resourcesTask.output = value
                          },
                          `wait for namespace ${replica.name}`,
                          { silent: options.silent },
                        )
                        const waitCommandLog = createTaskCommandLog(waitLogger, "kubectl")

                        await waitForReplicaNamespace(access, replica.name)
                        waitCommandLog.onLine(`namespace ready: ${replicaNamespace}`)

                        return resourcesTask.newListr(
                          [
                            {
                              title: "populate namespaced resources",
                              task: (_, namespacedTask) => {
                                return namespacedTask.newListr(
                                  [
                                    {
                                      title: "populate secrets",
                                      task: async (_, secretTask) => {
                                        const secrets = getReplicaSecrets(replica)

                                        if (secrets.length === 0) {
                                          secretTask.skip("no secrets defined")
                                          return
                                        }

                                        const taskLogger = createTaskLogger(
                                          value => {
                                            secretTask.output = value
                                          },
                                          `populate secrets for ${replica.name}`,
                                          { silent: options.silent },
                                        )
                                        const commandLog = createTaskCommandLog(
                                          taskLogger,
                                          "kubectl",
                                        )
                                        const promptMissingVariable =
                                          createMissingVariablePrompt(secretTask)

                                        for (const secret of secrets) {
                                          const existingData = await getSecretData(
                                            access,
                                            replicaNamespace,
                                            secret.name,
                                          )
                                          const promptFieldOverride = createFieldOverridePrompt(
                                            secretTask,
                                            "secret",
                                            secret.name,
                                          )
                                          const promptFieldValue = createFieldValuePrompt(
                                            secretTask,
                                            "secret",
                                            secret.name,
                                          )
                                          const resolvedSecret = await resolveResourceData({
                                            askForOverrides: options.ask ?? false,
                                            existingData,
                                            promptFieldOverride,
                                            promptFieldValue,
                                            resolveVariable: variableName => {
                                              return resolveVariable(
                                                variableName,
                                                promptMissingVariable,
                                              )
                                            },
                                            templateData: secret.data,
                                          })

                                          if (!resolvedSecret.shouldApply) {
                                            taskLogger.info(
                                              'skip secret "%s": all values already defined',
                                              secret.name,
                                            )
                                            continue
                                          }

                                          await upsertSecret(
                                            access,
                                            replicaNamespace,
                                            {
                                              ...secret,
                                              data: resolvedSecret.data,
                                            },
                                            { commandLog },
                                          )
                                        }
                                      },
                                      rendererOptions: {
                                        bottomBar: 6,
                                      },
                                    },
                                    {
                                      title: "populate config maps",
                                      task: async (_, configTask) => {
                                        const configMaps = getReplicaConfigMaps(replica)

                                        if (configMaps.length === 0) {
                                          configTask.skip("no config maps defined")
                                          return
                                        }

                                        const taskLogger = createTaskLogger(
                                          value => {
                                            configTask.output = value
                                          },
                                          `populate config maps for ${replica.name}`,
                                          { silent: options.silent },
                                        )
                                        const commandLog = createTaskCommandLog(
                                          taskLogger,
                                          "kubectl",
                                        )
                                        const promptMissingVariable =
                                          createMissingVariablePrompt(configTask)

                                        for (const configMap of configMaps) {
                                          const existingData = await getConfigMapData(
                                            access,
                                            replicaNamespace,
                                            configMap.name,
                                          )
                                          const promptFieldOverride = createFieldOverridePrompt(
                                            configTask,
                                            "config map",
                                            configMap.name,
                                          )
                                          const promptFieldValue = createFieldValuePrompt(
                                            configTask,
                                            "config map",
                                            configMap.name,
                                          )
                                          const resolvedConfigMap = await resolveResourceData({
                                            askForOverrides: options.ask ?? false,
                                            existingData,
                                            promptFieldOverride,
                                            promptFieldValue,
                                            resolveVariable: variableName => {
                                              return resolveVariable(
                                                variableName,
                                                promptMissingVariable,
                                              )
                                            },
                                            templateData: configMap.data,
                                          })

                                          if (!resolvedConfigMap.shouldApply) {
                                            taskLogger.info(
                                              'skip config map "%s": all values already defined',
                                              configMap.name,
                                            )
                                            continue
                                          }

                                          await upsertConfigMap(
                                            access,
                                            replicaNamespace,
                                            {
                                              ...configMap,
                                              data: resolvedConfigMap.data,
                                            },
                                            { commandLog },
                                          )
                                        }
                                      },
                                      rendererOptions: {
                                        bottomBar: 6,
                                      },
                                    },
                                  ],
                                  {
                                    rendererOptions: {
                                      collapseSubtasks: true,
                                      collapseErrors: false,
                                    },
                                  },
                                )
                              },
                            },
                            {
                              title: "populate cluster role rules",
                              task: async (_, rbacTask) => {
                                const clusterRoleRules = replica.clusterRoleRules

                                if (clusterRoleRules.length === 0) {
                                  rbacTask.skip("no cluster role rules defined")
                                  return
                                }

                                const taskLogger = createTaskLogger(
                                  value => {
                                    rbacTask.output = value
                                  },
                                  `populate cluster role rules for ${replica.name}`,
                                  { silent: options.silent },
                                )
                                const commandLog = createTaskCommandLog(taskLogger, "kubectl")

                                await upsertReplicaClusterRole(
                                  access,
                                  replica.name,
                                  clusterRoleRules,
                                  {
                                    commandLog,
                                  },
                                )
                              },
                              rendererOptions: {
                                bottomBar: 6,
                              },
                            },
                          ],
                          {
                            rendererOptions: {
                              collapseSubtasks: true,
                              collapseErrors: false,
                            },
                          },
                        )
                      },
                    },
                  ],
                  {
                    concurrent: 2,
                    exitOnError: true,
                    rendererOptions: {
                      collapseSubtasks: true,
                      collapseErrors: false,
                    },
                  },
                )
              },
            })),
            {
              rendererOptions: {
                collapseSubtasks: true,
                collapseErrors: false,
              },
            },
          )
        },
      },
      {
        title: "run replica e2e jobs",
        enabled: () => options.runE2E,
        task: (ctx, task) => {
          const access = ctx.access
          if (!access) {
            throw new Error("cluster access is not initialized")
          }

          return task.newListr(
            ctx.selectedReplicas.map(replica => ({
              title: `run e2e for ${replica.name}`,
              task: async (_, e2eTask) => {
                const taskLogger = createTaskLogger(
                  value => {
                    e2eTask.output = value
                  },
                  `run e2e for ${replica.name}`,
                  { silent: options.silent },
                )
                const podLogLogger = createChildLogger(taskLogger, `[${replica.name}] `)
                const replicaNamespace = getReplicaNamespace(replica.name)
                const jobName = await recreateE2EJob(access, replica, clusterDomain)
                const podName = await waitForJobPod(access, replicaNamespace, jobName)

                const logPromise = streamPodLogs(
                  access,
                  replicaNamespace,
                  podName,
                  "e2e",
                  "",
                  line => {
                    podLogLogger.info(line)
                  },
                )

                try {
                  await waitForJobCompletion(access, replicaNamespace, jobName)
                } catch (error) {
                  await writeFailureDump(replica.name, async writeLine => {
                    await writeLine("failure diagnostics begin")

                    await dumpJobFailureDiagnostics(
                      access,
                      replicaNamespace,
                      podName,
                      jobName,
                      "e2e",
                      async line => {
                        await writeLine(line)
                      },
                    )

                    await writeLine("failure diagnostics end")
                  })

                  throw error
                } finally {
                  await logPromise.catch(() => undefined)
                }
              },
              rendererOptions: {
                bottomBar: 6,
                persistentOutput: false,
              },
            })),
            {
              concurrent: 4,
              rendererOptions: {
                collapseSubtasks: true,
                collapseErrors: false,
              },
            },
          )
        },
      },
      {
        title: "cleanup bootstrap cluster roles",
        task: (ctx, task) => {
          const access = ctx.access
          if (!access) {
            throw new Error("cluster access is not initialized")
          }

          const replicasWithBootstrapRoles = ctx.allReplicas.filter(
            replica => replica.bootstrapClusterRoleRules.length > 0,
          )

          if (replicasWithBootstrapRoles.length === 0) {
            task.skip("no bootstrap cluster roles defined")
            return
          }

          return task.newListr(
            replicasWithBootstrapRoles.map(replica => ({
              title: `cleanup bootstrap cluster role for ${replica.name}`,
              task: async (_, cleanupTask) => {
                const taskLogger = createTaskLogger(
                  value => {
                    cleanupTask.output = value
                  },
                  `cleanup bootstrap cluster role for ${replica.name}`,
                  { silent: options.silent },
                )
                const commandLog = createTaskCommandLog(taskLogger, "kubectl")

                await deleteReplicaBootstrapClusterRole(access, replica.name, {
                  commandLog,
                })
              },
              rendererOptions: {
                bottomBar: 6,
              },
            })),
            {
              concurrent: 4,
              rendererOptions: {
                collapseSubtasks: true,
                collapseErrors: false,
              },
            },
          )
        },
      },
    ],
    {
      fallbackRenderer: "simple",
      renderer: options.textOutput ? "simple" : "default",
      rendererOptions: {
        collapseSubtasks: true,
        collapseErrors: false,
        showSubtasks: true,
        clearOutput: false,
      },
    },
  )

  await tasks.run({
    allReplicas: [],
    selectedReplicas: [],
    topologyPath: "",
  })
}
