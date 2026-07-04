---
name: reside-changes
description: Use when changing CHANGELOG.md, reside.manifest.json, replica versions, release notes, version bumps, meaningful replica changes, or commit messages in ReSide.
skill_enforcement:
  patterns:
    - "replicas/*/CHANGELOG.md"
    - "replicas/*/reside.manifest.json"
    - "CHANGELOG.md"
    - "reside.manifest.json"
---

# ReSide Change Management Rules

## Replica Versions and Changelogs

- New replica packages must include `reside.manifest.json` with `version` set to `0.1.0` and `image` set to the replica image repository.
- New replica packages must include a `CHANGELOG.md` file with an initial changelog entry describing the initial release.
- `reside.manifest.json` is the source of truth for the current replica `version`, image builds, image tags, deploys, and Alpha registration.
- `CHANGELOG.md` must define version history for meaningful replica changes.
- After each meaningful change in a replica, update its version and changelog using `bun .opencode/skills/reside-changes/src/update-version.ts <replica-name> <minor|patch> <changelog-entry>` from the repository root.
- Use `patch` for bug fixes, small enhancements, and incremental improvements to existing behavior.
- Use `minor` for new functionality, including new commands, new APIs, new mechanisms, and other new user-visible capabilities.
- Changelog entries must be written in Russian with simple direct phrasing.
- Avoid complex wording and avoid naming the changed replica unless it is needed for clarity.
- When a changelog entry names a replica, use the replica title from `src/locale/ru.ts`.
- Dependency-only changes, including package dependency updates or changes to other replicas, must not cause a replica version bump.
- Backward-incompatible changes are forbidden.
- Major version bumps are forbidden.

## Tools

- Run version updates from the repository root with `bun .opencode/skills/reside-changes/src/update-version.ts <replica-name> <minor|patch> <changelog-entry>`.
- Do not use or add a root package wrapper for this command.

## Commits

- Use Conventional Commits for all commit messages.
- Keep commit messages lowercased as a single line string without extra details.
- Do not create commit bodies or trailers.
- Group changes logically and create separate commits for separate logical changes.
- For simple or tightly related changes, prefer a single commit.
- For larger or clearly separable phases, prefer multiple focused commits.
- For commit scope, use package or replica names when a commit affects a single package or replica.
- If one logical change affects multiple packages or replicas, omit the commit scope.
