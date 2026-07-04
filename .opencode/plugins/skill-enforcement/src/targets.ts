export function getTargetPaths(tool: string, args: unknown): string[] {
  if (!isRecord(args)) {
    return []
  }

  if (tool === "apply_patch") {
    return parsePatchTargets(args.patchText ?? args.patch)
  }

  return [args.filePath, args.path]
    .filter((path): path is string => typeof path === "string")
    .map(normalizePath)
}

export function getTargetCommands(tool: string, args: unknown): string[] {
  if (tool !== "bash" || !isRecord(args) || typeof args.command !== "string") {
    return []
  }

  return [args.command]
}

function parsePatchTargets(value: unknown): string[] {
  if (typeof value !== "string") {
    return []
  }

  const targets = new Set<string>()
  const pattern = /^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm

  for (const match of value.matchAll(pattern)) {
    const target = match[1] ?? match[2]

    if (target) {
      targets.add(normalizePath(target))
    }
  }

  return [...targets]
}

function normalizePath(path: string): string {
  return path.replace(/^\.\//, "")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
