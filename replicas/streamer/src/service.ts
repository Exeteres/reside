import type { Stream } from "node:stream"
import type { Logger } from "pino"

class StreamTarget {
  private proc: Bun.Subprocess<"pipe", "inherit", "inherit">

  constructor(
    readonly name: string,
    readonly url: string,
    private stream: Stream,
    private readonly logger: Logger,
  ) {
    this.proc = Bun.spawn(
      [
        "ffmpeg",
        "-i",
        "-",
        "-v",
        "error",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-tune",
        "zerolatency",
        "-c:a",
        "aac",
        "-f",
        "flv",
        url,
      ],
      {
        stdin: "pipe",
        stdout: "inherit",
        stderr: "inherit",
      },
    )

    this.stream.on("data", chunk => {
      this.proc.stdin.write(chunk)
    })

    this.stream.on("end", () => {
      this.logger.warn(`stream ended, closing target "%s"`, this.name)
      this.proc.stdin.end()
    })
  }

  async stop(): Promise<void> {
    try {
      this.logger.info(`stopping stream to target "%s"`, this.name)

      this.proc.kill("SIGINT")
      await this.proc.exited

      this.logger.info(`stream to target "%s" stopped`, this.name)
    } catch (err) {
      this.logger.error({ err }, `failed to stop stream to target "%s"`, this.name)
    }
  }
}

export class StreamerService {
  private targets: Map<string, StreamTarget> = new Map()

  constructor(
    private readonly stream: Stream,
    private readonly logger: Logger,
  ) {}

  async updateTargets(targets: Record<string, string>): Promise<void> {
    // stop removed or updated targets
    for (const [name, target] of this.targets) {
      if (name in targets && targets[name] === target.url) {
        continue
      }

      await target.stop()
      this.targets.delete(name)
    }

    // start new targets
    for (const [name, url] of Object.entries(targets)) {
      if (this.targets.has(name)) {
        continue
      }

      this.logger.info(`starting stream to target "%s"`, name)
      const target = new StreamTarget(name, url, this.stream, this.logger)
      this.targets.set(name, target)
    }
  }
}
