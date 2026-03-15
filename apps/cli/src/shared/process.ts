type RunCommandOptions = {
  cwd?: string
  commandLog?: CommandLog
  env?: NodeJS.ProcessEnv
  input?: string
  ignoreExitCode?: boolean
  logOutput?: boolean
  passthroughOutput?: boolean
  onStdoutLine?: (line: string) => void | Promise<void>
  onStderrLine?: (line: string) => void | Promise<void>
}

export type CommandLog = {
  onLine: (line: string) => void | Promise<void>
  tag: string
}

async function emitCommandLog(commandLog: CommandLog | undefined, line: string): Promise<void> {
  if (!commandLog) {
    return
  }

  await commandLog.onLine(line)
}

async function consumeStream(
  stream: ReadableStream<Uint8Array> | null,
  onLine?: (line: string) => void | Promise<void>,
): Promise<string> {
  if (!stream) {
    return ""
  }

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let output = ""
  let pending = ""

  while (true) {
    const chunk = await reader.read()
    if (chunk.done) {
      break
    }

    const text = decoder.decode(chunk.value, { stream: true })
    output += text
    pending += text

    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ""

    if (!onLine) {
      continue
    }

    for (const line of lines) {
      await onLine(line)
    }
  }

  const finalText = decoder.decode()
  output += finalText
  pending += finalText

  if (pending.length > 0 && onLine) {
    await onLine(pending)
  }

  return output
}

/**
 * Runs a command and returns its standard output.
 *
 * It can optionally stream stdout and stderr line-by-line to callbacks while
 * still collecting the full output for error reporting.
 *
 * @param command The executable and arguments.
 * @param options The process execution options.
 * @returns The collected standard output.
 */
export async function runCommand(
  command: string[],
  options: RunCommandOptions = {},
): Promise<string> {
  await emitCommandLog(options.commandLog, `$ ${command.join(" ")}`)

  if (options.passthroughOutput) {
    const processHandle = Bun.spawn(command, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      stdin: options.input ? "pipe" : undefined,
      stdout: "inherit",
      stderr: "inherit",
    })

    if (options.input && processHandle.stdin) {
      await processHandle.stdin.write(options.input)
      await processHandle.stdin.end()
    }

    const exitCode = await processHandle.exited
    if (exitCode !== 0 && !options.ignoreExitCode) {
      throw new Error(`Command "${command.join(" ")}" failed with exit code ${exitCode}`)
    }

    return ""
  }

  const processHandle = Bun.spawn(command, {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
    },
    stdin: options.input ? "pipe" : undefined,
    stdout: "pipe",
    stderr: "pipe",
  })

  if (options.input && processHandle.stdin) {
    await processHandle.stdin.write(options.input)
    await processHandle.stdin.end()
  }

  const stdoutPromise = consumeStream(processHandle.stdout, async line => {
    if (options.logOutput ?? true) {
      await emitCommandLog(options.commandLog, line)
    }

    await options.onStdoutLine?.(line)
  })
  const stderrPromise = consumeStream(processHandle.stderr, async line => {
    if (options.logOutput ?? true) {
      await emitCommandLog(options.commandLog, line)
    }

    await options.onStderrLine?.(line)
  })

  const exitCode = await processHandle.exited
  const stdout = await stdoutPromise
  const stderr = await stderrPromise

  if (exitCode !== 0 && !options.ignoreExitCode) {
    throw new Error(
      `Command "${command.join(" ")}" failed with exit code ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    )
  }

  return stdout
}

/**
 * Waits until the provided check succeeds or the timeout elapses.
 *
 * @param check The asynchronous condition function.
 * @param timeoutMs The maximum wait time.
 * @param message The error message for timeout failures.
 */
export async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs: number,
  message: string,
): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) {
      return
    }

    await Bun.sleep(1_000)
  }

  throw new Error(message)
}
