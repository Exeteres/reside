# Logging Style Guide

This document defines logging requirements for ReSide TypeScript code.

## General rules

- We use `pino` for structured logging.
- Log messages must be lowercase without punctuation.
- Use printf-style messages with explicit key-value placeholders: `key="%s"`.
- Always pass dynamic values as logger arguments, never via string interpolation.
- Do not pass context objects for regular logs.
- Keep keys snake_case in log messages (for example: `task_id`, `session_id`).
- Use `createProjectLogger` instead of passing `projectId` manually.
- For any error/warn log that includes an error, always pass context object with `error` key: `logger.error({ error }, ...)`.
- The `error` value must be an `Error` instance. Do not stringify errors in logs.

## Examples

**GOOD:**

```typescript
const logger = createProjectLogger(this.logger, projectId);

logger.info(
  'updating worker registration registration_id="%s" unit_worker_name="%s" params_changed="%s"',
  registration.id,
  unitWorker.name,
  "true",
);

logger.error(
  { error },
  'failed to process operation operation_id="%s"',
  operationId,
);
```

**BAD:**

```typescript
this.logger.error(
  { err, projectId },
  `Failed to process operation for project ${projectId}.`,
);

logger.info(`updating worker registration ${registration.id}`);

logger.error(
  'failed to process operation operation_id="%s" error="%s"',
  operationId,
  error.message,
);
```
