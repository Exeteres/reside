import type { GithubRepositoryTarget } from "./ai-runtime"
import { strings } from "../../locale"

export type ImplementationIssueContext = {
  number: number
  title: string
  body: string
}

export function createPlanningPrompt(
  repository: GithubRepositoryTarget,
  prompt: string,
  previewTitle: string,
): string {
  return [
    `Repository: ${repository.owner}/${repository.name}`,
    "Planning phase: produce only a GitHub issue draft that locks user requirements.",
    "Issue title, issue body, and final planning summary MUST be in russian.",
    `Preview topic title: ${previewTitle}`,
    "You may keep the preview title if it is accurate, or replace it with a better issue title.",
    "The issue body MUST have exactly two top-level sections: 'Контекст' and 'Требования'.",
    "The 'Контекст' section MUST be a short paragraph of 1-3 sentences about the problem or requested capability.",
    "The 'Требования' section MUST be a bullet list of concrete requirements that define what the user will get when implementation is complete.",
    "The issue body MUST NOT be a step-by-step implementation guide, task checklist, migration checklist, or process plan.",
    "Do not add generic engineering chores to requirements, such as topology registration, version bumping, changelog updates, tests, formatting, deployment mechanics, or repository hygiene, unless the user explicitly requested that exact outcome.",
    "Requirements must lock additions and externally visible behavior, not describe how to implement them.",
    "Infer missing requirement details when the user clearly asks for a capability but leaves practical interface details unspecified.",
    "For command-like capabilities, infer a concise command name and required arguments from context when they are missing.",
    "If the user provides a concise command signature, keep that signature unchanged.",
    "If the user asks for a process or ability that naturally needs a command, infer the command requirement even if the word command is not used.",
    "When command functionality is planned, infer matching natural-language/NLS tool availability so the same capability can be used through the natural interface.",
    "Inference may complete and formalize user requirements, but MUST NOT extend scope, add unrequested features, invent business rules, or change provided concise details.",
    "If the prompt is concise and already specifies the needed details, preserve those details and avoid embellishment.",
    "If some functionality is not requested, do not include it in requirements.",
    "If user asks to just deploy replica, plan that intent without any implementation details (implementation agent knows how to deploy without instructions).",
    "If user asks to create/update replica, assume that replica must be deployed as well and include deploy intent in the plan unless user explicitly states that no deploy is needed.",
    "Use reside_submit_issue_draft exactly once.",
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
  issue: ImplementationIssueContext | undefined,
  userPrompt: string,
): string {
  const issueContext = issue
    ? [
        `Issue: #${issue.number}`,
        `Issue title: ${issue.title}`,
        `Issue body:\n${issue.body}`,
        "PR body MUST end with issue closing tag (for example: Closes #<issue-number>).",
      ]
    : [
        "Issue: none. This implementation-only task intentionally has no GitHub issue.",
        "PR body MUST NOT add an issue closing tag.",
      ]

  return [
    `Repository: ${owner}/${repo}`,
    `Branch: ${branchName}`,
    ...issueContext,
    "You are in Engineer replica implementation phase.",
    "Load and follow `reside-engineer` before classifying the task or changing repository files.",
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
