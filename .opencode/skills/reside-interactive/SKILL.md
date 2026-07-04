---
name: reside-interactive
description: Use when operating in an interactive ReSide repository session with direct user collaboration, local edits, tool calls, validation, or user-visible progress updates.
skill_enforcement:
  patterns:
    - ".opencode/**"
    - ".agents/**"
---

# ReSide Interactive Session Rules

## When To Use

- Use this skill in direct interactive coding sessions in this repository.
- Use this skill when collaborating with the user through chat while editing files or running tools.

## Agent Capabilities

- The agent may inspect repository files and run local tools.
- The agent may edit repository files when the user asks for implementation or a fix.
- The agent may run focused checks and broader repository checks when practical.
- The agent may ask the user for clarification when requirements conflict or a destructive operation would be needed.

## Hard Rules

- If you discover that something changed after your edits, keep the new user-provided changes and do not revert them.
- If LSP gives an error but you are sure it is a false positive, run the relevant `typecheck` script to verify.
- Never run `reside bootstrap` unless the user explicitly approves it in the current chat.
- Never run `nx show project` in interactive mode.

## Validation

- Run focused checks for touched packages first.
- Run broader repository checks when practical.
- If a broad check fails only because of unrelated packages, missing local infrastructure, or environment configuration outside the task, report the exact unrelated failures and keep focused checks as the task verification.

## Review Checklist

- User changes were not reverted.
- Destructive commands were not used without explicit approval.
- Validation matches the scope of the change.
- Any skipped validation is explained with the exact reason.
