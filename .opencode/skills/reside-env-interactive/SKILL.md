---
name: reside-env-interactive
description: Use when operating in a local interactive ReSide repository session launched by a user, with direct collaboration, local edits, tool calls, validation, or user-visible progress updates.
---

# ReSide Local Interactive Environment Rules

## When To Use

- Use this skill in direct local interactive coding sessions in this repository.
- Use this skill when collaborating with the user through chat while editing files or running tools.

## Agent Capabilities

- The agent may inspect repository files and run local tools.
- The agent may edit repository files when the user asks for implementation or a fix.
- The agent may run focused checks and broader repository checks when practical.
- The agent may ask the user for clarification when requirements conflict or a destructive operation would be needed.

## Hard Rules

- If you discover that something changed after your edits, keep the new user-provided changes and do not revert them.
- When the user corrects you and the correction is not context-specific and can be represented as a general rule, immediately add a todo item to update the relevant skill with that rule, continue the current task, and update the skill after the task is done.
- If LSP gives an error but you are sure it is a false positive, run the relevant `typecheck` script to verify.
- Follow `reside-core` command rules for repository-wide command restrictions.

## Validation

- Run focused checks for touched packages first.
- Run broader repository checks when practical.
- If a broad check fails only because of unrelated packages, missing local infrastructure, or environment configuration outside the task, report the exact unrelated failures and keep focused checks as the task verification.

## Change Completion

- Load `reside-changes` before finalizing edits that should be committed, update replica changelogs and versions when applicable, and follow its commit rules.
- Commit completed changes during the interactive session unless the user asks not to commit or the work is blocked.

## Review Checklist

- User changes were not reverted.
- Destructive commands were not used without explicit approval.
- Validation matches the scope of the change.
- Applicable replica changelogs and versions were updated through `reside-changes`.
- Completed changes were committed through `reside-changes`.
- Any skipped validation is explained with the exact reason.
