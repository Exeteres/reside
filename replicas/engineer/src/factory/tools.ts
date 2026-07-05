import type { PermissionRequestServiceClient } from "@reside/api/access/request.v1"
import type { LoadServiceClient } from "@reside/api/alpha/load.v1"
import type { OperationServiceClient } from "@reside/api/common/operation.v1"
import type {
  PostgresDatabaseCredentials,
  ProvisionServiceClient,
} from "@reside/api/infra/provision.v1"
import type { GitHubService } from "../replica/business"
import { waitForOperationSuccess, waitForResult } from "@reside/api"
import { defineTool, link, logger, parseResideManifest, RESIDE_MANIFEST_FILE } from "@reside/common"
import { WellKnownPermissions } from "@reside/registry"
import { z } from "zod"
import {
  extractFailureMessageFromLog,
  extractWorkflowRunId,
  hasIssueClosingTagAtBodyEnd,
  validateBranchCommitLogOutput,
  validatePullRequestTitle,
} from "../replica/business"

const workingDirSchema = z.string().min(1)

export function createDevDatabaseTool({
  provisionService,
  infraOperationService,
}: {
  provisionService: ProvisionServiceClient
  infraOperationService: OperationServiceClient
}) {
  return defineTool("reside_create_dev_database", {
    description:
      "Creates a temporary PostgreSQL development database that is automatically deleted after 24 hours",
    parameters: z.object({}),
    handler: async () => {
      logger.info("engineer create_dev_database started")

      const response = await provisionService.createTemporaryPostgresDatabase({})

      if (!response.credentials || response.credentials.case === undefined) {
        throw new Error("Infra did not return temporary database credentials")
      }

      const credentials = await waitForResult<PostgresDatabaseCredentials>(response.credentials, {
        operationService: infraOperationService,
      })
      const databaseUrl = buildTemporaryDatabaseUrl(credentials)

      logger.info(
        'engineer create_dev_database completed host="%s" database="%s"',
        credentials.host,
        credentials.database,
      )

      return [
        "Temporary PostgreSQL database created.",
        "It will be deleted automatically after 24 hours.",
        "If this session is resumed after a long time and the database no longer exists, call reside_create_dev_database again.",
        `host=${credentials.host}`,
        `port=${credentials.port}`,
        `database=${credentials.database}`,
        `username=${credentials.username}`,
        `password=${credentials.password}`,
        `DATABASE_URL=${databaseUrl}`,
      ].join("\n")
    },
  })
}

export function createDeployReplicaTool({
  github,
  permissionRequestService,
  accessOperationService,
  loadService,
  alphaOperationService,
  owner,
  repo,
  issueNumber,
}: {
  github: GitHubService
  permissionRequestService: PermissionRequestServiceClient
  accessOperationService: OperationServiceClient
  loadService: LoadServiceClient
  alphaOperationService: OperationServiceClient
  owner: string
  repo: string
  issueNumber?: number
}) {
  return defineTool("reside_deploy_replica", {
    description:
      "Builds and pushes replica image via workflow dispatch from main, waits for completion, then loads replica through alpha",
    parameters: z.object({
      replicaName: z.string().min(1),
      workingDir: workingDirSchema,
    }),
    handler: async ({ replicaName, workingDir }) => {
      const targetBranchName = await getCurrentGitBranch(workingDir)

      logger.info(
        'engineer deploy_replica started replica="%s" branch="%s"',
        replicaName,
        targetBranchName,
      )

      const octokit = await github.getOctokit()
      const startedAt = new Date()

      const mergedPullRequest = await getMergedPullRequestForBranch({
        octokit,
        owner,
        repo,
        branchName: targetBranchName,
      })

      if (mergedPullRequest) {
        if (mergedPullRequest.title.trim().length === 0) {
          throw new Error(
            `Merged pull request for branch "${targetBranchName}" has empty title. Use a descriptive PR title and retry.`,
          )
        }

        if (issueNumber && !hasIssueClosingTagAtBodyEnd(mergedPullRequest.body, issueNumber)) {
          throw new Error(
            `Merged pull request #${mergedPullRequest.number} must end body with "Closes #${issueNumber}".`,
          )
        }
      } else {
        logger.info(
          'engineer deploy_replica proceeding without merged PR replica="%s" branch="%s"',
          replicaName,
          targetBranchName,
        )
      }

      await octokit.rest.actions.createWorkflowDispatch({
        owner,
        repo,
        workflow_id: "build-replica.yml",
        ref: "main",
        inputs: {
          replica_name: replicaName,
        },
      })

      const run = await waitForWorkflowRun({
        octokit,
        owner,
        repo,
        startedAt,
      })
      if (run.conclusion !== "success") {
        throw new Error(
          `Replica build workflow failed with conclusion "${run.conclusion}" (run: ${run.url}).`,
        )
      }

      const manifest = await loadReplicaManifestFromRepository({
        octokit,
        owner,
        repo,
        replicaName,
      })

      await requestReplicaLoadPermission({
        permissionRequestService,
        accessOperationService,
        replicaName,
        issueUrl: issueNumber
          ? `https://github.com/${owner}/${repo}/issues/${issueNumber}`
          : undefined,
      })

      const loadReplicaResponse = await loadService.loadReplica({
        name: replicaName,
        image: `${manifest.image}:${manifest.version}`,
      })

      if (!loadReplicaResponse.operation) {
        throw new Error("Alpha load operation was not returned")
      }

      await waitForOperationSuccess(loadReplicaResponse.operation, {
        operationService: alphaOperationService,
      })

      logger.info(
        'engineer deploy_replica completed replica="%s" branch="%s"',
        replicaName,
        targetBranchName,
      )

      return `Replica ${replicaName} deployed successfully`
    },
  })
}

