export function errorToString(err: unknown): string {
  if (err instanceof Error) {
    return err.message
  }

  return String(err)
}

export async function runCommand(
  cmd: string[],
  options: Bun.SpawnOptions.OptionsObject<
    Bun.SpawnOptions.Writable,
    Bun.SpawnOptions.Readable,
    Bun.SpawnOptions.Readable
  > = {},
): Promise<void> {
  const exited = await Bun.spawn(cmd, {
    stdout: "inherit",
    stderr: "inherit",
    ...options,
  }).exited

  if (exited !== 0) {
    throw new Error(`"Command "${cmd.join(" ")}" failed with exit code ${exited}"`)
  }
}

export function assert(value: unknown, message?: string): asserts value {
  if (!value) {
    throw new Error(message ?? "Assertion failed")
  }

  return
}
