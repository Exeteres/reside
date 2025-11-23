import type { Stream } from "node:stream"
import { launch, getStream } from "puppeteer-stream"

export async function createStream(): Promise<Stream> {
  const chromiumPathProc = Bun.spawn(["which", "chromium"], { stdout: "pipe" })
  const chromiumPathOutput = await chromiumPathProc.stdout!.text()
  const chromiumPath = chromiumPathOutput.trim()

  if (!chromiumPath) {
    throw new Error("Chromium executable not found")
  }

  const browser = await launch({
    executablePath: chromiumPath,
    defaultViewport: { width: 1920, height: 1080 },
    args: ["--allowlisted-extension-id=jjndjgheafjngoipoacpjgeicjeomjli"],
  })

  const page = await browser.newPage()
  page.goto("https://github.com/Exeteres/reside")

  return await getStream(page, { audio: false, video: true })
}