export function createDeliverChangesTool({
  github,
  owner,
  repo,
  issueNumber,
  refreshRepository,
}: {
  github: GitHubService
  owner: string
  repo: string
  issueNumber?: number
  refreshRepository?: () => Promise<void>
}) {
  return defineTool("reside_deliver_changes", {
    description:
      "Validates commits, pushes current branch, creates or updates pull request, waits for ci:check, merges it with rebase, and deletes source branch",
    parameters: z.object({
      title: z.string().min(1),
      body: z.string().min(1),
      workingDir: workingDirSchema,
    }),
    handler: async ({ title, body, workingDir }) => {
      const targetBranchName = await getCurrentGitBranch(workingDir)

      logger.info(
        'engineer deliver_changes started branch="%s" title="%s"',
        targetBranchName,
        truncateOneLine(title, 160),
      )

      const octokit = await github.getOctokit()
      validatePullRequestTitle(title)

      if (issueNumber && !hasIssueClosingTagAtBodyEnd(body, issueNumber)) {
        throw new Error(`Pull request body must end with "Closes #${issueNumber}".`)
      }

      await validateBranchCommitMessages(workingDir, targetBranchName)

      await runCommand([
        "git",
        "-C",
        workingDir,
        "push",
        "--set-upstream",
        "origin",
        targetBranchName,
      ])

      const existingPullRequests = await octokit.rest.pulls.list({
        owner,
        repo,
        state: "open",
        head: `${owner}:${targetBranchName}`,
      })

      const existingPullRequest = existingPullRequests.data[0]
      const pullRequest = existingPullRequest
        ? (
            await octokit.rest.pulls.update({
              owner,
              repo,
              pull_number: existingPullRequest.number,
              title,
              body,
            })
          ).data
        : (
            await octokit.rest.pulls.create({
              owner,
              repo,
              base: "main",
              head: targetBranchName,
              title,
              body,
            })
          ).data

      const ciCheckResult = await waitForPullRequestCiCheck({
        octokit,
        owner,
        repo,
        pullRequestNumber: pullRequest.number,
      })

      if (ciCheckResult.status !== "success") {
        throw new Error(`PR check ci:check failed: ${ciCheckResult.failureMessage}`)
      }

      await octokit.rest.pulls.merge({
        owner,
        repo,
        pull_number: pullRequest.number,
        merge_method: "rebase",
      })

      await octokit.rest.git
        .deleteRef({
          owner,
          repo,
          ref: `heads/${targetBranchName}`,
        })
        .catch(() => undefined)
      await refreshRepository?.()

      logger.info(
        'engineer deliver_changes completed branch="%s" pr_number="%s"',
        targetBranchName,
        String(pullRequest.number),
      )

      return `Pull request #${pullRequest.number} merged: ${pullRequest.html_url}`
    },
  })
}

