import { test } from "bun:test"
import { resolve } from "node:path"

const runOperatorE2E = process.env.RUN_OPERATOR_E2E === "1"

type CommandOptions = {
  cwd?: string
  env?: NodeJS.ProcessEnv
  input?: string
  ignoreExitCode?: boolean
  mirror?: boolean
}

async function runCommand(command: string[], options: CommandOptions = {}): Promise<string> {
  const consume = async (
    stream: ReadableStream<Uint8Array> | null,
    mirrorOutput: ((text: string) => void) | undefined,
  ): Promise<string> => {
    if (!stream) {
      return ""
    }

    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let output = ""

    while (true) {
      const chunk = await reader.read()
      if (chunk.done) {
        break
      }

      const text = decoder.decode(chunk.value, { stream: true })
      output += text

      if (options.mirror && mirrorOutput) {
        mirrorOutput(text)
      }
    }

    const finalText = decoder.decode()
    output += finalText

    if (options.mirror && mirrorOutput && finalText.length > 0) {
      mirrorOutput(finalText)
    }

    return output
  }

  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    env: options.env,
    stdin: options.input ? "pipe" : undefined,
    stdout: "pipe",
    stderr: "pipe",
  })

  if (options.input && proc.stdin) {
    await proc.stdin.write(options.input)
    await proc.stdin.end()
  }

  const stdoutPromise = consume(proc.stdout, text => {
    process.stdout.write(text)
  })
  const stderrPromise = consume(proc.stderr, text => {
    process.stderr.write(text)
  })

  const exitCode = await proc.exited
  const stdout = await stdoutPromise
  const stderr = await stderrPromise

  if (exitCode !== 0 && !options.ignoreExitCode) {
    throw new Error(
      `command failed: ${command.join(" ")}\nexit code: ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    )
  }

  return stdout
}

async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs: number,
  message: string,
): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) {
      return
    }

    await Bun.sleep(1_000)
  }

  throw new Error(message)
}

const e2eTest = runOperatorE2E ? test : test.skip

function getReplicaNamespace(replicaName: string): string {
  return `replica-${replicaName}`
}

e2eTest(
  "reconciles replica resources on kind cluster",
  async () => {
    console.info("starting operator e2e test")

    const clusterName = "reside-operator-e2e"
    const systemNamespace = "reside-system"
    const replicaName = "alpha-e2e"
    const replicaNamespace = getReplicaNamespace(replicaName)
    const orphanNamespace = "replica-orphan-e2e"
    const operatorImage = "reside-operator:e2e"
    const context = `kind-${clusterName}`

    try {
      await runCommand(["kind", "delete", "cluster", "--name", clusterName], {
        ignoreExitCode: true,
        mirror: true,
      })

      console.info(`creating kind cluster with name "${clusterName}"`)
      await runCommand(["kind", "create", "cluster", "--name", clusterName], {
        mirror: true,
      })

      console.info(`building local operator image "${operatorImage}"`)
      await runCommand(
        [
          "docker",
          "build",
          "-t",
          operatorImage,
          "-f",
          resolve(import.meta.dir, "../Dockerfile"),
          resolve(import.meta.dir, "../../.."),
        ],
        { mirror: true },
      )

      console.info(`loading local operator image "${operatorImage}" into kind cluster`)
      await runCommand(["kind", "load", "docker-image", operatorImage, "--name", clusterName], {
        mirror: true,
      })

      await runCommand(["kubectl", "--context", context, "create", "namespace", systemNamespace], {
        mirror: true,
      })

      await runCommand(["kubectl", "--context", context, "create", "namespace", orphanNamespace], {
        mirror: true,
      })

      await runCommand(
        [
          "kubectl",
          "--context",
          context,
          "apply",
          "-f",
          resolve(import.meta.dir, "../assets/reside-operator-crds.yaml"),
        ],
        { mirror: true },
      )

      await runCommand(
        [
          "kubectl",
          "--context",
          context,
          "apply",
          "-f",
          resolve(import.meta.dir, "../assets/reside-operator.yaml"),
        ],
        { mirror: true },
      )

      await runCommand(
        [
          "kubectl",
          "--context",
          context,
          "-n",
          systemNamespace,
          "set",
          "image",
          "deployment/reside-operator",
          `operator=${operatorImage}`,
        ],
        { mirror: true },
      )

      await waitFor(
        async () => {
          const output = await runCommand(
            ["kubectl", "--context", context, "get", "namespace", orphanNamespace, "-o", "name"],
            { ignoreExitCode: true },
          )

          return output.trim() !== `namespace/${orphanNamespace}`
        },
        30_000,
        "orphan replica namespace was not deleted",
      )

      await runCommand(
        [
          "kubectl",
          "--context",
          context,
          "-n",
          systemNamespace,
          "rollout",
          "status",
          "deployment/reside-operator",
          "--timeout=180s",
        ],
        { mirror: true },
      )

      const createReplicaManifest = (image: string, endpoints?: Record<string, string>) => {
        const endpointsYaml = Object.entries(endpoints ?? {})
          .map(([name, endpoint]) => `    ${name}: ${endpoint}`)
          .join("\n")

        const endpointsBlock = endpointsYaml.length > 0 ? `\n  endpoints:\n${endpointsYaml}` : ""

        return `apiVersion: reside.io/v1
kind: Replica
metadata:
  name: ${replicaName}
spec:
  image: ${image}${endpointsBlock}
`
      }

      await runCommand(["kubectl", "--context", context, "apply", "-f", "-"], {
        input: createReplicaManifest("busybox:1.36.1", {
          database: "database.database.svc.cluster.local",
        }),
        mirror: true,
      })

      await waitFor(
        async () => {
          const output = await runCommand(
            ["kubectl", "--context", context, "get", "namespace", replicaNamespace, "-o", "name"],
            { ignoreExitCode: true },
          )

          return output.trim() === `namespace/${replicaNamespace}`
        },
        30_000,
        "replica namespace was not created",
      )

      await waitFor(
        async () => {
          const output = await runCommand(
            [
              "kubectl",
              "--context",
              context,
              "-n",
              replicaNamespace,
              "get",
              "serviceaccount",
              replicaName,
              "-o",
              "name",
            ],
            { ignoreExitCode: true },
          )

          return output.trim() === `serviceaccount/${replicaName}`
        },
        30_000,
        "replica serviceaccount was not created",
      )

      await waitFor(
        async () => {
          const output = await runCommand(
            [
              "kubectl",
              "--context",
              context,
              "-n",
              replicaNamespace,
              "get",
              "rolebinding",
              `${replicaName}-admin`,
              "-o",
              "name",
            ],
            { ignoreExitCode: true },
          )

          return output.trim() === `rolebinding.rbac.authorization.k8s.io/${replicaName}-admin`
        },
        30_000,
        "replica rolebinding was not created",
      )

      await waitFor(
        async () => {
          const output = await runCommand(
            [
              "kubectl",
              "--context",
              context,
              "-n",
              replicaNamespace,
              "get",
              "service",
              "database",
              "-o",
              "jsonpath={.spec.type}:{.spec.externalName}",
            ],
            { ignoreExitCode: true },
          )

          return output.trim() === "ExternalName:database.database.svc.cluster.local"
        },
        30_000,
        "externalname service was not created",
      )

      await waitFor(
        async () => {
          const output = await runCommand(
            [
              "kubectl",
              "--context",
              context,
              "-n",
              replicaNamespace,
              "get",
              "job",
              `${replicaName}-bootstrap`,
              "-o",
              "jsonpath={.spec.template.spec.containers[0].image}:{.spec.template.spec.containers[0].imagePullPolicy}",
            ],
            { ignoreExitCode: true },
          )

          return output.trim() === "busybox:1.36.1:Always"
        },
        30_000,
        "bootstrap job with initial image was not created",
      )

      await waitFor(
        async () => {
          const output = await runCommand(
            [
              "kubectl",
              "--context",
              context,
              "get",
              "replica",
              replicaName,
              "-o",
              'jsonpath={.status.phase}:{.status.observedGeneration}:{.status.conditions[?(@.type=="Ready")].status}',
            ],
            { ignoreExitCode: true },
          )

          return output.trim() === "Ready:1:True"
        },
        30_000,
        "replica status was not populated after initial reconcile",
      )

      await runCommand(["kubectl", "--context", context, "apply", "-f", "-"], {
        input: createReplicaManifest("busybox:1.37.0", {
          database: "database.database.svc.cluster.local",
        }),
        mirror: true,
      })

      await waitFor(
        async () => {
          const output = await runCommand(
            [
              "kubectl",
              "--context",
              context,
              "-n",
              replicaNamespace,
              "get",
              "job",
              `${replicaName}-bootstrap`,
              "-o",
              "jsonpath={.spec.template.spec.containers[0].image}:{.spec.template.spec.containers[0].imagePullPolicy}",
            ],
            { ignoreExitCode: true },
          )

          return output.trim() === "busybox:1.37.0:Always"
        },
        120_000,
        "bootstrap job was not updated after replica image change",
      )

      await waitFor(
        async () => {
          const output = await runCommand(
            [
              "kubectl",
              "--context",
              context,
              "get",
              "replica",
              replicaName,
              "-o",
              'jsonpath={.status.phase}:{.status.observedGeneration}:{.status.conditions[?(@.type=="Ready")].status}',
            ],
            { ignoreExitCode: true },
          )

          return output.trim() === "Ready:2:True"
        },
        30_000,
        "replica status was not updated after image change",
      )

      await runCommand(["kubectl", "--context", context, "apply", "-f", "-"], {
        input: createReplicaManifest("busybox:1.37.0"),
        mirror: true,
      })

      await waitFor(
        async () => {
          const output = await runCommand(
            [
              "kubectl",
              "--context",
              context,
              "-n",
              replicaNamespace,
              "get",
              "service",
              "database",
              "-o",
              "name",
            ],
            { ignoreExitCode: true },
          )

          return output.trim() === ""
        },
        30_000,
        "stale externalname service was not deleted after endpoint removal",
      )

      await runCommand(["kubectl", "--context", context, "describe", "replica", replicaName], {
        mirror: true,
      })
    } finally {
      await runCommand(["kind", "delete", "cluster", "--name", clusterName], {
        ignoreExitCode: true,
        mirror: true,
      })
    }
  },
  { timeout: 240_000 },
)
