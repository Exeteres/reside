import type { GithubRepositoryTarget } from "./ai-runtime"
import { strings } from "../../locale"

export function createPlanningPrompt(
  repository: GithubRepositoryTarget,
  prompt: string,
  previewTitle: string,
): string {
  return [
    `Repository: ${repository.owner}/${repository.name}`,
    "Planning phase: produce issue draft update only.",
    "Issue title, issue body, and plan summary MUST be in russian.",
    `Preview topic title: ${previewTitle}`,
    "You may keep the preview title if it is accurate, or replace it with a better issue title.",
    "Do not invent tasks, requirements, or technical details that are not present in the user prompt or repository evidence.",
    "If user prompt is high-level or minimal, keep the plan high-level and minimal as well.",
    "Match detail level to available input; do not add speculative decomposition just to make plan look complete.",
    "Do not enforce rigid issue-body structure. If you use sectioned structure, only first section 'Context' is required; all other sections are optional.",
    "If user asks to just deploy replica, plan that intent without any implementation details (implementation agent knows how to deploy without instructions).",
    "If user asks to create/update replica, assume that replica must be deployed as well and include deploy intent in the plan unless user explicitly states that no deploy is needed.",
    "Use submit_issue_draft exactly once.",
    "End assistant response with a concise russian summary in one paragraph (prefer 3-5 short sentences).",
    "Focus the summary on new, useful information for the user: what changed in substance, what decisions matter now, and what follow-up is relevant.",
    "Avoid process checklist narration and avoid describing rule compliance unless it affects user choices.",
    "Prefer plain prose summary (no lists, no headings, no multiple paragraphs) unless absolutely necessary.",
    `User prompt: ${prompt}`,
  ].join("\n")
}

export function createImplementationPrompt(
  owner: string,
  repo: string,
  branchName: string,
  issueNumber: number,
  userPrompt: string,
): string {
  return [
    `Repository: ${owner}/${repo}`,
    `Branch: ${branchName}`,
    `Issue: #${issueNumber}`,
    "You are in implementation phase.",
    "Git environment is already configured for commits on the provided branch.",
    "You may use any git commands needed during implementation.",
    "Before calling create_pull_request (create_pr_branch), ensure git HEAD is on the initial branch shown above.",
    "Commit messages must be lowercase conventional commits with a single-line subject.",
    "Do not create commit body or trailers.",
    "When multiple invalid commits exist, rewrite current-branch history as needed before creating PR.",
    "Use create_pull_request tool to push commits, create PR, merge with rebase, and delete source branch.",
    "Commit messages MUST follow conventional commits format and stay lowercase (single-line subject only, no commit body).",
    "For simple or tightly related changes prefer a single commit; for larger or clearly separable phases prefer multiple focused commits.",
    "If create_pull_request fails with commit validation, rewrite invalid commit message(s) first (at minimum amend latest commit), then retry create_pull_request.",
    "Before calling deploy_replica, commit your changes. If you are confident deploy is safe without PR, you may deploy directly.",
    "deploy_replica can be called without version bump when no meaningful replica changes were made.",
    "Do not bump replica version for dependency-only changes (packages or other replicas) or when there is no meaningful behavior change.",
    "When repository review is needed, call create_pull_request with your own descriptive title before deploy.",
    "PR title must be a regular capitalized title and MUST NOT be a conventional-commit title.",
    "All details belong to PR body, not commit body.",
    "PR body MUST end with issue closing tag (for example: Closes #<issue-number>).",
    "Pull requests must use rebase merge and delete source branch.",
    "When PR is used, deploy_replica should be called only after merged PR exists on this branch.",
    "If deploy_replica fails, report the exact failure reason and continue by fixing the root cause.",
    "Finish with a concise russian summary in one paragraph (prefer 3-5 short sentences).",
    "Focus the summary on new, useful information for the user: key changes, important outcomes, risks, trade-offs, and immediate next implications.",
    "Avoid process checklist narration and avoid describing rule compliance unless it changes user decisions.",
    "Prefer plain prose summary (no lists, no headings, no multiple paragraphs) unless absolutely necessary.",
    `Current user request: ${userPrompt}`,
  ].join("\n")
}

export function extractSummaryFromFinalMessage(content: string | undefined): string {
  const normalized = content?.trim() ?? ""
  if (normalized.length > 0) {
    return normalized.slice(0, 2000)
  }

  return strings.notifications.taskExecution.defaultSummary
}
