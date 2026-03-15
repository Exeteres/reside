# Agent Handbook

Some simple rules to follow:

- Before doing anything, read `README.md` and `docs/*.md`.
- Before working with some specific replicas, read their docs in `replicas/*/README.md`.
- Before writing code, read `contributing/CODE_STYLE.md`.
- When implementing new replica or API, follow the structure and patterns of existing replicas and APIs as closely as possible.
- Try to use LSP tools to check your code first.
- All titles/descriptions in UI in the project must be in Russian, but all code and comments must be in English.

In interactive mode, follow these additional rules:

- If you discovered that something changed after your edits, stick with the new (user-provided) changes and do not revert them.
- If LSP gives you an error, but you are sure it's a false positive, run `typecheck` script in the project to be sure.
- Ensure that `bun ci:check-and-fix` in the project root passes before submitting your code.
