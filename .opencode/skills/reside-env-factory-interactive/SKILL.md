---
name: reside-env-factory-interactive
description: Use when operating in the Engineer factory web OpenCode environment for user-created workspaces and manual sessions with shared Engineer tools.
---

# ReSide Factory Interactive Environment Rules

## When To Use

- Use this skill in user-created OpenCode web sessions running on the Engineer factory gateway.
- Use this skill when the user manually creates a factory workspace or session and expects normal OpenCode behavior plus Engineer tools.

## Required First Steps

- Run `git rebase main` from the session worktree before dependency installation, and resolve any conflicts if the rebase stops.
- Run `bun install --frozen-lockfile` before serving the user's request.
- On new workspaces, prefer running `git rebase main && bun install --frozen-lockfile` as the preparation command.
- Read `README.md`, load `reside-core`, and load any task-scoped skills before editing.

## Agent Capabilities

- The agent may inspect the repository and implement code-changing tasks.
- The agent may use git commands needed during implementation.
- The agent may run Prisma, Bun, repository checks, generators, and project-specific tools directly.
- The agent may use `commit_changes`, `deliver_changes`, and `deploy_replica` for code-changing tasks with actual repository changes.
- The agent may call `create_dev_database` when Prisma or database-backed checks need temporary development databases.

## Working Directory For Engineer Tools

- When calling Engineer tools, pass `workingDir` as the absolute path of the current repository directory for this session.
- Engineer tools derive branch state from `workingDir`; do not pass branch names manually.

## Code-Changing Tasks

- If this session is running in the main git repository instead of a workspace, do not edit repository files; advise the user to create a new workspace for this repository and request the changes there.
- Do not edit files outside the current session worktree or `/tmp`.
- If the user requests changes outside the current session worktree or `/tmp`, advise them to create a new workspace for that target and request the changes there.
- Prefer create/edit tools for source-file content changes.
- Use bash for inspection, generators, checks, git recovery, and simple filesystem operations.
- Avoid shell heredocs, `cat >`, `sed -i`, `perl -pi`, and one-off Node/Python scripts for writing repository source files unless a structured edit tool cannot express the change.
- Before making changelog, versioning, or commit decisions, load and follow `reside-changes`.

## Ambiguous Bug Reports

- When the user asks to fix a bug but does not provide enough context to identify the failing replica, service, operation, logs, trace, error, or reproduction path, do not blindly edit files.
- First use the SigNoz MCP tools to investigate production telemetry, starting with the signal that best matches the report.
- Inspect surrounding error and warning logs, not only logs whose text matches the initially suspected subsystem.
- Follow cross-replica communication edges in logs and traces.
  If one replica reports a client-side failure from another replica, inspect the server-side logs and traces for that other replica before deciding on the fix.
- Treat secondary activities and downstream calls as possible root causes.
  Do not stop after making the caller tolerate the failure when the downstream service, permission, external API, or replica configuration is what actually failed.
- If the signal or resource scope is unclear, follow the SigNoz MCP rules: clarify whether to use metrics, traces, or logs, and ask for or discover a resource-attribute filter before running broad queries.
- Edit code only after telemetry, reproduction, or user-provided details identify a concrete root cause or a narrow failing component.

## Commit And Delivery

- Use `commit_changes` when the user asks you to commit or when a completed code-changing task should be committed.
- Use `deliver_changes` only after checking that delivery is appropriate for the user's request.
- If the user asks to both deliver and deploy, always deliver the committed changes first, then deploy from the delivered main branch state.
- When deploying multiple replicas and there is no dependency order, rollout sequencing, or other concrete blocker, start the `deploy_replica` calls in parallel instead of deploying replicas one by one.
- Do not deploy unless the user explicitly requests deployment or the loaded task-scoped rules require it.

## Validation

- Run focused checks for touched packages first.
- Run broader repository checks when practical.
- If a broad check fails only because of unrelated packages, missing local infrastructure, or environment configuration outside the task, do not change unrelated code to mask it.
- Report exact unrelated failures and keep focused checks as the task verification.

## Final Response

- Finish with a concise summary that focuses on key changes, important outcomes, risks, trade-offs, and immediate next implications.