export function createCommitChangesTool() {
  return defineTool("reside_commit_changes", {
    description:
      "Stages repository paths and creates a validated conventional commit without a commit body",
    parameters: z.object({
      message: z.string().min(1),
      paths: z.array(z.string().min(1)).min(1).default(["."]),
      workingDir: workingDirSchema,
    }),
    handler: async ({ message, paths, workingDir }) => {
      const targetBranchName = await getCurrentGitBranch(workingDir)

      logger.info(
        'engineer commit_changes started branch="%s" message="%s" paths_count="%s"',
        targetBranchName,
        truncateOneLine(message, 160),
        String(paths.length),
      )

      validateBranchCommitLogOutput(`0000000000000000000000000000000000000000\0${message}\0\0`)

      await runCommand(["git", "-C", workingDir, "add", "--", ...paths])
      await runCommand(["git", "-C", workingDir, "commit", "-m", message])
      await validateBranchCommitMessages(workingDir, targetBranchName)

      const { stdout } = await runCommandWithOutput([
        "git",
        "-C",
        workingDir,
        "rev-parse",
        "--short",
        "HEAD",
      ])
      const commitHash = stdout.trim()

      logger.info(
        'engineer commit_changes completed branch="%s" commit="%s"',
        targetBranchName,
        commitHash,
      )

      return `Created validated commit ${commitHash}.`
    },
  })
}

function buildTemporaryDatabaseUrl(credentials: PostgresDatabaseCredentials): string {
  const connectionUrl = new URL("postgresql://placeholder")
  connectionUrl.hostname = credentials.host
  connectionUrl.port = String(credentials.port)
  connectionUrl.username = credentials.username
  connectionUrl.password = credentials.password
  connectionUrl.pathname = `/${credentials.database}`

  return connectionUrl.toString()
}

async function requestReplicaLoadPermission(input: {
  permissionRequestService: PermissionRequestServiceClient
  accessOperationService: OperationServiceClient
  replicaName: string
  issueUrl?: string
}): Promise<void> {
  const permissionSetName = `engineer:deploy:${input.replicaName}`
  const reason = input.issueUrl
    ? `Для деплоя реплики ${input.replicaName} в рамках ${link("задачи", input.issueUrl).html}.`
    : `Для деплоя реплики ${input.replicaName} в рамках задачи.`

  const response = await input.permissionRequestService.requestPermissions({
    reason,
    permissionSetName,
    items: [
      {
        permissionName: WellKnownPermissions.ALPHA_REPLICA_LOAD,
        scope: input.replicaName,
      },
    ],
  })

  if (!response.operation) {
    return
  }

  await waitForOperationSuccess(response.operation, {
    operationService: input.accessOperationService,
  })
}

async function waitForWorkflowRun(input: {
  octokit: Awaited<ReturnType<GitHubService["getOctokit"]>>
  owner: string
  repo: string
  startedAt: Date
}): Promise<{ conclusion: string | null; url: string }> {
  const minCreatedAt = input.startedAt.getTime() - 15_000

  for (let attempt = 0; attempt < 180; attempt += 1) {
    const runs = await input.octokit.rest.actions.listWorkflowRuns({
      owner: input.owner,
      repo: input.repo,
      workflow_id: "build-replica.yml",
      branch: "main",
      event: "workflow_dispatch",
      per_page: 10,
    })

    const run = runs.data.workflow_runs.find(
      candidate => new Date(candidate.created_at).getTime() >= minCreatedAt,
    )

    if (!run) {
      await sleep(2000)
      continue
    }

    if (run.status !== "completed") {
      await sleep(5000)
      continue
    }

    return {
      conclusion: run.conclusion,
      url: run.html_url,
    }
  }

  throw new Error("Timed out waiting for build-replica workflow completion")
}

