import { test } from "bun:test"
import { resolve } from "node:path"
import { runCommand } from "@reside/shared"

const clusterName = "reside-seed-e2e"

test(
  "successfully initializes Reside cluster",
  async () => {
    // build and push seed image
    await runCommand(["reside", "build", "--tag", "e2e", "--push"], {
      cwd: resolve(import.meta.dir, ".."),
    })

    console.log("[+] built and pushed seed image")

    // create kind cluster
    await runCommand(["kind", "delete", "cluster", "--name", clusterName])
    await runCommand(["kind", "create", "cluster", "--name", clusterName])

    console.log("[+] created kind cluster")

    // create reside namespace
    await runCommand([
      "kubectl",
      "--context",
      `kind-${clusterName}`,
      "create",
      "namespace",
      "reside",
    ])

    console.log("[+] created reside namespace")

    // apply seed manifests
    await runCommand([
      "kubectl",
      "--context",
      `kind-${clusterName}`,
      "apply",
      "-n",
      "reside",
      "-f",
      resolve(import.meta.dir, "../manifests/seed.e2e.yaml"),
    ])

    console.log("[+] applied seed manifests")

    while (true) {
      console.log("[+] waiting for seed pod to start...")

      await Bun.sleep(2_000)

      const phaseProc = Bun.spawn(
        [
          "kubectl",
          "--context",
          `kind-${clusterName}`,
          "get",
          "-n",
          "reside",
          "pod",
          "-l",
          "reside.io/replica=seed",
          "-o",
          "jsonpath={.items[0].status.phase}",
        ],
        { stderr: "pipe" },
      )

      const exitCode = await phaseProc.exited
      if (exitCode !== 0) {
        const errOutput = await phaseProc.stderr!.text()
        console.log(`[!] failed to get seed pod phase: ${errOutput.trim()}`)
        continue
      }

      const phaseOutput = await phaseProc.stdout!.text()
      const phase = phaseOutput.trim()

      if (phase === "Running") {
        break
      }

      if (phase === "Failed") {
        throw new Error("Pod phase is Failed")
      }

      if (phase) {
        console.log(`[+] seed pod phase: ${phase}`)
      }
    }

    // attach to seed logs and wait for initialization to complete
    await runCommand([
      "kubectl",
      "--context",
      `kind-${clusterName}`,
      "logs",
      "-n",
      "reside",
      "job/seed-1",
      "--follow",
    ])

    await Bun.sleep(4_000)

    // validate that the seed job completed successfully
    const statusProc = Bun.spawn([
      "kubectl",
      "--context",
      `kind-${clusterName}`,
      "get",
      "-n",
      "reside",
      "job",
      "seed-1",
      "-o",
      "jsonpath={.status.succeeded}",
    ])

    const exitCode = await statusProc.exited
    if (exitCode !== 0) {
      throw new Error("Failed to get seed job status")
    }

    const statusOutput = await statusProc.stdout!.text()
    const succeeded = statusOutput.trim()

    if (succeeded !== "1") {
      throw new Error(`Seed job did not complete successfully, succeeded=${succeeded}`)
    }

    console.log("[+] seed pod has completed")

    // cleanup
    // await runCommand(["kind", "delete", "cluster", "--name", clusterName])
  },
  { timeout: 300_000 },
)
