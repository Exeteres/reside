---
name: reside-skills
description: Use when creating, editing, packaging, validating, or refactoring ReSide skills under .opencode/skills, skill-owned scripts, skill package.json files, or skill workspace rules.
enforcement:
  files:
    - ".opencode/skills/**"
    - "AGENTS.md"
---

# ReSide Skill Authoring Rules

## When To Use

- Use this skill for any change under `.opencode/skills/*`.
- Use this skill when moving repository tooling into skill packages.
- Use this skill when editing root `package.json` workspace entries for skill packages.
- Use this skill when changing `AGENTS.md` skill routing.

## Required First Steps

- Load `customize-opencode` before changing skill frontmatter, skill paths, opencode config, agents, or opencode-specific behavior.
- Load `reside-core` for repository-level command and validation rules.
- Inspect existing nearby skills before adding a new skill or new section.
- Identify which single skill owns each fact before writing it.

## Skill Shape

- Skill files live at `.opencode/skills/<skill-name>/SKILL.md`.
- Skill file names must be exactly `SKILL.md`.
- Skill `name` frontmatter must match the folder name.
- Skill `description` must explain what the skill does and when to use it.
- Descriptions should front-load concrete trigger words, paths, and filenames.
- Use third-person descriptions such as `Use when...`.

## Working Pattern

1. Decide whether the requested rule belongs in an existing skill or a new skill.
2. Pick exactly one owning skill for each fact.
3. Put the complete rule only in the owning skill.
4. In other skills, reference the owning skill instead of repeating the rule.
5. Prefer action-oriented sections over rule dumps.
6. Add or update validation commands when the skill owns executable tooling.
7. Update `AGENTS.md` routing when adding or renaming skills.

## Standard Sections

Use these sections for substantial skills when applicable:

- `When To Use`
- `Required First Steps`
- `Working Pattern`
- `Hard Rules`
- `Stop And Ask`
- `Validation`
- `Review Checklist`
- `Tools`
- `Related Skills`

Do not add empty sections.
Short domain reference skills may use a smaller shape when the standard sections would add noise.

## Ownership Rules

- Each fact must be owned by exactly one skill.
- Do not duplicate the same fact between skills.
- Do not duplicate the same fact inside one skill.
- If another skill needs the context, reference the owning skill by name.
- Use `Related Skills` sections for cross-skill dependencies.
- The more specific skill owns detailed domain rules.
- `reside-core` owns repository-wide invariants and routing, not detailed domain rules.
- `reside-skills` owns skill authoring, skill packaging, and skill workspace rules.

## Skill Package Rules

- Skill scripts live in workspace packages under `.opencode/skills/*`.
- Skill packages under the hidden `.opencode` directory must be listed explicitly in the root `package.json` `workspaces` array; do not rely on `.opencode/skills/*` glob resolution.
- Call skill scripts through their full repository-root paths.
- Do not add convenience wrappers for skill scripts in the root `package.json`.
- Skill packages must only define Nx targets that perform real work.
- Do not add no-op `test` scripts to skill packages just to make Nx run them.
- Use package imports between skill packages instead of deep relative imports.
- Shared skill-script helpers belong to `@reside/skill-reside-core`.
- Put skill package executable TypeScript under `src/` so existing Nx inputs include it.
- Use the root dependency catalog for skill package dependencies.
- Do not create separate lockfiles or dependency islands inside skill packages.

## Stop And Ask

- Stop if two skills appear to own the same fact and the correct owner is unclear.
- Stop if a requested skill would overlap an existing skill instead of adding a distinct scope.
- Stop if package portability outside this repository becomes a requirement; current skill packages are repository-native.

## Validation

- Run `nx run @reside/skill-reside-core:check:skills` after changing skill files, skill packages, root skill workspaces, or skill-owned script placement.
- Verify skill frontmatter names match folder names.
- Search for duplicated facts after moving or adding rules.
- Run focused Nx targets for skill packages that define changed targets.
- Restart opencode after skill, agent, plugin, or config-time file changes because running sessions keep already-loaded config.

## Review Checklist

- Every new fact has one owning skill.
- Cross-skill dependencies are references, not repeated rules.
- Skill package workspace entries are explicit when package imports are required.
- Root `package.json` does not contain convenience wrappers for skill scripts.
- Skill-owned scripts are documented with full repository-root paths.