async function loadReplicaManifestFromRepository(input: {
  octokit: Awaited<ReturnType<GitHubService["getOctokit"]>>
  owner: string
  repo: string
  replicaName: string
}) {
  const manifestPath = `replicas/${input.replicaName}/${RESIDE_MANIFEST_FILE}`
  const response = await input.octokit.rest.repos.getContent({
    owner: input.owner,
    repo: input.repo,
    path: manifestPath,
    ref: "main",
  })

  if (Array.isArray(response.data) || response.data.type !== "file") {
    throw new Error(`Replica manifest "${manifestPath}" on main is not a file`)
  }

  if (typeof response.data.content !== "string") {
    throw new Error(`Replica manifest "${manifestPath}" on main has no file content`)
  }

  const content = Buffer.from(response.data.content, "base64").toString("utf8")
  const manifest = parseResideManifest(content)
  if (!manifest) {
    throw new Error(`Replica manifest "${manifestPath}" on main must define image and version`)
  }

  return manifest
}

async function waitForPullRequestCiCheck(input: {
  octokit: Awaited<ReturnType<GitHubService["getOctokit"]>>
  owner: string
  repo: string
  pullRequestNumber: number
}): Promise<{ status: "success" } | { status: "failed"; failureMessage: string }> {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const pullRequest = await input.octokit.rest.pulls.get({
      owner: input.owner,
      repo: input.repo,
      pull_number: input.pullRequestNumber,
    })

    const checkRunsResponse = await input.octokit.rest.checks.listForRef({
      owner: input.owner,
      repo: input.repo,
      ref: pullRequest.data.head.sha,
      filter: "latest",
      per_page: 100,
    })

    const ciCheckRun = checkRunsResponse.data.check_runs.find(checkRun => {
      const checkRunName = checkRun.name.toLowerCase()
      return checkRunName === "ci:check" || checkRunName.includes("ci:check")
    })

    if (!ciCheckRun) {
      await sleep(2000)
      continue
    }

    if (ciCheckRun.status !== "completed") {
      await sleep(5000)
      continue
    }

    if (ciCheckRun.conclusion === "success") {
      return { status: "success" }
    }

    const failureMessage = await getCiCheckFailureMessage({
      octokit: input.octokit,
      owner: input.owner,
      repo: input.repo,
      checkRunDetailsUrl: ciCheckRun.details_url ?? "",
      checkRunName: ciCheckRun.name,
      checkRunSummary: ciCheckRun.output?.summary ?? "",
      checkRunText: ciCheckRun.output?.text ?? "",
      checkRunTitle: ciCheckRun.output?.title ?? "",
    })

    return {
      status: "failed",
      failureMessage,
    }
  }

  return {
    status: "failed",
    failureMessage: "Timed out waiting for ci:check status",
  }
}

async function getCiCheckFailureMessage(input: {
  octokit: Awaited<ReturnType<GitHubService["getOctokit"]>>
  owner: string
  repo: string
  checkRunDetailsUrl: string
  checkRunName: string
  checkRunSummary: string
  checkRunText: string
  checkRunTitle: string
}): Promise<string> {
  const runId = extractWorkflowRunId(input.checkRunDetailsUrl)
  if (runId) {
    const logsMessage = await getWorkflowRunFailureLogMessage({
      octokit: input.octokit,
      owner: input.owner,
      repo: input.repo,
      runId,
      checkRunName: input.checkRunName,
    })

    if (logsMessage) {
      return logsMessage
    }
  }

  const checkRunMessage = [input.checkRunTitle, input.checkRunSummary, input.checkRunText]
    .map(value => value.trim())
    .find(value => value.length > 0)

  if (checkRunMessage) {
    return truncateOneLine(checkRunMessage, 1200)
  }

  return `ci:check failed (run details: ${input.checkRunDetailsUrl || "unavailable"})`
}

