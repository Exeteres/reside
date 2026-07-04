---
name: reside-ci
description: Use when editing CI commands, package.json scripts, Nx targets, targetDefaults, workspace package scripts, validation targets, or repository check behavior.
enforcement:
  files:
    - ".github/workflows/**"
    - "nx.json"
    - "package.json"
    - "packages/*/package.json"
    - "replicas/*/package.json"
    - "apps/*/package.json"
    - "project.json"
    - "packages/*/project.json"
    - "replicas/*/project.json"
    - "apps/*/project.json"
---

# ReSide CI Rules

## When To Use

- Use this skill when changing root `package.json` `scripts`.
- Use this skill when changing package-level Nx targets such as `typecheck`, `biome`, `biome:check`, `test`, `publish`, or `check:skills`.
- Use this skill when changing `nx.json` target defaults or named inputs.
- Use this skill when adding validation that must run in CI.

## Required First Steps

- Load `reside-core` for repository command rules.
- Load `reside-skills` when CI changes involve `.opencode/skills`, skill packages, or skill validation.
- Inspect existing package scripts before adding a target.

## Hard Rules

- Root `ci:check-and-fix` must use one `nx run-many` invocation for repository checks.
- Root `ci:check` must use one `nx run-many` invocation for repository checks.
- Do not add separate `nx run ... && nx run-many ...` calls for validation that can be represented as an Nx target.
- Add validation to CI by adding the target name to the `nx run-many -t ...` target list.
- Nx skips targets that are not defined by a package; do not add no-op package scripts just to make a target appear everywhere.
- Package scripts must only define targets that perform real work for that package.
- `ci:check-and-fix` may run mutating formatter/fixer targets such as `biome`.
- `ci:check` must use non-mutating check targets such as `biome:check`.
- Keep root package scripts limited to CI entry points unless another skill explicitly owns an exception.

## Current CI Target Sets

- `ci:check-and-fix` runs `check:skills,typecheck,biome,test`.
- `ci:check` runs `check:skills,typecheck,biome:check,test`.
- `ci:publish` runs `publish`.

## Skill Validation In CI

- Skill validation is owned by `reside-skills` and implemented as the `check:skills` target on `@reside/skill-reside-core`.
- CI must include `check:skills` in the relevant `nx run-many -t ...` target list.
- Do not call `nx run @reside/skill-reside-core:check:skills` separately from CI scripts.

## Stop And Ask

- Stop if a requested CI script would require a non-CI convenience wrapper in root `package.json`.
- Stop if a target would need a fake/no-op script to satisfy Nx.
- Stop if CI ordering requirements cannot be represented safely with the existing Nx target list.

## Validation

- Run `nx run @reside/skill-reside-core:check:skills` after changing skill validation rules.
- Run the smallest relevant root CI command when practical.
- At minimum, inspect root `package.json` scripts after editing CI commands.

## Review Checklist

- New validation is represented as an Nx target.
- Root CI scripts do not chain a separate validation command before `nx run-many`.
- No package defines a no-op target.
- Mutating and non-mutating CI variants use the correct target names.
