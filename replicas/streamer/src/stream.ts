import type { Stream } from "node:stream"
import { getStream, launch } from "puppeteer-stream"

export async function createStream(): Promise<Stream> {
  const browser = await launch({ defaultViewport: { width: 1920, height: 1080 } })

  const page = await browser.newPage()
  page.goto("https://github.com/Exeteres/reside")

  return await getStream(page, { audio: false, video: true })
}
