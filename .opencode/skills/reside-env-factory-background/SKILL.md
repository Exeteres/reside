---
name: reside-env-factory-background
description: Use when operating as the Engineer factory background implementation agent for managed tasks, GitHub issue work, commits, PR delivery, deployments, or Engineer task workflows.
---

# ReSide Factory Background Environment Rules

## When To Use

- Use this skill in Engineer replica background task sessions created by the task workflow.
- Use this skill when executing work from a GitHub issue or implementation-only task through Engineer replica tooling.
- Use this skill when deciding whether Engineer should commit, deliver, create a PR, or deploy.

## Agent Capabilities

- The agent may inspect the repository and implement code-changing tasks.
- The agent may use git commands needed during implementation.
- The agent may run Prisma, Bun, repository checks, generators, and project-specific tools directly.
- The agent may use `commit_changes`, `deliver_changes`, and `deploy_replica` for code-changing tasks with actual repository changes.
- The agent may call `create_dev_database` when Prisma or database-backed checks need temporary development databases.

## Required First Steps

- Run `bun install --frozen-lockfile` before serving the user's request.
- Classify the current request and issue body as either code-changing or research-only.
- Treat audits, investigations, reviews, analysis, reports, and recommendations as research-only unless they explicitly ask to implement fixes or add product behavior.
- Load `reside-core` and any task-scoped skills before editing.

## Working Directory For Engineer Tools

- When calling Engineer tools, pass `workingDir` as the absolute path of the current repository directory for this session.
- Engineer tools derive branch state from `workingDir`; do not pass branch names manually.

## Research-Only Tasks

- Do not change repository files.
- Do not create commands, APIs, NLS tools, tests, changelog entries, PRs, deployments, or persistent report artifacts unless the issue explicitly asks for those exact repository changes.
- Inspect the repository and finish with a concise Russian report that lists findings, impact, recommendations, and explicitly states when no critical or high-risk problems were found.

## Code-Changing Tasks

- Only call `commit_changes`, `deliver_changes`, or `deploy_replica` for code-changing tasks with actual repository changes.
- If this session is running in the main git repository instead of a workspace, do not edit repository files; advise the user to create a new workspace for this repository and request the changes there.
- Do not edit files outside the current session worktree or `/tmp`.
- If the user requests changes outside the current session worktree or `/tmp`, advise them to create a new workspace for that target and request the changes there.
- Prefer create/edit tools for source-file content changes.
- Use bash for inspection, generators, checks, git recovery, and simple filesystem operations.
- Avoid shell heredocs, `cat >`, `sed -i`, `perl -pi`, and one-off Node/Python scripts for writing repository source files unless a structured edit tool cannot express the change.
- When a task asks to remove a replica from the codebase, consider using `git revert` on commits that originally added that replica if it produces a smaller and clearer change than manual deletion.

## Ambiguous Bug Reports

- When the user or issue asks to fix a bug but does not provide enough context to identify the failing replica, service, operation, logs, trace, error, or reproduction path, do not blindly edit files.
- First use the SigNoz MCP tools to investigate production telemetry, starting with the signal that best matches the report.
- If the signal or resource scope is unclear, follow the SigNoz MCP rules: clarify whether to use metrics, traces, or logs, and ask for or discover a resource-attribute filter before running broad queries.
- Edit code only after telemetry, reproduction, or provided issue details identify a concrete root cause or a narrow failing component.

## Command Rules

- Git environment is already configured for commits on the provided branch.
- Do not run `devenv`, `devenv shell`, Nix, or NixOS setup commands unless the task explicitly changes or tests repository Nix/devenv configuration.
- Before making changelog, versioning, or commit decisions, load and follow `reside-changes`.
- When creating a new replica from an existing replica, prefer `bun .opencode/skills/reside-replica/src/scaffold-replica.ts example <new-replica>` before manual copying, unless another existing replica is a closer domain or architecture match.

## Prisma Databases

- When Prisma migration generation needs a development database, call `create_dev_database` twice.
- Use the first returned `DATABASE_URL` as `DATABASE_URL` and the second returned `DATABASE_URL` as `SHADOW_DATABASE_URL`.
- Run direct commands such as `DATABASE_URL=... SHADOW_DATABASE_URL=... bun prisma migrate dev --name <name>`.
- When Prisma checks or database-backed tests need a database but do not run `migrate dev`, call `create_dev_database` once and use the returned `DATABASE_URL`.
- Temporary development databases are removed after 24 hours.
- If a resumed session finds that a created database disappeared, call `create_dev_database` again for each missing `DATABASE_URL` or `SHADOW_DATABASE_URL` and continue with the new URLs.

## Commit And Delivery

- Prefer `commit_changes` for normal commits because it stages paths, creates a conventional commit without a body, and validates branch commit rules.
- Raw git commit commands remain available for recovery and advanced history fixes.
- Before calling `deliver_changes`, ensure git HEAD is on the initial branch.
- When multiple invalid commits exist, rewrite current-branch history as needed before creating PR.
- Use `deliver_changes` to validate commits, push the branch, create or update PR, wait for `ci:check`, merge with rebase, and delete the source branch.
- Do not manually push or force-push the branch before `deliver_changes` unless recovering from an explicit `deliver_changes` failure.
- If `deliver_changes` fails with commit validation, rewrite invalid commit messages first, at minimum amend the latest commit, then retry `deliver_changes`.

## Deployment

- Before calling `deploy_replica`, commit your changes.
- If you are confident deploy is safe without PR, you may deploy directly.
- When repository review is needed, call `deliver_changes` with your own descriptive title before deploy.
- When a code-changing task modifies a replica and bumps its `reside.manifest.json` version, the task is not complete until you call `deploy_replica` for that replica after the PR is merged, unless the user explicitly says not to deploy.
- When PR is used, `deploy_replica` should be called only after merged PR exists on this branch.
- If `deploy_replica` fails, report the exact failure reason and continue by fixing the root cause.

## Pull Requests

- PR title must be a regular capitalized title and must not be a conventional-commit title.
- All details belong to PR body, not commit body.
- Pull requests must use rebase merge and delete source branch.

## Validation

- Run focused checks for touched packages first.
- Run broader repository checks when practical.
- If a broad check fails only because of unrelated packages, missing local infrastructure, or environment configuration outside the task, do not change unrelated code to mask it.
- Report exact unrelated failures and keep focused checks as the task verification.

## Final Response

- Finish with a concise Russian summary in one paragraph, preferably 3-5 short sentences.
- Focus the summary on new, useful information for the user: key changes, important outcomes, risks, trade-offs, and immediate next implications.
- Avoid process checklist narration and avoid describing rule compliance unless it changes user decisions.
- Prefer plain prose summary with no lists, no headings, and no multiple paragraphs unless absolutely necessary.
