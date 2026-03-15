import { PassThrough } from "node:stream"
import { consola, LogLevels } from "consola"
import { type Logger, levels, pino } from "pino"
import { z } from "zod"

const PinoOutputEvent = z.object({
  level: z.number(),
  msg: z.string(),
  success: z.boolean().optional(),
  error: z.unknown().optional(),
})

type PinoOutputEvent = z.infer<typeof PinoOutputEvent>

type PinoOutputSink = (output: PinoOutputEvent) => void

const loggerOptions = {
  name: "reside-cli",
  level: process.env.LOG_LEVEL ?? "info",
}

export type ResideLogger = Logger

export const logger = createLogger(output => {
  writeToConsola(output)
})

const configuredLevel = process.env.LOG_LEVEL
const logLevel = configuredLevel
  ? Object.entries(LogLevels).find(([name]) => name === configuredLevel)?.[1]
  : undefined

consola.level = typeof logLevel === "number" ? logLevel : LogLevels.info

export function createTaskOutputLogger(onLine: (line: string) => void): ResideLogger {
  return createLogger(output => {
    onLine(output.msg)
  })
}

export function createChildLogger(parent: ResideLogger, prefix: string): ResideLogger {
  return parent.child({}, { msgPrefix: prefix })
}

function createLogger(onOutput: PinoOutputSink): ResideLogger {
  return pino(loggerOptions, createPinoStream(onOutput))
}

function createPinoStream(onOutput: PinoOutputSink): PassThrough {
  const stream = new PassThrough()

  stream.on("data", data => {
    const rawData = String(data)

    for (const rawLine of rawData.split(/\r?\n/)) {
      if (rawLine.trim().length === 0) {
        continue
      }

      let parsedJson: unknown
      try {
        parsedJson = JSON.parse(rawLine)
      } catch {
        continue
      }

      const parsedData = PinoOutputEvent.safeParse(parsedJson)
      if (!parsedData.success) {
        continue
      }

      onOutput(parsedData.data)
    }
  })

  return stream
}

function writeToConsola(output: PinoOutputEvent): void {
  const levelLabel = levels.labels[output.level]

  switch (levelLabel) {
    case "info":
      if (output.success) {
        consola.success(output.msg)
        break
      }

      consola.info(output.msg)
      break
    case "warn":
      consola.warn(output.msg)
      break
    case "error":
      if (output.error) {
        consola.error(output.msg, output.error)
      } else {
        consola.error(output.msg)
      }
      break
    case "debug":
      consola.debug(output.msg)
      break
    case "fatal":
      consola.fatal(output.msg)
      break
    case "trace":
      consola.trace(output.msg)
      break
  }
}
