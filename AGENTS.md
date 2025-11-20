# Agent Handbook

Hi, silly LLM agent!
This document is here to make you generate code that humans will like a little bit more than completely hate it.

Some simple rules to follow:

- Before doing anything, load `docs/*.md` in your context window.
- Before working with some specific replicas, read their docs in `replicas/*/README.md`.
- Before writing code, load `contributing/CODE_STYLE.md` in your context window and strictly follow the guidelines there.
- Use `docs/*.md` and `replicas/*/README.md` as good human-written examples of how to write docs.
- Do not write anything that is not asked for.
- When implementing new replica or contract, follow the structure and patterns of existing replicas and contracts as closely as possible.
- Try to use LSP tools to check your code first. There is no `build` step in this project.
- All docs now are written in Russian, so write docs in Russian as well. Do not confuse with code comments, they should be in English.

In interactive mode, follow these additional rules:

- Do not make up anything. If you don't know, say "I don't know".
- When given a task, first research related files in the codebase and then propose a plan of action.
- In interactive mode, do not action until the user confirms you initial plan unless explicitly asked to do immediately.
- If you discovered that something changed after your edits, stick with the new (user-provided) changes and do not revert them.

In non-interactive mode (when working on PR without user interaction), follow these additional rules:

- No need to install dependencies or any other setup, the environment is already prepared.
- Use `devenv shell -- <command>` to run commands in the proper environment.
- Ensure that `devenv shell -- bun ci:check-and-fix` in the project root passes without errors before submitting your code.

After you finish your task, verify that your code follow the guidelines in `contributing/CODE_STYLE.md` rule by rule.
