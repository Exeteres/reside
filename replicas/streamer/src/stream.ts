import type { Stream } from "node:stream"
import type { Logger } from "pino"
import { getStream, launch } from "puppeteer-stream"

export async function createStream(endpoint: string, logger: Logger): Promise<Stream> {
  const chromiumPathProc = Bun.spawn(["which", "chromium"], { stdout: "pipe" })
  const chromiumPathOutput = await chromiumPathProc.stdout!.text()
  const chromiumPath = chromiumPathOutput.trim()

  if (!chromiumPath) {
    throw new Error("Chromium executable not found")
  }

  logger.info(`using chromium executable at: "%s"`, chromiumPath)

  const browser = await launch({
    executablePath: chromiumPath,
    defaultViewport: { width: 1920, height: 1080 },
    args: [
      "--allowlisted-extension-id=jjndjgheafjngoipoacpjgeicjeomjli",
      "--no-sandbox",
      "--headless",
    ],
  })

  const page = await browser.newPage()
  page.goto(endpoint)

  return await getStream(page, { audio: false, video: true })
}