async function getWorkflowRunFailureLogMessage(input: {
  octokit: Awaited<ReturnType<GitHubService["getOctokit"]>>
  owner: string
  repo: string
  runId: number
  checkRunName: string
}): Promise<string | undefined> {
  const jobsResponse = await input.octokit.rest.actions.listJobsForWorkflowRun({
    owner: input.owner,
    repo: input.repo,
    run_id: input.runId,
    per_page: 100,
  })

  const failedJob =
    jobsResponse.data.jobs.find(job => {
      return job.name.toLowerCase().includes("ci:check") && job.conclusion === "failure"
    }) ?? jobsResponse.data.jobs.find(job => job.conclusion === "failure")

  if (!failedJob) {
    return undefined
  }

  const logsResponse = await input.octokit.rest.actions.downloadJobLogsForWorkflowRun({
    owner: input.owner,
    repo: input.repo,
    job_id: failedJob.id,
  })

  const logDownloadUrl = logsResponse.url
  if (!logDownloadUrl) {
    return failedJob.steps?.find(step => step.conclusion === "failure")?.name
  }

  const response = await fetch(logDownloadUrl)
  if (!response.ok) {
    return failedJob.steps?.find(step => step.conclusion === "failure")?.name
  }

  const logText = (await response.text()).trim()
  if (logText.length === 0) {
    return failedJob.steps?.find(step => step.conclusion === "failure")?.name
  }

  return extractFailureMessageFromLog(logText)
}

async function getMergedPullRequestForBranch({
  octokit,
  owner,
  repo,
  branchName,
}: {
  octokit: Awaited<ReturnType<GitHubService["getOctokit"]>>
  owner: string
  repo: string
  branchName: string
}): Promise<{ number: number; title: string; body: string } | undefined> {
  const pulls = await octokit.rest.pulls.list({
    owner,
    repo,
    state: "closed",
    head: `${owner}:${branchName}`,
    per_page: 20,
    sort: "updated",
    direction: "desc",
  })

  const mergedPullRequest = pulls.data.find(pull => {
    return Boolean(pull.merged_at)
  })

  if (!mergedPullRequest) {
    return undefined
  }

  return {
    number: mergedPullRequest.number,
    title: mergedPullRequest.title ?? "",
    body: mergedPullRequest.body ?? "",
  }
}

async function validateBranchCommitMessages(
  repositoryPath: string,
  branchName: string,
): Promise<void> {
  const { stdout } = await runCommandWithOutput([
    "git",
    "-C",
    repositoryPath,
    "log",
    "--format=%H%x00%s%x00%b%x00",
    `main..${branchName}`,
  ])

  validateBranchCommitLogOutput(stdout)
}

async function getCurrentGitBranch(repositoryPath: string): Promise<string> {
  const { stdout } = await runCommandWithOutput([
    "git",
    "-C",
    repositoryPath,
    "branch",
    "--show-current",
  ])
  const branchName = stdout.trim()
  if (branchName.length === 0) {
    throw new Error(`Failed to detect current git branch in "${repositoryPath}"`)
  }

  return branchName
}

async function runCommand(command: string[], options?: { cwd?: string }): Promise<void> {
  const result = await runCommandWithOutput(command, options)
  if (result.exitCode === 0) {
    return
  }
}

async function runCommandWithOutput(
  command: string[],
  options?: { cwd?: string },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const commandText = sanitizeSensitiveLogText(command.join(" "))
  const cwdText = options?.cwd ?? ""
  logger.info('engineer command started command="%s" cwd="%s"', commandText, cwdText)

  const process = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
    cwd: options?.cwd,
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    process.stdout.text(),
    process.stderr.text(),
    process.exited,
  ])

  if (exitCode === 0) {
    logger.info('engineer command completed command="%s" cwd="%s"', commandText, cwdText)
    return {
      stdout,
      stderr,
      exitCode,
    }
  }

  const stdoutText = sanitizeSensitiveLogText(truncateOneLine(stdout.trim(), 800))
  const stderrText = sanitizeSensitiveLogText(truncateOneLine(stderr.trim(), 800))
  logger.error(
    'engineer command failed command="%s" cwd="%s" exit_code="%s" stdout="%s" stderr="%s"',
    commandText,
    cwdText,
    String(exitCode),
    stdoutText,
    stderrText,
  )

  throw new Error(
    `Command failed (exit ${exitCode}): ${commandText}; stdout: ${stdoutText || "<empty>"}; stderr: ${stderrText || "<empty>"}`,
  )
}

function truncateOneLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength)}...`
}

function sanitizeSensitiveLogText(value: string): string {
  return value.replace(/x-access-token:[^@\s]+@github\.com/gi, "x-access-token:***@github.com")
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}
