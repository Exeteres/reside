import { describe, expect, test } from "bun:test"
import { fetchNotcompelImage } from "./image"

describe("fetchNotcompelImage", () => {
  test("fetches image from Notcompel URL", async () => {
    const content = new Uint8Array([1, 2, 3])
    const image = await fetchNotcompelImage(async request => {
      expect(request).toBe("https://notcompel.ru")

      return new Response(content, {
        status: 200,
        headers: {
          "content-type": "image/png",
        },
      })
    })

    expect(image).toEqual({
      name: "notcompel-image.png",
      content,
      contentType: "image/png",
    })
  })

  test("rejects empty image", async () => {
    await expect(
      fetchNotcompelImage(
        async () =>
          new Response(new Uint8Array(), {
            status: 200,
            headers: { "content-type": "image/jpeg" },
          }),
      ),
    ).rejects.toThrow("Fetched Notcompel image is empty")
  })
})
